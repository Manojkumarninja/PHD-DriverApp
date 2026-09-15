"""
PHD Driver Dispatch - Streamlit web app.

Flow: a dispatcher (or the driver themself) picks the Delivery Date and
City, selects or enters the Driver, then claims the set of customers that
driver delivered to that day out of the pool sourced live from
datalake.PHD_TripDetails. Once a customer/order is claimed by a trip, it
disappears from every other driver's picker. Trip-level details (vehicle,
timing, distance, cost) are captured last and the whole trip is saved as
one record, viewable/removable from the "Trip Log" tab.
"""

from __future__ import annotations

import re
from datetime import datetime

import streamlit as st

import db

# ==========================================================================
# Page setup & styling
# ==========================================================================

st.set_page_config(
    page_title="PHD Driver Dispatch",
    page_icon="🚚",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}

        .block-container { padding-top: 1.5rem; padding-bottom: 3rem; max-width: 1180px; }

        .phd-header {
            background: linear-gradient(120deg, #1E3A8A 0%, #2563EB 55%, #3B82F6 100%);
            padding: 1.6rem 2rem;
            border-radius: 14px;
            color: #fff;
            margin-bottom: 1.4rem;
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.25);
        }
        .phd-header h1 { margin: 0; font-size: 1.55rem; font-weight: 700; }
        .phd-header p { margin: 0.3rem 0 0 0; font-size: 0.92rem; opacity: 0.92; }

        .phd-card {
            background: #FFFFFF;
            border: 1px solid #E5E9F0;
            border-radius: 12px;
            padding: 1.3rem 1.5rem 1.1rem 1.5rem;
            margin-bottom: 1.1rem;
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
        }
        .phd-card-title {
            font-size: 1.02rem;
            font-weight: 700;
            color: #1E3A8A;
            margin-bottom: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.45rem;
        }
        .phd-step-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px; height: 22px;
            border-radius: 50%;
            background: #2563EB;
            color: #fff;
            font-size: 0.72rem;
            font-weight: 700;
        }

        .phd-pill {
            display: inline-block;
            padding: 0.15rem 0.65rem;
            border-radius: 999px;
            font-size: 0.76rem;
            font-weight: 600;
        }
        .phd-pill-green { background: #DCFCE7; color: #166534; }
        .phd-pill-amber { background: #FEF3C7; color: #92400E; }
        .phd-pill-blue  { background: #DBEAFE; color: #1E40AF; }

        div[data-testid="stMetric"] {
            background: #F8FAFC;
            border: 1px solid #E5E9F0;
            border-radius: 10px;
            padding: 0.7rem 0.9rem 0.5rem 0.9rem;
        }
        div[data-testid="stMetricValue"] { font-size: 1.35rem; color: #1E3A8A; }

        div.stButton > button[kind="primary"] {
            background: #2563EB;
            border: none;
            border-radius: 8px;
            padding: 0.55rem 1.4rem;
            font-weight: 600;
        }
        div.stButton > button[kind="primary"]:hover { background: #1D4ED8; }

        .phd-footnote { color: #94A3B8; font-size: 0.78rem; margin-top: 0.4rem; }
    </style>
    """,
    unsafe_allow_html=True,
)

CITY_LABELS = {
    "PTP_Bengaluru": "Bengaluru",
    "PTP_Chennai": "Chennai",
    "PTP_Delhi": "Delhi",
    "PTP_Hyderabad": "Hyderabad",
    "PTP_Mumbai": "Mumbai",
}


def city_label(raw: str) -> str:
    return CITY_LABELS.get(raw, raw.replace("PTP_", "").replace("_", " "))


def fmt_date(d) -> str:
    return d.strftime("%d %b %Y (%a)")


PHONE_RE = re.compile(r"^[6-9]\d{9}$")
NEW_DRIVER_OPTION = "➕  Enter new driver"


def fmt_hms(value) -> str:
    """Format a TIME value coming back from MySQL (pymysql returns TIME
    columns as datetime.timedelta) as HH:MM."""
    total_seconds = int(value.total_seconds()) if hasattr(value, "total_seconds") else int(value)
    hours, remainder = divmod(total_seconds, 3600)
    minutes = remainder // 60
    return f"{hours:02d}:{minutes:02d}"

# ==========================================================================
# Header
# ==========================================================================

st.markdown(
    """
    <div class="phd-header">
        <h1>🚚 PHD Driver Dispatch</h1>
        <p>Build each driver's delivery trip — pick their customers, capture trip details, and track what's covered.</p>
    </div>
    """,
    unsafe_allow_html=True,
)

# ==========================================================================
# Sidebar
# ==========================================================================

with st.sidebar:
    st.markdown("### 📦 PHD Dispatch")
    st.caption("Driver trip capture tool")
    st.divider()

    if st.button("🔄 Refresh trip data", width="stretch"):
        db.fetch_trip_data.clear()
        st.toast("Trip data refreshed from the datalake.", icon="✅")

    ok, msg = db.test_connection()
    if ok:
        st.markdown('<span class="phd-pill phd-pill-green">● Connected to datalake</span>', unsafe_allow_html=True)
    else:
        st.markdown('<span class="phd-pill phd-pill-amber">● Connection issue</span>', unsafe_allow_html=True)
        st.caption(msg)

    st.divider()
    st.caption("**Source table:** `datalake.PHD_TripDetails`")
    st.caption("**Trip store:** `datalake.PHD_TripDetails_Out`")
    st.caption(f"Session time: {datetime.now().strftime('%d %b %Y, %I:%M %p')}")

# ==========================================================================
# Load trip data
# ==========================================================================

if not ok:
    st.error(f"⚠️ Could not reach the datalake database.\n\n**Details:** {msg}")
    st.stop()

trip_df = db.fetch_trip_data()

if trip_df.empty:
    st.warning("No rows found in `PHD_TripDetails` yet. Try refreshing once data lands.")
    st.stop()

all_dates = sorted(trip_df["DeliveryDate"].unique())

# ==========================================================================
# Tabs
# ==========================================================================

tab_entry, tab_log = st.tabs(["🚚  New Trip", "📋  Trip Log & Tracking"])

# --------------------------------------------------------------------------
# TAB 1 — New Trip
# --------------------------------------------------------------------------
with tab_entry:

    if "form_epoch" not in st.session_state:
        st.session_state.form_epoch = 0
    epoch = st.session_state.form_epoch

    # ---- Card 1: Trip Basics --------------------------------------------
    st.markdown(
        '<div class="phd-card"><div class="phd-card-title">'
        '<span class="phd-step-badge">1</span> Trip Basics</div>',
        unsafe_allow_html=True,
    )

    c1, c2 = st.columns(2)
    with c1:
        sel_date = st.selectbox("Delivery Date", all_dates, format_func=fmt_date, key="sel_date")
    date_df = trip_df[trip_df["DeliveryDate"] == sel_date]

    with c2:
        cities_avail = sorted(date_df["City"].unique())
        sel_city = st.selectbox("City", cities_avail, format_func=city_label, key="sel_city")
    city_df = date_df[date_df["City"] == sel_city]

    history = db.get_driver_history()
    driver_options = [NEW_DRIVER_OPTION] + [
        f"{r.driver_name} — {r.driver_contact}" for r in history.itertuples()
    ]
    driver_choice = st.selectbox(
        "Driver Name (pick a previously used driver, or add a new one)",
        driver_options,
        key=f"driver_choice_{epoch}",
    )

    if driver_choice == NEW_DRIVER_OPTION:
        name_default, contact_default = "", ""
    else:
        picked = history.iloc[driver_options.index(driver_choice) - 1]
        name_default, contact_default = picked["driver_name"], picked["driver_contact"]

    nc1, nc2 = st.columns(2)
    with nc1:
        driver_name = st.text_input(
            "Driver Name", value=name_default,
            placeholder="e.g. Ramesh Kumar",
            key=f"driver_name_{epoch}_{driver_choice}",
        )
    with nc2:
        driver_contact = st.text_input(
            "Driver Contact Number", value=contact_default,
            placeholder="10-digit mobile number", max_chars=10,
            key=f"driver_contact_{epoch}_{driver_choice}",
        )

    st.markdown("</div>", unsafe_allow_html=True)

    # ---- Card 2: Customers Delivered -------------------------------------
    st.markdown(
        '<div class="phd-card"><div class="phd-card-title">'
        '<span class="phd-step-badge">2</span> Customers Delivered</div>',
        unsafe_allow_html=True,
    )

    claimed_ids = db.get_claimed_so_ids()
    total_orders_today = int(city_df["SaleOrderId"].nunique())
    avail_df = city_df[~city_df["SaleOrderId"].isin(claimed_ids)].sort_values("Customer")
    available_count = int(avail_df["SaleOrderId"].nunique())
    claimed_count = total_orders_today - available_count

    k1, k2, k3 = st.columns(3)
    k1.metric("Total Orders (today, this city)", total_orders_today)
    k2.metric("Already Claimed by Other Trips", claimed_count)
    k3.metric("Available to Assign", available_count)

    selected_so_ids: list[int] = []
    if avail_df.empty:
        st.info("Every customer for this date & city has already been claimed by a driver trip.")
    else:
        label_map = {}
        options = []
        for r in avail_df.itertuples():
            label = f"{r.Customer} — SO {int(r.SaleOrderId)} ({r.Tonnage:g} T)"
            label_map[label] = int(r.SaleOrderId)
            options.append(label)

        picked_labels = st.multiselect(
            "Select every customer this driver delivered to",
            options,
            key=f"customers_{epoch}_{sel_date}_{sel_city}",
            help="Only customers not yet claimed by another driver's trip are listed.",
        )
        selected_so_ids = [label_map[l] for l in picked_labels]

        if selected_so_ids:
            sel_rows = avail_df[avail_df["SaleOrderId"].isin(selected_so_ids)]
            preview = sel_rows[["SaleOrderId", "Customer", "CustomerId", "SaleType_Text", "Tonnage"]].rename(
                columns={
                    "SaleOrderId": "SO ID", "Customer": "Customer", "CustomerId": "Customer ID",
                    "SaleType_Text": "Sale Type", "Tonnage": "Tonnage (T)",
                }
            )
            st.dataframe(preview, hide_index=True, width="stretch")

    st.markdown("</div>", unsafe_allow_html=True)

    # ---- Card 3: Vehicle & Trip Details -----------------------------------
    st.markdown(
        '<div class="phd-card"><div class="phd-card-title">'
        '<span class="phd-step-badge">3</span> Vehicle &amp; Trip Details</div>',
        unsafe_allow_html=True,
    )

    vc1, vc2 = st.columns(2)
    with vc1:
        driver_type = st.selectbox("Driver Type", db.DRIVER_TYPES, key=f"driver_type_{epoch}")
    with vc2:
        vehicle_type = st.selectbox("Vehicle Type", db.VEHICLE_TYPES, key=f"vehicle_type_{epoch}")

    now_time = datetime.now().time().replace(second=0, microsecond=0)
    tc1, tc2 = st.columns(2)
    with tc1:
        trip_start = st.time_input("Trip Start Time", value=now_time, key=f"trip_start_{epoch}")
    with tc2:
        trip_end = st.time_input("Trip End Time", value=now_time, key=f"trip_end_{epoch}")

    dc1, dc2 = st.columns(2)
    with dc1:
        trip_distance = st.number_input(
            "Total Trip Distance (km)", min_value=0.0, step=0.5, format="%.1f",
            key=f"trip_distance_{epoch}",
        )
    with dc2:
        trip_cost = st.number_input(
            "Total Trip Cost (₹)", min_value=0.0, step=10.0, format="%.2f",
            key=f"trip_cost_{epoch}",
        )

    st.markdown("</div>", unsafe_allow_html=True)

    submit = st.button("✅  Save Trip", type="primary")

    if submit:
        errors = []
        if not driver_name.strip():
            errors.append("Driver Name is required.")
        clean_contact = driver_contact.strip().replace(" ", "").replace("-", "")
        if not PHONE_RE.match(clean_contact):
            errors.append("Driver Contact Number must be a valid 10-digit mobile number.")
        if not selected_so_ids:
            errors.append("Select at least one customer this driver delivered to.")
        if trip_end <= trip_start:
            errors.append("Trip End Time must be after Trip Start Time.")
        if trip_distance <= 0:
            errors.append("Enter the total trip distance travelled.")

        if errors:
            for e in errors:
                st.error(e)
        else:
            order_rows = []
            sel_rows = avail_df[avail_df["SaleOrderId"].isin(selected_so_ids)]
            for r in sel_rows.itertuples():
                order_rows.append({
                    "sale_order_id": int(r.SaleOrderId),
                    "customer": r.Customer,
                    "customer_id": int(r.CustomerId),
                    "sale_type": r.SaleType_Text,
                })
            trip = {
                "delivery_date": str(sel_date),
                "city": sel_city,
                "city_id": int(sel_rows.iloc[0]["CityId"]),
                "driver_name": driver_name.strip(),
                "driver_contact": int(clean_contact),
                "driver_type": driver_type,
                "vehicle_type": vehicle_type,
                "trip_start_time": trip_start.strftime("%H:%M"),
                "trip_end_time": trip_end.strftime("%H:%M"),
                "trip_distance": float(trip_distance),
                "trip_cost": float(trip_cost),
            }
            try:
                n_saved = db.create_trip(trip, order_rows)
            except db.AlreadyClaimedError as exc:
                taken_names = city_df[city_df["SaleOrderId"].isin(exc.taken_ids)]["Customer"].tolist()
                st.error(
                    "Could not save — another driver's trip just claimed: "
                    f"**{', '.join(taken_names) or exc.taken_ids}**. "
                    "Please deselect them and try again."
                )
                st.rerun()
            else:
                st.success(
                    f"Trip saved to PHD_TripDetails_Out — **{driver_name.strip()}** delivered to "
                    f"**{n_saved}** customer(s) in {city_label(sel_city)} "
                    f"({vehicle_type}, {trip_start.strftime('%H:%M')}–{trip_end.strftime('%H:%M')})."
                )
                st.session_state.form_epoch += 1
                st.rerun()

# --------------------------------------------------------------------------
# TAB 2 — Trip Log & Tracking
# --------------------------------------------------------------------------
with tab_log:
    st.markdown(
        '<div class="phd-card"><div class="phd-card-title">📊 Delivery Overview</div>',
        unsafe_allow_html=True,
    )

    lf1, lf2 = st.columns(2)
    with lf1:
        log_date = st.selectbox(
            "Filter by Delivery Date", all_dates, format_func=fmt_date, key="log_date"
        )
    log_date_df = trip_df[trip_df["DeliveryDate"] == log_date]
    with lf2:
        city_filter_opts = ["All Cities"] + sorted(log_date_df["City"].unique())
        log_city = st.selectbox(
            "Filter by City", city_filter_opts,
            format_func=lambda c: city_label(c) if c != "All Cities" else c,
            key="log_city",
        )
    if log_city != "All Cities":
        log_date_df = log_date_df[log_date_df["City"] == log_city]

    total_orders = int(log_date_df["SaleOrderId"].nunique())
    claimed_ids = db.get_claimed_so_ids()
    relevant_ids = set(log_date_df["SaleOrderId"].astype(int))
    claimed_count = len(claimed_ids & relevant_ids)
    pending_count = total_orders - claimed_count
    pct = (claimed_count / total_orders * 100) if total_orders else 0

    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Total Orders", total_orders)
    k2.metric("Claimed", claimed_count)
    k3.metric("Pending", pending_count)
    k4.metric("Completion", f"{pct:.0f}%")
    st.progress(pct / 100)
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown(
        '<div class="phd-card"><div class="phd-card-title">🚚 Driver Trips</div>',
        unsafe_allow_html=True,
    )

    trips_df = db.get_trips(
        delivery_date=str(log_date), city=None if log_city == "All Cities" else log_city
    )

    if trips_df.empty:
        st.info("No trips recorded yet for this filter.")
    else:
        for i, row in enumerate(trips_df.itertuples()):
            so_ids = [int(x) for x in row.sale_order_ids.split(",")]
            label = (
                f"{row.DriverName} ({int(row.DriverContactNumber)}) · "
                f"{row.DriverType} · {row.VehicleType} · {row.num_customers} customer(s) · "
                f"{fmt_hms(row.TripStartTime)}–{fmt_hms(row.TripEndTime)} · "
                f"{row.TripDistance:g} km · ₹{row.TripCost:,.2f}"
            )
            with st.expander(label):
                orders = db.get_orders_by_ids(so_ids)
                display = orders[["SaleOrderId", "Customer", "CustomerId", "SaleType_Text"]].rename(
                    columns={
                        "SaleOrderId": "SO ID", "Customer": "Customer", "CustomerId": "Customer ID",
                        "SaleType_Text": "Sale Type",
                    }
                )
                st.dataframe(display, hide_index=True, width="stretch")
                if st.button("🗑️ Delete this trip (frees its customers)", key=f"del_trip_{i}_{so_ids[0]}"):
                    db.delete_trip(so_ids)
                    st.toast(f"Deleted trip for {row.DriverName}.", icon="🗑️")
                    st.rerun()

    st.markdown("</div>", unsafe_allow_html=True)

    flat_df = db.get_all_trip_orders_flat(
        str(log_date), city=None if log_city == "All Cities" else log_city
    )
    if not flat_df.empty:
        st.download_button(
            "⬇️ Export Trip Details (CSV)",
            data=flat_df.to_csv(index=False).encode("utf-8"),
            file_name=f"trip_details_{log_date}.csv",
            mime="text/csv",
        )

    st.markdown(
        '<p class="phd-footnote">Data source: datalake.PHD_TripDetails · '
        'Trips stored in datalake.PHD_TripDetails_Out</p>',
        unsafe_allow_html=True,
    )
