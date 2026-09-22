import { useMemo, useState } from "react";
import { Lock, PackageSearch, Search, Users } from "lucide-react";
import type { Order } from "../lib/types";
import { useDebounced } from "../lib/hooks";
import { number } from "../lib/format";
import { EmptyState, Spinner } from "./ui";

type Filter = "available" | "claimed" | "all";

export function CustomerPicker({
  orders,
  loading,
  selected,
  onToggle,
  onSelectMany,
}: {
  orders: Order[];
  loading: boolean;
  selected: Set<number>;
  onToggle: (saleOrderId: number) => void;
  onSelectMany: (saleOrderIds: number[], select: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("available");
  const debouncedQuery = useDebounced(query, 150);

  const counts = useMemo(
    () => ({
      all: orders.length,
      available: orders.filter((order) => !order.claimed).length,
      claimed: orders.filter((order) => order.claimed).length,
    }),
    [orders],
  );

  const visible = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (filter === "available" && order.claimed) return false;
      if (filter === "claimed" && !order.claimed) return false;
      if (!needle) return true;
      return (
        order.customer.toLowerCase().includes(needle) ||
        String(order.saleOrderId).includes(needle) ||
        String(order.customerId).includes(needle)
      );
    });
  }, [orders, filter, debouncedQuery]);

  const selectableVisible = visible.filter((order) => !order.claimed);
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((order) => selected.has(order.saleOrderId));

  const filters: Array<{ key: Filter; label: string; count: number }> = [
    { key: "available", label: "Available", count: counts.available },
    { key: "claimed", label: "Claimed", count: counts.claimed },
    { key: "all", label: "All", count: counts.all },
  ];

  return (
    <div className="card flex min-h-0 flex-col xl:max-h-[calc(100vh-14rem)]">
      <div className="card-header flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <p className="card-title">
            <Users className="h-4 w-4 text-brand-600" />
            Customers Delivered
          </p>
          <span className="pill bg-brand-50 text-brand-700">{selected.size} selected</span>
        </div>

        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
          <div className="relative sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input py-1.5 pl-9 text-sm"
              placeholder="Search customer or SO ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {filters.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-all ${
                  filter === option.key
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {option.label}
                <span className="ml-1 tabular-nums opacity-60">{option.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectableVisible.length > 0 && (
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-brand-600"
              checked={allVisibleSelected}
              onChange={(event) =>
                onSelectMany(
                  selectableVisible.map((order) => order.saleOrderId),
                  event.target.checked,
                )
              }
            />
            Select all {selectableVisible.length} shown
          </label>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onSelectMany([...selected], false)}
              className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-rose-600"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={query ? "No customers match your search" : "Nothing to show here"}
            description={
              filter === "available" && counts.available === 0 && counts.all > 0
                ? "Every customer for this date and city has already been claimed by a driver."
                : "Try a different date, city, or filter."
            }
          />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
              <tr className="border-b border-slate-200 text-left">
                <th className="w-10 px-5 py-2.5"></th>
                <th className="px-2 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Customer
                </th>
                <th className="px-2 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  SO ID
                </th>
                <th className="px-2 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Cust. ID
                </th>
                <th className="px-2 py-2.5 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Tonnage
                </th>
                <th className="px-5 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const isSelected = selected.has(order.saleOrderId);
                return (
                  <tr
                    key={order.saleOrderId}
                    onClick={() => !order.claimed && onToggle(order.saleOrderId)}
                    className={`border-b border-slate-100 transition-colors ${
                      order.claimed
                        ? "bg-slate-50/50 text-slate-400"
                        : isSelected
                          ? "cursor-pointer bg-brand-50/70"
                          : "cursor-pointer hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-5 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed"
                        checked={isSelected}
                        disabled={order.claimed}
                        onChange={() => onToggle(order.saleOrderId)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select ${order.customer}`}
                      />
                    </td>
                    <td className="max-w-0 px-2 py-2.5">
                      <p
                        className={`truncate font-medium ${order.claimed ? "" : "text-slate-900"}`}
                        title={order.customer}
                      >
                        {order.customer}
                      </p>
                      {order.saleType && (
                        <p className="truncate text-xs text-slate-400">{order.saleType}</p>
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs tabular-nums">
                      {order.saleOrderId}
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs tabular-nums">
                      {order.customerId}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {order.tonnage === null ? "—" : `${number(order.tonnage)} T`}
                    </td>
                    <td className="px-5 py-2.5">
                      {order.claimed ? (
                        <span
                          className="pill bg-slate-100 text-slate-500"
                          title={`Claimed by ${order.claimedBy?.driverName} (${order.claimedBy?.driverContact})`}
                        >
                          <Lock className="h-3 w-3" />
                          <span className="max-w-28 truncate">{order.claimedBy?.driverName}</span>
                        </span>
                      ) : isSelected ? (
                        <span className="pill bg-brand-100 text-brand-700">Selected</span>
                      ) : (
                        <span className="pill bg-emerald-50 text-emerald-700">Available</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
