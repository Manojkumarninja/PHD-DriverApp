import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Lock, Package } from "lucide-react";
import { api, ApiError, ConflictError } from "../lib/api";
import type { DriverSuggestion, Meta, Order } from "../lib/types";
import { useAsync } from "../lib/hooks";
import { cityLabel, nowHm } from "../lib/format";
import { CustomerPicker } from "./CustomerPicker";
import { TripForm, validateTrip } from "./TripForm";
import type { TripFormState } from "./TripForm";
import { StatCard } from "./ui";
import { useToast } from "./Toast";

function blankForm(meta: Meta): TripFormState {
  return {
    driverName: "",
    driverContact: "",
    driverType: meta.driverTypes[0] ?? "Regular Driver",
    vehicleType: meta.vehicleTypes[0] ?? "2 Wheeler",
    tripStartTime: nowHm(),
    tripEndTime: "",
    tripDistance: "",
    tripCost: "",
    dispatchMdc: "",
    remark: "",
  };
}

export function NewTripPage({
  meta,
  date,
  city,
  drivers,
  refreshDrivers,
  onTripSaved,
}: {
  meta: Meta;
  date: string;
  city: string;
  drivers: DriverSuggestion[];
  refreshDrivers: () => void;
  onTripSaved: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adhocCustomers, setAdhocCustomers] = useState<string[]>([]);
  const [form, setForm] = useState<TripFormState>(() => blankForm(meta));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const ordersState = useAsync<Order[]>(() => api.orders(date, city), [date, city]);
  const mdcsState = useAsync<string[]>(() => api.mdcs(), []);
  const orders = useMemo(() => ordersState.data ?? [], [ordersState.data]);

  // Selection is per date+city; drop it whenever the context changes.
  const contextKey = `${date}|${city}`;
  const [lastContext, setLastContext] = useState(contextKey);
  if (lastContext !== contextKey) {
    setLastContext(contextKey);
    setSelected(new Set());
    setAdhocCustomers([]);
    setShowErrors(false);
  }

  const toggle = useCallback((saleOrderId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(saleOrderId)) next.delete(saleOrderId);
      else next.add(saleOrderId);
      return next;
    });
  }, []);

  const selectMany = useCallback((saleOrderIds: number[], select: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of saleOrderIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const selectedOrders = useMemo(
    () => orders.filter((order) => selected.has(order.saleOrderId)),
    [orders, selected],
  );

  const errors = validateTrip(form, selectedOrders.length + adhocCustomers.length);
  const claimedCount = orders.filter((order) => order.claimed).length;
  const availableCount = orders.length - claimedCount;

  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) {
      toast.push({
        variant: "warning",
        title: "Check the highlighted fields",
        description: Object.values(errors)[0],
      });
      return;
    }

    const cityId = selectedOrders[0]?.cityId ?? meta.citiesByDate[date]?.find((c) => c.city === city)?.cityId;
    if (cityId === undefined) {
      toast.push({ variant: "error", title: "Could not resolve the city id" });
      return;
    }

    setSaving(true);
    try {
      const result = await api.createTrip({
        deliveryDate: date,
        city,
        cityId,
        driverName: form.driverName.trim(),
        driverContact: form.driverContact.trim(),
        driverType: form.driverType,
        vehicleType: form.vehicleType,
        tripStartTime: form.tripStartTime,
        tripEndTime: form.tripEndTime,
        tripDistance: Number(form.tripDistance),
        tripCost: Number(form.tripCost) || 0,
        dispatchMdc: form.dispatchMdc.trim() || null,
        remark: form.remark.trim() || null,
        adhocCustomers,
        orders: selectedOrders.map((order) => ({
          saleOrderId: order.saleOrderId,
          customerId: order.customerId,
          customer: order.customer,
          saleType: order.saleType,
        })),
      });

      toast.push({
        variant: "success",
        title: `Trip saved — ${result.saved} customer${result.saved === 1 ? "" : "s"}`,
        description: `${form.driverName.trim()} · ${form.vehicleType} · ${form.tripStartTime}–${form.tripEndTime} in ${cityLabel(city)}`,
      });

      setSelected(new Set());
      setAdhocCustomers([]);
      setForm(blankForm(meta));
      setShowErrors(false);
      ordersState.refresh();
      refreshDrivers();
      mdcsState.refresh();
      onTripSaved();
    } catch (error) {
      if (error instanceof ConflictError) {
        const names = error.taken.map((t) => t.customer).join(", ");
        toast.push({
          variant: "error",
          title: "Those customers were just claimed",
          description: `${names} — already taken by ${error.taken[0]?.driverName}. Refreshing the list.`,
        });
        setSelected((current) => {
          const next = new Set(current);
          for (const taken of error.taken) next.delete(taken.saleOrderId);
          return next;
        });
        ordersState.refresh();
      } else {
        toast.push({
          variant: "error",
          title: "Could not save the trip",
          description: error instanceof ApiError ? error.message : String(error),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders today" value={orders.length} icon={Package} sublabel={cityLabel(city)} />
        <StatCard label="Available" value={availableCount} tone="success" sublabel="Free to assign" />
        <StatCard label="Claimed" value={claimedCount} icon={Lock} sublabel="By other trips" />
        <StatCard
          label="In this trip"
          value={selectedOrders.length + adhocCustomers.length}
          tone="brand"
          icon={CheckCircle2}
          sublabel="Ready to save"
        />
      </div>

      {ordersState.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Could not load orders: {ordersState.error}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0">
          <CustomerPicker
            orders={orders}
            loading={ordersState.loading}
            selected={selected}
            onToggle={toggle}
            onSelectMany={selectMany}
            adhocCustomers={adhocCustomers}
            onAddAdhoc={(name) => setAdhocCustomers((current) => [...current, name])}
            onRemoveAdhoc={(name) =>
              setAdhocCustomers((current) => current.filter((existing) => existing !== name))
            }
          />
        </div>

        <div className="xl:sticky xl:top-20">
          <TripForm
            meta={meta}
            drivers={drivers}
            mdcs={mdcsState.data ?? []}
            form={form}
            setForm={setForm}
            errors={errors}
            showErrors={showErrors}
            selectedOrders={selectedOrders}
            adhocCount={adhocCustomers.length}
            saving={saving}
            onSave={save}
          />
        </div>
      </div>
    </div>
  );
}
