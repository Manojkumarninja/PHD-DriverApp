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
from sqlalchemy.exc import IntegrityError

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


def create_trip(trip: dict, order_rows: list[dict]) -> int:
    """Write one row per delivered order to PHD_TripDetails_Out.

    `trip` needs: driver_name, driver_contact, driver_type, vehicle_type,
    trip_start_time, trip_end_time, trip_distance, trip_cost.
    `order_rows` items need: sale_order_id, delivery_date, city_id, city,
    customer_id, customer, sale_type.

    Raises AlreadyClaimedError (leaving the table untouched) if another
    driver's trip claimed one of these orders in the meantime.
    """
    engine = get_engine()
    so_ids = [int(r["sale_order_id"]) for r in order_rows]

    with engine.begin() as conn:
        placeholders = ", ".join(f":id{i}" for i in range(len(so_ids)))
        params = {f"id{i}": sid for i, sid in enumerate(so_ids)}
        existing = conn.execute(
            text(f"SELECT SaleOrderId FROM {OUT_TABLE} WHERE SaleOrderId IN ({placeholders})"),
            params,
        ).fetchall()
        if existing:
            raise AlreadyClaimedError({int(r[0]) for r in existing})

        insert_stmt = text(
            f"""
            INSERT INTO {OUT_TABLE} (
                DeliveryDate, CityId, City, SaleOrderId, CustomerId, Customer, SaleType_Text,
                DriverName, DriverContactNumber, DriverType, VehicleType,
                TripStartTime, TripEndTime, TripDistance, TripCost
            ) VALUES (
                :delivery_date, :city_id, :city, :sale_order_id, :customer_id, :customer, :sale_type,
                :driver_name, :driver_contact, :driver_type, :vehicle_type,
                :trip_start_time, :trip_end_time, :trip_distance, :trip_cost
            )
            """
        )
        try:
            for row in order_rows:
                conn.execute(insert_stmt, {**trip, **row})
        except IntegrityError as exc:
            # Extremely tight race: someone claimed it between our check above
            # and this insert. Surface as the same conflict error.
            raise AlreadyClaimedError(set(so_ids)) from exc

    return len(order_rows)


def get_trips(delivery_date: str | None = None, city: str | None = None) -> pd.DataFrame:
    """One row per logical trip - orders sharing the same driver + timing/
    cost (written together by one Save Trip click) are grouped together,
    with their SaleOrderIds collected into a comma-separated list."""
    query = f"""
        SELECT DeliveryDate, City, DriverName, DriverContactNumber, DriverType, VehicleType,
               TripStartTime, TripEndTime, TripDistance, TripCost,
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


def delete_trip(sale_order_ids: list[int]) -> None:
    """Delete every order row belonging to one trip, freeing those
    customers back up for another driver."""
    if not sale_order_ids:
        return
    placeholders = ", ".join(f":id{i}" for i in range(len(sale_order_ids)))
    params = {f"id{i}": sid for i, sid in enumerate(sale_order_ids)}
    with get_engine().begin() as conn:
        conn.execute(text(f"DELETE FROM {OUT_TABLE} WHERE SaleOrderId IN ({placeholders})"), params)
