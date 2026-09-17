import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { arrivalsRouter } from "./routes/arrivals";
import { trainAlertsRouter } from "./routes/trainAlerts";
import { crowdingRouter } from "./routes/crowding";
import { savedRoutesRouter } from "./routes/savedRoutes";
import { rerouteRouter } from "./routes/reroute";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());
  app.use(morgan("tiny"));

  app.use("/health", healthRouter);
  app.use("/api/arrivals", arrivalsRouter);
  app.use("/api/train-alerts", trainAlertsRouter);
  app.use("/api/crowding", crowdingRouter);
  app.use("/api/saved-routes", savedRoutesRouter);
  app.use("/api/reroute", rerouteRouter);

  // Minimal HTML/CSS/JS dev UI for poking at the API by hand - not the
  // Flutter app, just something to click around in without curl. See
  // public/app.js.
  app.use(express.static(path.join(__dirname, "../public")));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
