import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  ClipboardList,
  Database,
  MapPin,
  PlusCircle,
  RefreshCw,
  Truck,
} from "lucide-react";
import { api } from "./lib/api";
import type { DriverSuggestion, Meta } from "./lib/types";
import { useAsync } from "./lib/hooks";
import { cityLabel, dateLabel } from "./lib/format";
import { NewTripPage } from "./components/NewTripPage";
import { TripLogPage } from "./components/TripLogPage";
import { Spinner } from "./components/ui";
import { ToastProvider } from "./components/Toast";

type Page = "new-trip" | "trip-log";

const ALL_CITIES = "__all__";

function Shell() {
  const [page, setPage] = useState<Page>("new-trip");
  const [date, setDate] = useState("");
  const [city, setCity] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const metaState = useAsync<Meta>(() => api.meta(), []);
  const driversState = useAsync<DriverSuggestion[]>(() => api.drivers(), []);
  const healthState = useAsync<{ ok: boolean; database: string }>(() => api.health(), [refreshKey]);

  const meta = metaState.data;
  const cities = useMemo(
    () => (meta && date ? (meta.citiesByDate[date] ?? []) : []),
    [meta, date],
  );

  // Default to the newest date and its first city once meta arrives.
  useEffect(() => {
    if (!meta || meta.dates.length === 0) return;
    setDate((current) => (current && meta.dates.includes(current) ? current : (meta.dates[0] ?? "")));
  }, [meta]);

  useEffect(() => {
    if (cities.length === 0) return;
    setCity((current) => {
      if (current === ALL_CITIES && page === "trip-log") return current;
      return cities.some((option) => option.city === current) ? current : (cities[0]?.city ?? "");
    });
  }, [cities, page]);

  const refreshAll = () => {
    metaState.refresh();
    driversState.refresh();
    setRefreshKey((key) => key + 1);
  };

  if (metaState.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-8 w-8" />
          <p className="text-sm text-slate-500">Connecting to the datalake…</p>
        </div>
      </div>
    );
  }

  if (metaState.error || !meta) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
          <h1 className="text-lg font-semibold text-slate-900">Cannot reach the API</h1>
          <p className="mt-2 text-sm text-slate-600">{metaState.error}</p>
          <p className="mt-3 text-xs text-slate-500">
            Make sure the API is running on port 4000 (<code>npm run dev</code> in web/).
          </p>
          <button className="btn-primary mt-4 w-full" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const navItems: Array<{ key: Page; label: string; icon: typeof PlusCircle; hint: string }> = [
    { key: "new-trip", label: "New Trip", icon: PlusCircle, hint: "Assign a driver" },
    { key: "trip-log", label: "Trip Log", icon: ClipboardList, hint: "Track & export" },
  ];

  const dbOk = healthState.data?.ok === true;

  return (
    <div className="min-h-screen">
      {/* Sidebar - fixed so it always covers the full viewport, however far
          the main column scrolls. */}
      <aside className="hidden bg-slate-900 lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-60 lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="rounded-lg bg-brand-600 p-2">
            <Truck className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">PHD Dispatch</p>
            <p className="text-xs text-slate-400">Driver trip console</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => {
            const active = page === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setPage(item.key)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span
                    className={`block text-xs ${active ? "text-brand-100" : "text-slate-500"}`}
                  >
                    {item.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${dbOk ? "bg-emerald-400" : "bg-rose-400"}`}
            />
            <span className="text-slate-300">
              {dbOk ? "Datalake connected" : "Datalake unreachable"}
            </span>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <Database className="h-3 w-3 shrink-0" />
            PHD_TripDetails → _Out
          </p>
          <button
            onClick={refreshAll}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh data
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen min-w-0 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand-600 p-1.5 lg:hidden">
                <Truck className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">
                  {page === "new-trip" ? "New Trip" : "Trip Log & Tracking"}
                </h1>
                <p className="text-xs text-slate-500">
                  {page === "new-trip"
                    ? "Pick the customers this driver delivered to, then record the trip"
                    : "Every recorded trip, grouped by driver"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Mobile nav */}
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 lg:hidden">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setPage(item.key)}
                    className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                      page === item.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <CalendarDays className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  className="input w-auto cursor-pointer py-1.5 pl-9 text-sm"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                >
                  {meta.dates.map((option) => (
                    <option key={option} value={option}>
                      {dateLabel(option)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <MapPin className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  className="input w-auto cursor-pointer py-1.5 pl-9 text-sm"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                >
                  {page === "trip-log" && <option value={ALL_CITIES}>All cities</option>}
                  {cities.map((option) => (
                    <option key={option.city} value={option.city}>
                      {cityLabel(option.city)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-5">
          {!date || !city ? (
            <div className="flex justify-center py-20">
              <Spinner className="h-6 w-6" />
            </div>
          ) : page === "new-trip" ? (
            <NewTripPage
              meta={meta}
              date={date}
              city={city === ALL_CITIES ? (cities[0]?.city ?? "") : city}
              drivers={driversState.data ?? []}
              refreshDrivers={driversState.refresh}
              onTripSaved={() => setRefreshKey((key) => key + 1)}
            />
          ) : (
            <TripLogPage
              date={date}
              city={city}
              allCities={city === ALL_CITIES}
              refreshKey={refreshKey}
              onChanged={() => setRefreshKey((key) => key + 1)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
