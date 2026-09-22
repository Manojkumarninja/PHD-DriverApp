import { Clock, IndianRupee, MessageSquareText, Route, Save, Truck, Warehouse, Weight } from "lucide-react";
import type { DriverSuggestion, Meta, Order } from "../lib/types";
import { currency, durationLabel, durationMinutes, number, PHONE_RE } from "../lib/format";
import { DriverCombobox } from "./DriverCombobox";
import { Field, SegmentedControl, Spinner } from "./ui";

export interface TripFormState {
  driverName: string;
  driverContact: string;
  driverType: string;
  vehicleType: string;
  tripStartTime: string;
  tripEndTime: string;
  tripDistance: string;
  tripCost: string;
  dispatchMdc: string;
  remark: string;
}

export interface TripFormErrors {
  driverName?: string;
  driverContact?: string;
  tripEndTime?: string;
  tripDistance?: string;
  orders?: string;
}

/** Validates the form; returns field-keyed messages (empty object = valid). */
export function validateTrip(form: TripFormState, selectedCount: number): TripFormErrors {
  const errors: TripFormErrors = {};

  if (!form.driverName.trim()) {
    errors.driverName = "Driver name is required";
  }
  if (!PHONE_RE.test(form.driverContact.trim())) {
    errors.driverContact = "Enter a valid 10-digit mobile number";
  }
  if (durationMinutes(form.tripStartTime, form.tripEndTime) === null) {
    errors.tripEndTime = "End time must be after start time";
  }
  const distance = Number(form.tripDistance);
  if (!form.tripDistance || Number.isNaN(distance) || distance <= 0) {
    errors.tripDistance = "Enter the distance travelled";
  }
  if (selectedCount === 0) {
    errors.orders = "Select at least one customer this driver delivered to";
  }

  return errors;
}

export function TripForm({
  meta,
  drivers,
  mdcs,
  form,
  setForm,
  errors,
  showErrors,
  selectedOrders,
  saving,
  onSave,
}: {
  meta: Meta;
  drivers: DriverSuggestion[];
  mdcs: string[];
  form: TripFormState;
  setForm: (updater: (current: TripFormState) => TripFormState) => void;
  errors: TripFormErrors;
  showErrors: boolean;
  selectedOrders: Order[];
  saving: boolean;
  onSave: () => void;
}) {
  const update = <K extends keyof TripFormState>(key: K, value: TripFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const shown = (key: keyof TripFormErrors) => (showErrors ? errors[key] : undefined);

  const minutes = durationMinutes(form.tripStartTime, form.tripEndTime);
  const totalTonnage = selectedOrders.reduce((sum, order) => sum + (order.tonnage ?? 0), 0);
  const distance = Number(form.tripDistance) || 0;
  const cost = Number(form.tripCost) || 0;
  const costPerKm = distance > 0 ? cost / distance : null;

  return (
    <div className="card flex flex-col xl:max-h-[calc(100vh-6.5rem)]">
      <div className="card-header">
        <p className="card-title">
          <Truck className="h-4 w-4 text-brand-600" />
          Driver &amp; Trip Details
        </p>
      </div>

      <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <Field label="Driver Name" error={shown("driverName")}>
          <DriverCombobox
            drivers={drivers}
            value={form.driverName}
            error={shown("driverName")}
            onChange={(value) => update("driverName", value)}
            onPick={(driver) =>
              setForm((current) => ({
                ...current,
                driverName: driver.driverName,
                driverContact: driver.driverContact,
                driverType: driver.lastDriverType ?? current.driverType,
                vehicleType: driver.lastVehicleType ?? current.vehicleType,
              }))
            }
          />
        </Field>

        <Field label="Driver Contact Number" error={shown("driverContact")}>
          <input
            className={`input ${shown("driverContact") ? "input-error" : ""}`}
            value={form.driverContact}
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit mobile number"
            onChange={(event) =>
              update("driverContact", event.target.value.replace(/\D/g, "").slice(0, 10))
            }
          />
        </Field>

        <Field label="Driver Type">
          <SegmentedControl
            options={meta.driverTypes}
            value={form.driverType}
            onChange={(value) => update("driverType", value)}
          />
        </Field>

        <Field label="Vehicle Type">
          <SegmentedControl
            options={meta.vehicleTypes}
            value={form.vehicleType}
            onChange={(value) => update("vehicleType", value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Trip Start">
            <input
              type="time"
              className="input"
              value={form.tripStartTime}
              onChange={(event) => update("tripStartTime", event.target.value)}
            />
          </Field>
          <Field label="Trip End" error={shown("tripEndTime")}>
            <input
              type="time"
              className={`input ${shown("tripEndTime") ? "input-error" : ""}`}
              value={form.tripEndTime}
              onChange={(event) => update("tripEndTime", event.target.value)}
            />
          </Field>
        </div>

        {minutes !== null && (
          <p className="-mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            Trip duration: <span className="text-slate-700">{durationLabel(minutes)}</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Distance (km)" error={shown("tripDistance")}>
            <div className="relative">
              <Route className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min="0"
                step="0.5"
                className={`input pl-9 ${shown("tripDistance") ? "input-error" : ""}`}
                value={form.tripDistance}
                placeholder="0.0"
                onChange={(event) => update("tripDistance", event.target.value)}
              />
            </div>
          </Field>
          <Field label="Trip Cost">
            <div className="relative">
              <IndianRupee className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min="0"
                step="10"
                className="input pl-9"
                value={form.tripCost}
                placeholder="0.00"
                onChange={(event) => update("tripCost", event.target.value)}
              />
            </div>
          </Field>
        </div>

        <Field label="Dispatch MDC" hint="Pick an MDC used before, or type a new one">
          <div className="relative">
            <Warehouse className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              list="dispatch-mdc-options"
              value={form.dispatchMdc}
              maxLength={400}
              placeholder="e.g. Bengaluru MDC"
              autoComplete="off"
              onChange={(event) => update("dispatchMdc", event.target.value)}
            />
            <datalist id="dispatch-mdc-options">
              {mdcs.map((mdc) => (
                <option key={mdc} value={mdc} />
              ))}
            </datalist>
          </div>
        </Field>

        <Field label="Remark">
          <div className="relative">
            <MessageSquareText className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <textarea
              className="input min-h-20 resize-y pl-9"
              value={form.remark}
              maxLength={1000}
              placeholder="Optional note about this trip"
              onChange={(event) => update("remark", event.target.value)}
            />
          </div>
          {form.remark.length > 800 && (
            <p className="mt-1 text-right text-xs text-slate-500">{form.remark.length}/1000</p>
          )}
        </Field>

        {costPerKm !== null && cost > 0 && (
          <p className="-mt-1 text-xs text-slate-500">
            Works out to <span className="font-medium text-slate-700">{currency(costPerKm)}</span>{" "}
            per km
          </p>
        )}
      </div>

      {/* Sticky summary + save */}
      <div className="space-y-3 rounded-b-xl border-t border-slate-200 bg-slate-50 p-5">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-xs font-medium text-slate-500">Customers</p>
            <p className="text-lg font-bold tabular-nums text-slate-900">
              {selectedOrders.length}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
              <Weight className="h-3 w-3" /> Tonnage
            </p>
            <p className="text-lg font-bold tabular-nums text-slate-900">
              {number(totalTonnage)} T
            </p>
          </div>
        </div>

        {showErrors && errors.orders && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {errors.orders}
          </p>
        )}

        <button className="btn-primary w-full" onClick={onSave} disabled={saving}>
          {saving ? (
            <>
              <Spinner className="h-4 w-4 text-white" /> Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" /> Save Trip
            </>
          )}
        </button>
        <p className="text-center text-xs text-slate-500">
          Writes {selectedOrders.length || "…"} row
          {selectedOrders.length === 1 ? "" : "s"} to PHD_TripDetails_Out
        </p>
      </div>
    </div>
  );
}
