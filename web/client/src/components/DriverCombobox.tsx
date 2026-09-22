import { useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, UserRound } from "lucide-react";
import type { DriverSuggestion } from "../lib/types";
import { useClickOutside } from "../lib/hooks";

/**
 * Free-text input that doubles as a dropdown of drivers already on record.
 * Typing filters the list and is itself a valid value, so a brand-new driver
 * is entered the same way an existing one is picked - and once saved, they
 * show up in this list next time.
 */
export function DriverCombobox({
  drivers,
  value,
  onChange,
  onPick,
  error,
}: {
  drivers: DriverSuggestion[];
  value: string;
  onChange: (value: string) => void;
  onPick: (driver: DriverSuggestion) => void;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return drivers.slice(0, 50);
    return drivers
      .filter(
        (driver) =>
          driver.driverName.toLowerCase().includes(query) ||
          driver.driverContact.includes(query),
      )
      .slice(0, 50);
  }, [drivers, value]);

  const exactMatch = drivers.some(
    (driver) => driver.driverName.toLowerCase() === value.trim().toLowerCase(),
  );
  const showNewBadge = value.trim().length > 0 && !exactMatch;

  const choose = (driver: DriverSuggestion) => {
    onPick(driver);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && matches[highlight]) {
      event.preventDefault();
      choose(matches[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <UserRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className={`input pr-9 pl-9 ${error ? "input-error" : ""}`}
          value={value}
          placeholder="Type a name, or pick an existing driver"
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="driver-listbox"
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((current) => !current)}
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1 text-slate-400 hover:text-slate-600"
          aria-label="Toggle driver list"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showNewBadge && !open && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700">
          <Plus className="h-3 w-3" /> New driver — will be saved to the list
        </p>
      )}

      {open && (
        <div
          id="driver-listbox"
          role="listbox"
          className="scroll-slim absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
        >
          {showNewBadge && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-emerald-700">
              <Plus className="h-3.5 w-3.5" />
              <span>
                Add <span className="font-semibold">{value.trim()}</span> as a new driver
              </span>
            </div>
          )}
          {matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">
              No saved driver matches — keep typing to add a new one.
            </p>
          ) : (
            matches.map((driver, index) => (
              <button
                key={`${driver.driverName}-${driver.driverContact}`}
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(driver)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                  index === highlight ? "bg-brand-50" : "hover:bg-slate-50"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {driver.driverName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {driver.driverContact}
                    {driver.lastVehicleType ? ` · ${driver.lastVehicleType}` : ""}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {driver.orderCount} {driver.orderCount === 1 ? "drop" : "drops"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
