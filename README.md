# TransitPulse Backend

Node.js/TypeScript API that wraps LTA DataMall's live datasets (bus arrivals,
train service alerts, platform crowd density) plus app-side state the app
needs but LTA doesn't provide (saved routes, crowdsourced crowding reports,
a disruption-aware reroute suggestion). It's built to replace the Flutter
prototype's hardcoded mock data with a real backend.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set LTA_ACCOUNT_KEY (register at
# https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html)
npm run dev      # ts-node dev server with reload, http://localhost:3000
npm test         # vitest
npm run build && npm start   # production build
```

Without `LTA_ACCOUNT_KEY` set, the server still starts: `/health`,
`/api/saved-routes`, `/api/crowding/report`, and `/api/reroute` (which
degrades to "assume no known disruptions") all work so you can develop the
app against it before you have a key. `/api/arrivals`, `/api/train-alerts`,
and the live half of `/api/crowding` return `503` until the key is set.

## Dev UI

The server also serves a small vanilla HTML/CSS/JS console at `/` (see
`public/`) — not the Flutter app, just a way to click through every endpoint
by hand instead of using curl. Open `http://localhost:3000` after `npm run
dev` to try reroute, arrivals, alerts, crowding, and saved routes from a
browser tab.

## Endpoints

| Method & path | Source | Notes |
|---|---|---|
| `GET /health` | - | liveness + whether an LTA key is configured |
| `GET /api/arrivals/bus/:busStopCode?serviceNo=` | LTA Bus Arrival | real per-bus ETA, load, wheelchair access |
| `GET /api/train-alerts` | LTA Train Service Alerts | current disruption status per line |
| `GET /api/crowding?trainLine=NSL&station=Jurong+East` | LTA PCDRealTime + PCDForecast + our own reports | live level, forecast, and any active crowdsourced reports for that station |
| `POST /api/crowding/report` `{station, level}` | ours | crowdsourced report, expires after 15 min |
| `GET /api/saved-routes` (header `X-Device-Id`) | ours | list a device's saved routes |
| `POST /api/saved-routes` `{originStation, destinationStation, name?}` | ours | save a route |
| `DELETE /api/saved-routes/:id` | ours | remove a saved route |
| `POST /api/reroute` `{origin, destination}` | ours + live alerts | disruption-aware route suggestion (see limitations below) |

## Known limitations - read before demoing

**There is no public LTA DataMall endpoint for real-time MRT/LRT arrival
ETAs** (the "2 min" / "5 min" per-platform countdown the app's home screen
mockup shows). LTA's live Bus Arrival API gives genuine per-vehicle ETAs,
but the equivalent for trains doesn't exist in DataMall - only
`TrainServiceAlerts` (service status) and platform crowd density are
published for rail. If the home screen needs a "next train" figure, the
realistic options are: (a) show bus ETAs where the leg is a bus, (b) show
line status + a rough scheduled-frequency estimate for rail legs (LTA
publishes typical peak/off-peak headways, not live ETAs), or (c) be explicit
in the UI that train timing is an estimate, not live. This wasn't something
to quietly work around - it changes what "real-time arrivals" can honestly
mean for the rail half of a journey.

**The reroute endpoint is an MVP, not the planned routing engine.** It
searches a small hand-picked subgraph of ~18 central interchange stations
(`src/routing/graph.ts`), not the full rail+bus network, and has no persona
weighting yet. It's real Dijkstra over real live disruption data (a
disrupted segment's edges are removed and the path is recomputed), which is
enough to demo the "avoiding X delay near Y, +N min vs usual" flow
end-to-end - but it will return an "unknown station" error for anything
outside that subgraph. `src/routing/routePlanner.ts` defines a
`RoutePlanner` interface so a real multi-modal engine can drop in later
without changing the API route.

**LTA endpoint paths were confirmed via secondary sources, not the primary
PDF.** This sandbox's network egress blocks `datamall.lta.gov.sg`, so
`src/lta/endpoints.ts` paths (in particular `v3/BusArrival`, which LTA
migrated to from the legacy `BusArrivalv2` in mid-2025) should be
double-checked against the current official API User Guide PDF on your own
machine before you rely on this for a demo. If `v3/BusArrival` 404s for your
account, try `BUS_ARRIVAL_LEGACY` in that same file.

**Saved routes and crowd reports are in-memory**, matching the write-up's
own "planned next phase" note about persistent storage - they reset on
server restart and don't scale past one process. The repositories
(`src/repositories/`) are written behind a small interface specifically so
swapping in a real database later doesn't touch the route/service layer.

**No auth yet.** Saved routes are scoped by a client-supplied `X-Device-Id`
header (a UUID the app should generate once and persist locally) rather
than a real account system.

## Architecture notes

- `src/lta/client.ts` - single fetch wrapper for all DataMall calls: adds
  the `AccountKey` header, caches responses per-endpoint at a TTL matched to
  how often LTA actually refreshes that dataset (15s for bus arrivals, ~1min
  for alerts, ~30min for crowd density - the last matching the 30-min
  staleness the write-up's crowding screen already displays), and converts
  non-200s/network errors into typed errors the route layer turns into
  proper HTTP status codes (`503` not configured, `502` upstream failure).
- `src/services/*` - one file per domain, converts LTA's PascalCase schema
  into the DTOs in `src/types/api.ts`.
- `src/routing/*` - the MVP graph + Dijkstra + `RoutePlanner` interface
  described above.
- `src/repositories/*` - in-memory stores behind an interface, for saved
  routes and crowdsourced crowding reports.
