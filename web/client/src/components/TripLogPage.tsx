import { useState } from "react";
import {
  ChevronRight,
  Clock,
  Download,
  IndianRupee,
  Phone,
  Route,
  MessageSquareText,
  Trash2,
  TruckIcon,
  Users,
  Warehouse,
} from "lucide-react";
import { api } from "../lib/api";
import type { Order, Trip, TripOrder } from "../lib/types";
import { useAsync } from "../lib/hooks";
import { cityLabel, currency, durationLabel, durationMinutes, number } from "../lib/format";
import { EmptyState, ProgressBar, Spinner, StatCard } from "./ui";
import { useToast } from "./Toast";

function TripRow({
  trip,
  onDeleted,
}: {
  trip: Trip;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [orders, setOrders] = useState<TripOrder[] | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && orders === null) {
      setLoadingOrders(true);
      try {
        setOrders(await api.tripOrders(trip.saleOrderIds));
      } catch (error) {
        toast.push({
          variant: "error",
          title: "Could not load trip customers",
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setLoadingOrders(false);
      }
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteTrip(trip.saleOrderIds);
      toast.push({
        variant: "success",
        title: `Trip deleted — ${trip.driverName}`,
        description: `${trip.numCustomers} customer${trip.numCustomers === 1 ? "" : "s"} freed up for another driver.`,
      });
      onDeleted();
    } catch (error) {
      toast.push({
        variant: "error",
        title: "Could not delete the trip",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  const minutes = durationMinutes(trip.tripStartTime, trip.tripEndTime);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div
        onClick={toggle}
        className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate font-semibold text-slate-900">{trip.driverName}</p>
            <span className="pill bg-slate-100 text-slate-600">
              <Phone className="h-3 w-3" />
              {trip.driverContact}
            </span>
            <span className="pill bg-brand-50 text-brand-700">{trip.vehicleType}</span>
            <span className="pill bg-slate-100 text-slate-600">{trip.driverType}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {trip.numCustomers} customer{trip.numCustomers === 1 ? "" : "s"}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {trip.tripStartTime}–{trip.tripEndTime}
              {minutes !== null && ` (${durationLabel(minutes)})`}
            </span>
            <span className="flex items-center gap-1">
              <Route className="h-3 w-3" />
              {number(trip.tripDistance)} km
            </span>
            <span className="flex items-center gap-1 font-medium text-slate-700">
              <IndianRupee className="h-3 w-3" />
              {number(trip.tripCost)}
            </span>
            <span>{number(trip.totalTonnage)} T</span>
            {trip.dispatchMdc && (
              <span className="flex items-center gap-1">
                <Warehouse className="h-3 w-3" />
                {trip.dispatchMdc}
              </span>
            )}
          </div>
          {trip.remark && (
            <p className="mt-1 flex items-start gap-1 text-xs text-slate-600 italic">
              <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
              <span className="line-clamp-2 break-words">{trip.remark}</span>
            </p>
          )}
        </div>

        <div onClick={(event) => event.stopPropagation()} className="shrink-0">
          {confirming ? (
            <div className="flex items-center gap-1.5">
              <button className="btn-danger px-2.5 py-1 text-xs" onClick={remove} disabled={deleting}>
                {deleting ? <Spinner className="h-3.5 w-3.5" /> : "Confirm"}
              </button>
              <button
                className="btn-ghost px-2.5 py-1 text-xs"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              onClick={() => setConfirming(true)}
              title="Delete this trip"
              aria-label={`Delete trip for ${trip.driverName}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          {loadingOrders ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">SO ID</th>
                  <th className="pb-2">Cust. ID</th>
                  <th className="pb-2">Sale Type</th>
                  <th className="pb-2 text-right">Tonnage</th>
                </tr>
              </thead>
              <tbody>
                {(orders ?? []).map((order) => (
                  <tr key={order.saleOrderId} className="border-t border-slate-200/70">
                    <td className="py-1.5 font-medium text-slate-800">{order.customer}</td>
                    <td className="py-1.5 font-mono text-xs tabular-nums text-slate-600">
                      {order.saleOrderId}
                    </td>
                    <td className="py-1.5 font-mono text-xs tabular-nums text-slate-600">
                      {order.customerId}
                    </td>
                    <td className="py-1.5 text-slate-600">{order.saleType ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">
                      {order.tonnage === null ? "—" : `${number(order.tonnage)} T`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function TripLogPage({
  date,
  city,
  allCities,
  refreshKey,
  onChanged,
}: {
  date: string;
  city: string;
  allCities: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const cityFilter = allCities ? undefined : city;

  const tripsState = useAsync<Trip[]>(
    () => api.trips(date, cityFilter),
    [date, cityFilter, refreshKey],
  );
  const ordersState = useAsync<Order[]>(
    () => (cityFilter ? api.orders(date, cityFilter) : Promise.resolve([])),
    [date, cityFilter, refreshKey],
  );

  const trips = tripsState.data ?? [];
  const orders = ordersState.data ?? [];

  const totalOrders = orders.length;
  const claimed = orders.filter((order) => order.claimed).length;
  const pending = totalOrders - claimed;
  const percent = totalOrders > 0 ? (claimed / totalOrders) * 100 : 0;

  const totalCost = trips.reduce((sum, trip) => sum + trip.tripCost, 0);
  const totalDistance = trips.reduce((sum, trip) => sum + trip.tripDistance, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Trips recorded" value={trips.length} icon={TruckIcon} />
        <StatCard
          label="Customers covered"
          value={trips.reduce((sum, trip) => sum + trip.numCustomers, 0)}
          tone="brand"
          icon={Users}
        />
        <StatCard label="Total distance" value={`${number(totalDistance)} km`} icon={Route} />
        <StatCard label="Total cost" value={currency(totalCost)} icon={IndianRupee} />
      </div>

      {!allCities && totalOrders > 0 && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="card-title">Coverage for {cityLabel(city)}</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700">
              {claimed} / {totalOrders} assigned ({percent.toFixed(0)}%)
            </p>
          </div>
          <ProgressBar percent={percent} />
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> {claimed} claimed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-300" /> {pending} pending
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <p className="card-title">
            <TruckIcon className="h-4 w-4 text-brand-600" />
            Driver Trips
            {!allCities && (
              <span className="font-normal text-slate-500">· {cityLabel(city)}</span>
            )}
          </p>
          <a
            href={api.exportUrl(date, cityFilter)}
            className="btn-ghost px-3 py-1.5 text-xs no-underline"
            download
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </a>
        </div>

        {tripsState.loading ? (
          <div className="flex justify-center py-14">
            <Spinner className="h-6 w-6" />
          </div>
        ) : tripsState.error ? (
          <div className="px-5 py-4 text-sm text-rose-700">{tripsState.error}</div>
        ) : trips.length === 0 ? (
          <EmptyState
            icon={TruckIcon}
            title="No trips recorded yet"
            description="Trips saved from the New Trip tab will appear here, grouped by driver."
          />
        ) : (
          <div>
            {trips.map((trip) => (
              <TripRow
                key={trip.id}
                trip={trip}
                onDeleted={() => {
                  tripsState.refresh();
                  ordersState.refresh();
                  onChanged();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
