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
import { stationsRouter } from "./routes/stations";
import { disruptionsRouter } from "./routes/disruptions";
import { notificationsRouter } from "./routes/notifications";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(
    helmet({
      // The dev UI renders a Protomaps vector basemap (via protomaps-leaflet):
      // tiles are read with fetch()/Range requests straight from Protomaps'
      // PMTiles build server, so that host needs to be allowed under
      // connect-src. Everything else (Leaflet's own JS/CSS/marker icons,
      // app.js/style.css) is self-hosted under public/ so 'self' still
      // covers it.
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "connect-src": ["'self'", "https://build.protomaps.com"],
        },
      },
    })
  );
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());
  app.use(morgan("tiny"));

  app.use("/health", healthRouter);
  app.use("/api/arrivals", arrivalsRouter);
  app.use("/api/train-alerts", trainAlertsRouter);
  app.use("/api/crowding", crowdingRouter);
  app.use("/api/saved-routes", savedRoutesRouter);
  app.use("/api/reroute", rerouteRouter);
  app.use("/api/stations", stationsRouter);
  app.use("/api/disruptions", disruptionsRouter);
  app.use("/api/notifications", notificationsRouter);

  // Minimal HTML/CSS/JS dev UI for poking at the API by hand - not the
  // Flutter app, just something to click around in without curl. See
  // public/app.js.
  app.use(express.static(path.join(__dirname, "../public")));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
