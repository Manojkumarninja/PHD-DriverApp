/**
 * Data access layer.
 *
 * Two tables on the same MySQL (datalake) server:
 *   1. PHD_TripDetails      (read-only)  - the day's delivery orders.
 *   2. PHD_TripDetails_Out  (read/write) - one row per delivered order,
 *      carrying the driver/vehicle/trip details captured by this app.
 *
 * Because SaleOrderId is the PRIMARY KEY of PHD_TripDetails_Out, an order
 * can be written at most once. That database constraint is what enforces
 * "once a customer is claimed by a driver, no other driver can take them",
 * and it holds across every dispatcher using the app concurrently.
 */
import mysql from "mysql2/promise";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { config } from "./config";
import type {
  CityOption,
  DriverSuggestion,
  Order,
  Trip,
  TripOrder,
  CreateTripInput,
} from "./types";

const SRC = config.sourceTable;
const OUT = config.outTable;

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 8,
  // Return DATE/TIME columns as plain strings ("2026-09-15", "09:00:00")
  // instead of JS Date objects, so the API speaks unambiguous ISO-ish text.
  dateStrings: true,
  enableKeepAlive: true,
});

/** Raised when selected orders were claimed by another trip mid-flight. */
export class AlreadyClaimedError extends Error {
  constructor(
    readonly taken: Array<{ saleOrderId: number; customer: string; driverName: string }>,
  ) {
    super("Some selected orders have already been claimed by another trip");
    this.name = "AlreadyClaimedError";
  }
}

const toNumber = (value: unknown): number => Number(value ?? 0);
const toStringOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** Trim MySQL's "HH:MM:SS" down to the "HH:MM" the UI works in. */
const toHm = (value: unknown): string => String(value ?? "").slice(0, 5);

export async function ping(): Promise<void> {
  await pool.query("SELECT 1");
}

/** Distinct delivery dates, with the cities available on each. */
export async function getMeta(): Promise<{ dates: string[]; citiesByDate: Record<string, CityOption[]> }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT DeliveryDate, City, CityId
       FROM ${SRC}
      ORDER BY DeliveryDate DESC, City`,
  );

  const citiesByDate: Record<string, CityOption[]> = {};
  for (const row of rows) {
    const date = String(row.DeliveryDate);
    (citiesByDate[date] ??= []).push({
      city: String(row.City),
      cityId: toNumber(row.CityId),
    });
  }
  return { dates: Object.keys(citiesByDate), citiesByDate };
}

/**
 * Every order for a date + city, each flagged with whether a driver's trip
 * has already claimed it (and by whom, so the UI can explain the lockout
 * rather than silently hiding the row).
 */
export async function getOrders(deliveryDate: string, city: string): Promise<Order[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT d.SaleOrderId, d.DeliveryDate, d.CityId, d.City, d.CustomerId,
            d.Customer, d.SaleType_Text, d.Tonnage,
            o.DriverName, o.DriverContactNumber
       FROM ${SRC} d
       LEFT JOIN ${OUT} o ON o.SaleOrderId = d.SaleOrderId
      WHERE d.DeliveryDate = ? AND d.City = ?
      ORDER BY d.Customer`,
    [deliveryDate, city],
  );

  return rows.map((row) => ({
    saleOrderId: toNumber(row.SaleOrderId),
    deliveryDate: String(row.DeliveryDate),
    cityId: toNumber(row.CityId),
    city: String(row.City),
    customerId: toNumber(row.CustomerId),
    customer: String(row.Customer ?? ""),
    saleType: toStringOrNull(row.SaleType_Text),
    tonnage: row.Tonnage === null ? null : toNumber(row.Tonnage),
    claimed: row.DriverName !== null,
    claimedBy:
      row.DriverName === null
        ? null
        : {
            driverName: String(row.DriverName),
            driverContact: String(row.DriverContactNumber ?? ""),
          },
  }));
}

/**
 * Drivers already used, most recent first, with the driver/vehicle type
 * they were last recorded against so the form can pre-fill them.
 */
export async function getDrivers(): Promise<DriverSuggestion[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DriverName,
            DriverContactNumber,
            SUBSTRING_INDEX(GROUP_CONCAT(DriverType ORDER BY SaleOrderId DESC), ',', 1)   AS lastDriverType,
            SUBSTRING_INDEX(GROUP_CONCAT(VehicleType ORDER BY SaleOrderId DESC), ',', 1)  AS lastVehicleType,
            COUNT(*)           AS orderCount,
            MAX(SaleOrderId)   AS recency
       FROM ${OUT}
      WHERE DriverName IS NOT NULL
      GROUP BY DriverName, DriverContactNumber
      ORDER BY recency DESC`,
  );

  return rows.map((row) => ({
    driverName: String(row.DriverName),
    driverContact: String(row.DriverContactNumber ?? ""),
    lastDriverType: toStringOrNull(row.lastDriverType),
    lastVehicleType: toStringOrNull(row.lastVehicleType),
    orderCount: toNumber(row.orderCount),
  }));
}

/** Dispatch MDC names already used, most frequent first. */
export async function getMdcs(): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DispatchMDC
       FROM ${OUT}
      WHERE DispatchMDC IS NOT NULL AND DispatchMDC <> ''
      GROUP BY DispatchMDC
      ORDER BY COUNT(*) DESC, DispatchMDC`,
  );
  return rows.map((row) => String(row.DispatchMDC));
}

/**
 * Recorded trips. Rows written together by one save share the same driver
 * and trip timing/cost, so grouping on those rebuilds each logical trip.
 */
export async function getTrips(deliveryDate?: string, city?: string): Promise<Trip[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (deliveryDate) {
    where.push("o.DeliveryDate = ?");
    params.push(deliveryDate);
  }
  if (city) {
    where.push("o.City = ?");
    params.push(city);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.DeliveryDate, o.City, o.DriverName, o.DriverContactNumber,
            o.DriverType, o.VehicleType, o.TripStartTime, o.TripEndTime,
            o.TripDistance, o.TripCost,
            MAX(o.DispatchMDC) AS DispatchMDC, MAX(o.Remark) AS Remark,
            COUNT(*) AS numCustomers,
            GROUP_CONCAT(o.SaleOrderId ORDER BY o.SaleOrderId) AS saleOrderIds,
            COALESCE(SUM(d.Tonnage), 0) AS totalTonnage
       FROM ${OUT} o
       LEFT JOIN ${SRC} d ON d.SaleOrderId = o.SaleOrderId
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY o.DeliveryDate, o.City, o.DriverName, o.DriverContactNumber,
               o.DriverType, o.VehicleType, o.TripStartTime, o.TripEndTime,
               o.TripDistance, o.TripCost
      ORDER BY o.TripStartTime DESC, o.DriverName`,
    params,
  );

  return rows.map((row) => {
    const saleOrderIds = String(row.saleOrderIds ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number);
    return {
      id: saleOrderIds.join("-"),
      deliveryDate: String(row.DeliveryDate),
      city: String(row.City),
      driverName: String(row.DriverName),
      driverContact: String(row.DriverContactNumber ?? ""),
      driverType: String(row.DriverType ?? ""),
      vehicleType: String(row.VehicleType ?? ""),
      tripStartTime: toHm(row.TripStartTime),
      tripEndTime: toHm(row.TripEndTime),
      tripDistance: toNumber(row.TripDistance),
      tripCost: toNumber(row.TripCost),
      dispatchMdc: toStringOrNull(row.DispatchMDC),
      remark: toStringOrNull(row.Remark),
      numCustomers: toNumber(row.numCustomers),
      totalTonnage: toNumber(row.totalTonnage),
      saleOrderIds,
    };
  });
}

/** The customers covered by one trip. */
export async function getTripOrders(saleOrderIds: number[]): Promise<TripOrder[]> {
  if (saleOrderIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.SaleOrderId, o.Customer, o.CustomerId, o.SaleType_Text, d.Tonnage
       FROM ${OUT} o
       LEFT JOIN ${SRC} d ON d.SaleOrderId = o.SaleOrderId
      WHERE o.SaleOrderId IN (?)
      ORDER BY o.Customer`,
    [saleOrderIds],
  );

  return rows.map((row) => ({
    saleOrderId: toNumber(row.SaleOrderId),
    customer: String(row.Customer ?? ""),
    customerId: toNumber(row.CustomerId),
    saleType: toStringOrNull(row.SaleType_Text),
    tonnage: row.Tonnage === null ? null : toNumber(row.Tonnage),
  }));
}

/**
 * Write one row per delivered order, inside a transaction. If any of the
 * orders was claimed since the client loaded them, nothing is written and
 * an AlreadyClaimedError names the conflicts.
 */
export async function createTrip(input: CreateTripInput): Promise<{ saved: number; saleOrderIds: number[] }> {
  const saleOrderIds = input.orders.map((order) => order.saleOrderId);
  const connection: PoolConnection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [claimed] = await connection.query<RowDataPacket[]>(
      `SELECT o.SaleOrderId, o.Customer, o.DriverName
         FROM ${OUT} o
        WHERE o.SaleOrderId IN (?)`,
      [saleOrderIds],
    );

    if (claimed.length > 0) {
      await connection.rollback();
      throw new AlreadyClaimedError(
        claimed.map((row) => ({
          saleOrderId: toNumber(row.SaleOrderId),
          customer: String(row.Customer ?? ""),
          driverName: String(row.DriverName ?? ""),
        })),
      );
    }

    const values = input.orders.map((order) => [
      input.deliveryDate,
      input.cityId,
      input.city,
      order.saleOrderId,
      order.customerId,
      order.customer,
      order.saleType,
      input.driverName,
      input.driverContact,
      input.driverType,
      input.vehicleType,
      input.tripStartTime,
      input.tripEndTime,
      input.tripDistance,
      input.tripCost,
      input.dispatchMdc,
      input.remark,
    ]);

    await connection.query(
      `INSERT INTO ${OUT}
         (DeliveryDate, CityId, City, SaleOrderId, CustomerId, Customer, SaleType_Text,
          DriverName, DriverContactNumber, DriverType, VehicleType,
          TripStartTime, TripEndTime, TripDistance, TripCost,
          DispatchMDC, Remark)
       VALUES ?`,
      [values],
    );

    await connection.commit();
    return { saved: values.length, saleOrderIds };
  } catch (error) {
    // A rollback after a successful commit is a no-op, so this is safe.
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

/** Remove a trip, freeing its customers for another driver. */
export async function deleteTrip(saleOrderIds: number[]): Promise<number> {
  if (saleOrderIds.length === 0) return 0;
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `DELETE FROM ${OUT} WHERE SaleOrderId IN (?)`,
    [saleOrderIds],
  );
  return result.affectedRows;
}

/** Flat rows (one per delivered order) for CSV export. */
export async function getExportRows(deliveryDate?: string, city?: string): Promise<RowDataPacket[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (deliveryDate) {
    where.push("o.DeliveryDate = ?");
    params.push(deliveryDate);
  }
  if (city) {
    where.push("o.City = ?");
    params.push(city);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.DeliveryDate, o.City, o.CityId, o.SaleOrderId, o.CustomerId, o.Customer,
            o.SaleType_Text, d.Tonnage, o.DriverName, o.DriverContactNumber,
            o.DriverType, o.VehicleType, o.TripStartTime, o.TripEndTime,
            o.TripDistance, o.TripCost, o.DispatchMDC, o.Remark
       FROM ${OUT} o
       LEFT JOIN ${SRC} d ON d.SaleOrderId = o.SaleOrderId
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY o.TripStartTime DESC, o.Customer`,
    params,
  );
  return rows;
}
