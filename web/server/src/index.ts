import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { router } from "./routes";
import { ping } from "./db";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api", router);

// Central error handler - Express 5 forwards rejected async handlers here.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api error]", error);
  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  });
});

app.listen(config.port, async () => {
  console.log(`PHD Dispatch API listening on http://localhost:${config.port}`);
  try {
    await ping();
    console.log(`Connected to MySQL ${config.db.host}:${config.db.port}/${config.db.database}`);
  } catch (error) {
    console.error("WARNING: could not reach MySQL on startup:", error instanceof Error ? error.message : error);
  }
});
