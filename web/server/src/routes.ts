import { Router } from "express";
import { z } from "zod";
import * as db from "./db";
import { AlreadyClaimedError } from "./db";
import { DRIVER_TYPES, VEHICLE_TYPES } from "./config";

export const router = Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[6-9]\d{9}$/;

const createTripSchema = z.object({
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "deliveryDate must be YYYY-MM-DD"),
  city: z.string().min(1),
  cityId: z.number().int(),
  driverName: z.string().trim().min(1, "Driver name is required"),
  driverContact: z
    .string()
    .trim()
    .regex(PHONE_RE, "Driver contact must be a valid 10-digit mobile number"),
  driverType: z.enum(DRIVER_TYPES),
  vehicleType: z.enum(VEHICLE_TYPES),
  tripStartTime: z.string().regex(TIME_RE, "tripStartTime must be HH:MM"),
  tripEndTime: z.string().regex(TIME_RE, "tripEndTime must be HH:MM"),
  tripDistance: z.number().positive("Trip distance must be greater than 0"),
  tripCost: z.number().min(0, "Trip cost cannot be negative"),
  // Optional free text; blank strings are stored as NULL.
  dispatchMdc: z
    .string()
    .trim()
    .max(400, "Dispatch MDC is too long")
    .nullish()
    .transform((value) => value || null),
  remark: z
    .string()
    .trim()
    .max(1000, "Remark must be 1000 characters or fewer")
    .nullish()
    .transform((value) => value || null),
  orders: z
    .array(
      z.object({
        saleOrderId: z.number().int(),
        customerId: z.number().int(),
        customer: z.string(),
        saleType: z.string().nullable(),
      }),
    )
    .min(1, "Select at least one customer this driver delivered to"),
});

const deleteTripSchema = z.object({
  saleOrderIds: z.array(z.number().int()).min(1),
});

router.get("/health", async (_req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    res.status(503).json({
      ok: false,
      database: "unreachable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get("/meta", async (_req, res) => {
  const meta = await db.getMeta();
  res.json({ ...meta, driverTypes: DRIVER_TYPES, vehicleTypes: VEHICLE_TYPES });
});

router.get("/orders", async (req, res) => {
  const { date, city } = req.query;
  if (typeof date !== "string" || typeof city !== "string") {
    res.status(400).json({ error: "date and city query parameters are required" });
    return;
  }
  res.json(await db.getOrders(date, city));
});

router.get("/drivers", async (_req, res) => {
  res.json(await db.getDrivers());
});

router.get("/mdcs", async (_req, res) => {
  res.json(await db.getMdcs());
});

router.get("/trips", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const city = typeof req.query.city === "string" ? req.query.city : undefined;
  res.json(await db.getTrips(date, city));
});

router.get("/trips/orders", async (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n));
  res.json(await db.getTripOrders(ids));
});

router.post("/trips", async (req, res) => {
  const parsed = createTripSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_FAILED",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (parsed.data.tripEndTime <= parsed.data.tripStartTime) {
    res.status(400).json({
      error: "VALIDATION_FAILED",
      issues: [{ path: "tripEndTime", message: "Trip end time must be after trip start time" }],
    });
    return;
  }

  try {
    const result = await db.createTrip(parsed.data);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof AlreadyClaimedError) {
      // 409: another dispatcher claimed these orders first.
      res.status(409).json({ error: "ALREADY_CLAIMED", taken: error.taken });
      return;
    }
    throw error;
  }
});

router.delete("/trips", async (req, res) => {
  const parsed = deleteTripSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_FAILED" });
    return;
  }
  const deleted = await db.deleteTrip(parsed.data.saleOrderIds);
  res.json({ deleted });
});

router.get("/export", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const city = typeof req.query.city === "string" ? req.query.city : undefined;
  const rows = await db.getExportRows(date, city);

  const headers = [
    "DeliveryDate", "City", "CityId", "SaleOrderId", "CustomerId", "Customer",
    "SaleType_Text", "Tonnage", "DriverName", "DriverContactNumber", "DriverType",
    "VehicleType", "TripStartTime", "TripEndTime", "TripDistance", "TripCost",
    "DispatchMDC", "Remark",
  ];

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");

  const suffix = [date, city].filter(Boolean).join("_") || "all";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="trip_details_${suffix}.csv"`);
  res.send(csv);
});
