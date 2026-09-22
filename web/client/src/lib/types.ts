export interface CityOption {
  city: string;
  cityId: number;
}

export interface Meta {
  dates: string[];
  citiesByDate: Record<string, CityOption[]>;
  driverTypes: string[];
  vehicleTypes: string[];
}

export interface Order {
  saleOrderId: number;
  deliveryDate: string;
  cityId: number;
  city: string;
  customerId: number;
  customer: string;
  saleType: string | null;
  tonnage: number | null;
  claimed: boolean;
  claimedBy: { driverName: string; driverContact: string } | null;
}

export interface DriverSuggestion {
  driverName: string;
  driverContact: string;
  lastDriverType: string | null;
  lastVehicleType: string | null;
  orderCount: number;
}

export interface Trip {
  id: string;
  deliveryDate: string;
  city: string;
  driverName: string;
  driverContact: string;
  driverType: string;
  vehicleType: string;
  tripStartTime: string;
  tripEndTime: string;
  tripDistance: number;
  tripCost: number;
  dispatchMdc: string | null;
  remark: string | null;
  numCustomers: number;
  totalTonnage: number;
  saleOrderIds: number[];
}

export interface TripOrder {
  saleOrderId: number;
  customer: string;
  customerId: number;
  saleType: string | null;
  tonnage: number | null;
}

export interface CreateTripPayload {
  deliveryDate: string;
  city: string;
  cityId: number;
  driverName: string;
  driverContact: string;
  driverType: string;
  vehicleType: string;
  tripStartTime: string;
  tripEndTime: string;
  tripDistance: number;
  tripCost: number;
  dispatchMdc: string | null;
  remark: string | null;
  orders: Array<{
    saleOrderId: number;
    customerId: number;
    customer: string;
    saleType: string | null;
  }>;
}

export interface ClaimConflict {
  saleOrderId: number;
  customer: string;
  driverName: string;
}
