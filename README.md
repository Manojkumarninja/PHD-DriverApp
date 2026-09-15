# 🚚 PHD Driver Dispatch

A Streamlit app for capturing each driver's delivery trip. Order data
(date, city, customer, customer ID, sale order ID, tonnage) is read live
from `datalake.PHD_TripDetails`. The dispatcher (or driver) picks a
date/city, selects or adds a driver, claims the set of customers that
driver delivered to, and captures the trip's vehicle and timing details —
everything is written straight to `datalake.PHD_TripDetails_Out`.

## Flow

1. **Trip Basics** — Delivery Date, City, Driver Name (pick a returning
   driver or add a new one), Driver Contact Number.
2. **Customers Delivered** — a multi-select of every customer with an
   order for that date/city, showing SO ID, Customer ID, Sale Type and
   Tonnage. Once a customer is claimed by a driver's trip, they disappear
   from this list for every other trip — no double-assignment.
3. **Vehicle & Trip Details** — Driver Type, Vehicle Type, Trip Start
   Time, Trip End Time, Total Trip Distance, Total Trip Cost.

Saving writes one row per claimed customer to `PHD_TripDetails_Out`
(driver + vehicle + timing/cost repeated across each), and the form
resets for the next driver (Delivery Date/City stay selected for
convenience).

## Features

- **Driver-first, multi-drop capture**: one trip can cover many customers,
  matching how a driver actually runs their round.
- **Claim-once customers**: `SaleOrderId` is the primary key of
  `PHD_TripDetails_Out`, so an order claimed by one driver's trip is
  physically locked out of every other trip — enforced by the database
  itself, and shared across every dispatcher using the app.
- **Smart driver entry**: pick a previously used driver from a dropdown
  (auto-fills name & contact) or add a brand-new one via text box — new
  drivers automatically appear in the dropdown for next time.
- **Live tracking tab**: claimed vs. pending orders per date/city, an
  expandable list of trips (with their customers), CSV export, and the
  ability to delete a trip (which frees its customers back up).

## Setup

```bash
pip install -r requirements.txt
```

Database credentials live in `.streamlit/secrets.toml` (already configured
for the `datalake` server). Update that file if credentials ever change —
never commit it (it's already in `.gitignore`).

## Run

```bash
streamlit run app.py
```

The app opens at `http://localhost:8501`.

## Data

- **Source (read-only)**: `datalake.PHD_TripDetails` — refreshed every 2
  minutes automatically, or on-demand via the "🔄 Refresh trip data"
  button in the sidebar.
- **Output (read/write)**: `datalake.PHD_TripDetails_Out` — one row per
  delivered order, keyed by `SaleOrderId`. Rows sharing the same driver +
  trip timing/cost (written together by one "Save Trip") make up one
  logical trip in the Trip Log tab. There's no local database file — the
  MySQL table is the single source of truth, so the app works correctly
  even with multiple dispatchers using it at once.
