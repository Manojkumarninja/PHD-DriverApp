import dotenv from "dotenv";

// Resolve .env relative to this file, not the working directory, so the API
// starts the same way whether it is launched from web/ or from web/server/.
dotenv.config({ path: new URL("../.env", import.meta.url) });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy web/server/.env.example to web/server/.env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  db: {
    host: required("DB_HOST"),
    port: Number(required("DB_PORT")),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database: required("DB_NAME"),
  },
  /** Source table: the day's delivery orders (read-only). */
  sourceTable: "PHD_TripDetails",
  /** Output table: one row per delivered order, written by this app. */
  outTable: "PHD_TripDetails_Out",
} as const;

export const DRIVER_TYPES = ["Regular Driver", "Porter Driver"] as const;
export const VEHICLE_TYPES = ["2 Wheeler", "3 Wheeler", "EV", "4 Wheeler"] as const;
