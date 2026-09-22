# 🚚 PHD Dispatch Console (React + Express)

A dispatch console for recording driver trips — the same job as the Streamlit
app in the parent folder, rebuilt as a proper web application:

- **Client** — React 19 + TypeScript + Vite + Tailwind CSS v4
- **Server** — Express 5 + TypeScript + mysql2 (connection pooled, transactional)
- **Database** — unchanged: reads `datalake.PHD_TripDetails`, writes
  `datalake.PHD_TripDetails_Out`

Both apps can coexist — they share the same tables, so a trip saved in either
one shows up in the other.

## Running it locally

```bash
cd web
npm run install:all   # installs server + client dependencies
npm run dev           # starts both, with live reload
```

| Service | URL |
| --- | --- |
| Web app | http://localhost:5180 |
| API | http://localhost:4000/api |

The client proxies `/api` to the server, so you only ever open port 5180.

Database credentials live in `web/server/.env` (git-ignored). Copy
`.env.example` if you need to recreate it.

## Why this is better than the Streamlit version

| | Streamlit | This |
| --- | --- | --- |
| Interaction | Whole script re-runs on every click | Instant local state, no reloads |
| Customer selection | Dropdown multiselect | Searchable table: filters, select-all, per-row status |
| Claimed customers | Hidden from the list | Shown greyed out **with the driver who took them** |
| Driver entry | Dropdown + separate text box | One typeahead — filters as you type, free text adds a new driver |
| Validation | Only after pressing Save | Live, inline, per field |
| Feedback | Page-level message | Toasts, plus a running customer/tonnage summary |
| Conflicts | Error on save | Same, but names the customers and de-selects them for you |

## Layout

```
web/
  package.json          # orchestrates both apps (concurrently)
  server/
    src/
      index.ts          # express app + error handling
      routes.ts         # REST endpoints + zod validation
      db.ts             # all SQL, transactions, claim enforcement
      config.ts         # env config, driver/vehicle enums
      types.ts
  client/
    src/
      App.tsx           # shell: sidebar, date/city context, routing
      components/
        NewTripPage.tsx     # customer picking + trip capture
        TripLogPage.tsx     # recorded trips, coverage, export
        CustomerPicker.tsx  # searchable/filterable order table
        TripForm.tsx        # driver + vehicle + timing + cost
        DriverCombobox.tsx  # typeahead that also accepts new names
        Toast.tsx, ui.tsx   # notifications and shared primitives
      lib/
        api.ts, types.ts, format.ts, hooks.ts
```

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | DB connectivity |
| GET | `/api/meta` | Delivery dates, cities per date, enums |
| GET | `/api/orders?date=&city=` | Orders with claimed status + claiming driver |
| GET | `/api/drivers` | Driver history for the typeahead |
| GET | `/api/trips?date=&city=` | Trips, grouped by driver + timing |
| GET | `/api/trips/orders?ids=` | Customers within one trip |
| POST | `/api/trips` | Save a trip (`409` if a customer was just claimed) |
| DELETE | `/api/trips` | Delete a trip, freeing its customers |
| GET | `/api/export?date=&city=` | CSV download |

## The claim rule

`SaleOrderId` is the primary key of `PHD_TripDetails_Out`, so an order can be
written at most once. `POST /api/trips` re-checks inside a transaction and
returns `409 ALREADY_CLAIMED` (naming the customers and the driver who took
them) rather than overwriting — so two dispatchers working at once can't
double-assign a customer.
