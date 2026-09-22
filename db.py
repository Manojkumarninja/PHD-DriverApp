"""
Data access layer for the PHD Driver Dispatch app.

Both tables live on the same remote MySQL (datalake) server:
  1. PHD_TripDetails (read-only) - the day's delivery orders, used to
     populate the Date -> City selection and the pool of customers/orders
     available to assign to a driver's trip.
  2. PHD_TripDetails_Out (read/write) - one row per delivered order, keyed
     by SaleOrderId, carrying the driver/vehicle/trip details captured by
     this app. Because SaleOrderId is that table's primary key, an order
     can be written at most once - which is exactly what gives us "once a
     customer is claimed by a driver, no other driver can take them".
     Several rows sharing the same driver + trip timing/cost make up one
     logical "trip" (a driver's multi-drop round).
"""

from __future__ import annotations

from urllib.parse import quote_plus

import pandas as pd
import streamlit as st
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError

DRIVER_TYPES = ["Regular Driver", "Porter Driver"]
VEHICLE_TYPES = ["2 Wheeler", "3 Wheeler", "EV", "4 Wheeler"]

OUT_TABLE = "PHD_TripDetails_Out"


class AlreadyClaimedError(Exception):
    """Raised when one or more selected orders were claimed by another
    driver's trip after this page loaded (a save-time race)."""

    def __init__(self, taken_ids: set[int]):
        self.taken_ids = taken_ids
        super().__init__(f"Already claimed by another trip: {sorted(taken_ids)}")


# --------------------------------------------------------------------------
# Connection
# --------------------------------------------------------------------------

@st.cache_resource(show_spinner=False)
def get_engine() -> Engine:
    """Create (and cache) the SQLAlchemy engine for the datalake MySQL DB."""
    cfg = st.secrets["mysql"]
    user = quote_plus(str(cfg["user"]))
    password = quote_plus(str(cfg["password"]))
    url = (
        f"mysql+pymysql://{user}:{password}"
        f"@{cfg['host']}:{cfg['port']}/{cfg['db']}"
    )
    return create_engine(url, pool_pre_ping=True, pool_recycle=280)


def test_connection() -> tuple[bool, str]:
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "Connected"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


# --------------------------------------------------------------------------
# PHD_TripDetails (source orders)
# --------------------------------------------------------------------------

@st.cache_data(ttl=120, show_spinner="Fetching latest trip data...")
def fetch_trip_data() -> pd.DataFrame:
    """Pull the full PHD_TripDetails table (small, single-day snapshot)."""
    engine = get_engine()
    query = text(
        """
        SELECT DeliveryDate, CityId, City, SaleOrderId, CustomerId,
               Customer, SaleType_Text, Tonnage
        FROM PHD_TripDetails
        """
    )
    with engine.connect() as conn:
        df = pd.read_sql(query, conn)
    df["DeliveryDate"] = pd.to_datetime(df["DeliveryDate"]).dt.date
    return df


# --------------------------------------------------------------------------
# PHD_TripDetails_Out (driver trips captured via the app)
# --------------------------------------------------------------------------

def get_claimed_so_ids() -> set[int]:
    """Every SaleOrderId already written to the Out table (any date/city/
    driver) - these must be excluded from every other driver's picker."""
    with get_engine().connect() as conn:
        rows = conn.execute(text(f"SELECT SaleOrderId FROM {OUT_TABLE}")).fetchall()
    return {int(r[0]) for r in rows}


def is_adhoc_so_id(sale_order_id) -> bool:
    """Ad hoc customers (not in PHD_TripDetails) are stored under negative
    placeholder SaleOrderIds, since the column is the table's primary key and
    cannot be empty. Real sale orders are always positive."""
    try:
        return int(sale_order_id) < 0
    except (TypeError, ValueError):
        return False


class _PlaceholderCollision(Exception):
    """Another save took the same placeholder id first - retry with new ones."""


def create_trip(trip: dict, order_rows: list[dict], adhoc_customers: list[str] | None = None) -> int:
    """Write one row per delivered customer to PHD_TripDetails_Out.

    `trip` needs: delivery_date, city, city_id, driver_name, driver_contact,
    driver_type, vehicle_type, trip_start_time, trip_end_time, trip_distance,
    trip_cost, dispatch_mdc, remark (the last two may be None).
    `order_rows` items need: sale_order_id, customer_id, customer, sale_type.
    `adhoc_customers` are names typed in by hand for orders not in
    PHD_TripDetails; each gets a fresh negative placeholder SaleOrderId and
    blank CustomerId/SaleType_Text.

    Raises AlreadyClaimedError (leaving the table untouched) if another
    driver's trip claimed one of the real orders in the meantime.
    """
    adhoc_customers = adhoc_customers or []
    for _attempt in range(5):
        try:
            return _insert_trip(trip, order_rows, adhoc_customers)
        except _PlaceholderCollision:
            continue
    raise RuntimeError("Could not allocate ad hoc placeholder ids - please try saving again.")


def _insert_trip(trip: dict, order_rows: list[dict], adhoc_customers: list[str]) -> int:
    engine = get_engine()
    so_ids = [int(r["sale_order_id"]) for r in order_rows]

    def claimed(conn) -> set[int]:
        if not so_ids:
            return set()
        placeholders = ", ".join(f":id{i}" for i in range(len(so_ids)))
        params = {f"id{i}": sid for i, sid in enumerate(so_ids)}
        rows = conn.execute(
            text(f"SELECT SaleOrderId FROM {OUT_TABLE} WHERE SaleOrderId IN ({placeholders})"),
            params,
        ).fetchall()
        return {int(r[0]) for r in rows}

    insert_stmt = text(
        f"""
        INSERT INTO {OUT_TABLE} (
            DeliveryDate, CityId, City, SaleOrderId, CustomerId, Customer, SaleType_Text,
            DriverName, DriverContactNumber, DriverType, VehicleType,
            TripStartTime, TripEndTime, TripDistance, TripCost,
            DispatchMDC, Remark
        ) VALUES (
            :delivery_date, :city_id, :city, :sale_order_id, :customer_id, :customer, :sale_type,
            :driver_name, :driver_contact, :driver_type, :vehicle_type,
            :trip_start_time, :trip_end_time, :trip_distance, :trip_cost,
            :dispatch_mdc, :remark
        )
        """
    )

    try:
        with engine.begin() as conn:
            taken = claimed(conn)
            if taken:
                raise AlreadyClaimedError(taken)

            rows = list(order_rows)
            if adhoc_customers:
                lowest = conn.execute(
                    text(f"SELECT MIN(SaleOrderId) FROM {OUT_TABLE} WHERE SaleOrderId < 0")
                ).scalar()
                next_id = min(int(lowest or 0), 0) - 1
                for offset, name in enumerate(adhoc_customers):
                    rows.append({
                        "sale_order_id": next_id - offset,
                        "customer_id": None,
                        "customer": name,
                        "sale_type": None,
                    })

            for row in rows:
                conn.execute(insert_stmt, {**trip, **row})
            return len(rows)
    except IntegrityError as exc:
        # A duplicate key means either a real order was claimed a moment ago,
        # or a concurrent save grabbed the same placeholder ids. Tell them apart.
        with engine.connect() as conn:
            taken = claimed(conn)
        if taken:
            raise AlreadyClaimedError(taken) from exc
        raise _PlaceholderCollision() from exc
    except OperationalError as exc:
        # InnoDB can resolve two simultaneous placeholder allocations as a
        # deadlock (MySQL error 1213); that is just another retryable collision.
        code = exc.orig.args[0] if exc.orig is not None and exc.orig.args else None
        if code == 1213 and adhoc_customers:
            raise _PlaceholderCollision() from exc
        raise


def get_trips(delivery_date: str | None = None, city: str | None = None) -> pd.DataFrame:
    """One row per logical trip - orders sharing the same driver + timing/
    cost (written together by one Save Trip click) are grouped together,
    with their SaleOrderIds collected into a comma-separated list."""
    query = f"""
        SELECT DeliveryDate, City, DriverName, DriverContactNumber, DriverType, VehicleType,
               TripStartTime, TripEndTime, TripDistance, TripCost,
               MAX(DispatchMDC) AS DispatchMDC, MAX(Remark) AS Remark,
               COUNT(*) AS num_customers,
               GROUP_CONCAT(SaleOrderId ORDER BY SaleOrderId) AS sale_order_ids
        FROM {OUT_TABLE}
    """
    conditions, params = [], {}
    if delivery_date:
        conditions.append("DeliveryDate = :delivery_date")
        params["delivery_date"] = delivery_date
    if city:
        conditions.append("City = :city")
        params["city"] = city
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += """
        GROUP BY DeliveryDate, City, DriverName, DriverContactNumber, DriverType, VehicleType,
                 TripStartTime, TripEndTime, TripDistance, TripCost
        ORDER BY TripStartTime DESC, DriverName
    """
    with get_engine().connect() as conn:
        df = pd.read_sql(text(query), conn, params=params)
    return df


def get_orders_by_ids(sale_order_ids: list[int]) -> pd.DataFrame:
    if not sale_order_ids:
        return pd.DataFrame()
    placeholders = ", ".join(f":id{i}" for i in range(len(sale_order_ids)))
    params = {f"id{i}": sid for i, sid in enumerate(sale_order_ids)}
    query = text(
        f"SELECT * FROM {OUT_TABLE} WHERE SaleOrderId IN ({placeholders}) ORDER BY Customer"
    )
    with get_engine().connect() as conn:
        df = pd.read_sql(query, conn, params=params)
    return df


def get_all_trip_orders_flat(delivery_date: str | None = None, city: str | None = None) -> pd.DataFrame:
    """One row per delivered order with its full trip detail - for CSV export."""
    query = f"SELECT * FROM {OUT_TABLE}"
    conditions, params = [], {}
    if delivery_date:
        conditions.append("DeliveryDate = :delivery_date")
        params["delivery_date"] = delivery_date
    if city:
        conditions.append("City = :city")
        params["city"] = city
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY TripStartTime DESC, Customer"
    with get_engine().connect() as conn:
        df = pd.read_sql(text(query), conn, params=params)
    return df


def get_driver_history() -> pd.DataFrame:
    """Distinct drivers previously entered, most active first - used to
    power the 'pick existing or add new' driver dropdown."""
    query = f"""
        SELECT DriverName AS driver_name, DriverContactNumber AS driver_contact,
               DriverType AS driver_type, VehicleType AS vehicle_type,
               MAX(SaleOrderId) AS recency
        FROM {OUT_TABLE}
        GROUP BY DriverName, DriverContactNumber
        ORDER BY recency DESC
    """
    with get_engine().connect() as conn:
        df = pd.read_sql(text(query), conn)
    return df


def get_mdc_history() -> list[str]:
    """Dispatch MDC names already used, most frequent first."""
    query = f"""
        SELECT DispatchMDC FROM {OUT_TABLE}
        WHERE DispatchMDC IS NOT NULL AND DispatchMDC <> ''
        GROUP BY DispatchMDC
        ORDER BY COUNT(*) DESC, DispatchMDC
    """
    with get_engine().connect() as conn:
        rows = conn.execute(text(query)).fetchall()
    return [str(r[0]) for r in rows]


def delete_trip(sale_order_ids: list[int]) -> None:
    """Delete every order row belonging to one trip, freeing those
    customers back up for another driver."""
    if not sale_order_ids:
        return
    placeholders = ", ".join(f":id{i}" for i in range(len(sale_order_ids)))
    params = {f"id{i}": sid for i, sid in enumerate(sale_order_ids)}
    with get_engine().begin() as conn:
        conn.execute(text(f"DELETE FROM {OUT_TABLE} WHERE SaleOrderId IN ({placeholders})"), params)
