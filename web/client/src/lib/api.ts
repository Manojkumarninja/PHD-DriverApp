import type {
  ClaimConflict,
  CreateTripPayload,
  DriverSuggestion,
  Meta,
  Order,
  Trip,
  TripOrder,
} from "./types";

/** A validation problem reported by the API. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Orders were claimed by someone else between load and save. */
export class ConflictError extends Error {
  constructor(readonly taken: ClaimConflict[]) {
    super("Some customers were just claimed by another trip");
    this.name = "ConflictError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (response.status === 409) {
    const body = (await response.json()) as { taken: ClaimConflict[] };
    throw new ConflictError(body.taken ?? []);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let issues: Array<{ path: string; message: string }> | undefined;
    try {
      const body = (await response.json()) as {
        message?: string;
        error?: string;
        issues?: Array<{ path: string; message: string }>;
      };
      issues = body.issues;
      message = body.issues?.[0]?.message ?? body.message ?? body.error ?? message;
    } catch {
      // Response had no JSON body; keep the generic message.
    }
    throw new ApiError(message, response.status, issues);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; database: string }>("/health"),

  meta: () => request<Meta>("/meta"),

  orders: (date: string, city: string) =>
    request<Order[]>(`/orders?date=${encodeURIComponent(date)}&city=${encodeURIComponent(city)}`),

  drivers: () => request<DriverSuggestion[]>("/drivers"),

  mdcs: () => request<string[]>("/mdcs"),

  trips: (date?: string, city?: string) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (city) params.set("city", city);
    return request<Trip[]>(`/trips?${params.toString()}`);
  },

  tripOrders: (saleOrderIds: number[]) =>
    request<TripOrder[]>(`/trips/orders?ids=${saleOrderIds.join(",")}`),

  createTrip: (payload: CreateTripPayload) =>
    request<{ saved: number; saleOrderIds: number[] }>("/trips", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteTrip: (saleOrderIds: number[]) =>
    request<{ deleted: number }>("/trips", {
      method: "DELETE",
      body: JSON.stringify({ saleOrderIds }),
    }),

  exportUrl: (date?: string, city?: string) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (city) params.set("city", city);
    return `/api/export?${params.toString()}`;
  },
};
