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
import { basemapRouter } from "./routes/basemap";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(
    helmet({
      // The dev UI renders a Protomaps vector basemap (via protomaps-leaflet),
      // read with fetch()/Range requests proxied through our own
      // /api/basemap route (see src/routes/basemap.ts) rather than straight
      // from Protomaps' PMTiles build server - that host never sends CORS
      // headers, so a direct browser fetch is blocked everywhere regardless
      // of network. Proxying keeps this same-origin, so 'self' already
      // covers it under connect-src.
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // app.js falls back to OpenStreetMap's raster tiles (loaded as
          // plain <img> tiles by Leaflet) if even the proxied basemap can't
          // be reached, so img-src needs that host too - otherwise the CSP
          // silently blocks the fallback tiles and the map is just blank.
          "img-src": ["'self'", "data:", "https://*.tile.openstreetmap.org"],
          // Helmet's defaults include upgrade-insecure-requests, which tells
          // the browser to silently rewrite every subresource request (CSS,
          // JS, tile fetches) to https:// - harmless on localhost (treated
          // as a secure origin already) but fatal when this plain-http dev
          // server is reached over LAN by IP (e.g. from a phone): the
          // upgraded https:// requests have nothing listening and fail,
          // leaving an unstyled page with no map. This server has no TLS
          // listener, so that upgrade is never appropriate here.
          "upgrade-insecure-requests": null,
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
  app.use("/api/basemap", basemapRouter);

  // Minimal HTML/CSS/JS dev UI for poking at the API by hand - not the
  // Flutter app, just something to click around in without curl. See
  // public/app.js.
  app.use(express.static(path.join(__dirname, "../public")));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
