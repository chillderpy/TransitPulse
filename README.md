# TransitPulse Backend

Node.js/TypeScript API that wraps LTA DataMall's live datasets (bus arrivals,
train service alerts, platform crowd density) plus app-side state the app
needs but LTA doesn't provide (saved routes, crowdsourced crowding reports,
a disruption-aware reroute suggestion). It's built to replace the Flutter
prototype's hardcoded mock data with a real backend, and it also serves the
mobile-first web front end (`public/`) that a commuter opens in their phone's
browser — see [What to click first](#what-to-click-first) below.

## Demo

<!-- PASTE THE DEMO VIDEO LINK HERE before submitting. Record the screen of
     an actual phone (or a phone-sized browser window) walking one real
     journey through one real disruption, per PS2's submission README §6. -->

📺 **Demo video:** _TODO — add link here_

## Prerequisites

- Node.js 18 or later (see `engines` in `package.json`) and npm
- A free LTA DataMall `AccountKey` — register at
  https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html
  (the app runs without one, see below, but the live rail/bus/lift data
  this project is built around needs it)

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

### Opening it on a real phone (this is a mobile-first web app)

PS2 is judged in a **mobile browser on a real phone**, not a resized desktop
window, so don't just check `localhost:3000` in a desktop tab. The server
listens on all network interfaces, so any device on the same Wi-Fi can reach
it directly — no tunnel or extra config needed:

```bash
# find your machine's LAN IP
# macOS/Linux:
ipconfig getifaddr en0   || hostname -I
# Windows (PowerShell):
ipconfig
```

Then, on your phone (same Wi-Fi network), open `http://<that-ip>:3000` in
its browser. If you need to test from a different network (e.g. cellular)
or want a shareable HTTPS link for judges, tunnel the port instead:

```bash
npx localtunnel --port 3000
# or: ngrok http 3000
```

The page already ships a `width=device-width, initial-scale=1` viewport and
same-origin static assets, so no extra setup is needed beyond reaching the
right URL from the phone.

## What to click first

Open `http://localhost:3000` (or `http://<lan-ip>:3000` on a phone — see
above) after `npm run dev`. The **Reroute** tab is the golden path — it's
already pre-filled with Rachel's persona journey (Jurong East → Raffles
Place, EWL). Press **Get route** to see a live, disruption-aware itinerary
rendered on the map, with the usual route shown alongside the live one and
any avoided segment highlighted. Switch the persona dropdown to
**Accessibility-first** to see the same journey re-planned with a shorter
walk-in radius and lift-outage warnings for Mdm Lim.

**Note on the front end:** `public/` is a functional, mobile-reachable
console over every required capability (routing, GIS map, visualisation),
not yet a persona-styled one-screen product — see `WRITEUP.md`'s
Limitations section for why, and the other tabs (bus arrivals, train
alerts, crowding, saved routes) are debugging views over the same API
rather than a separate product.

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
| `POST /api/reroute` `{origin, destination, persona?}` | ours + live alerts + LTA buses/lifts + data.gov.sg weather | disruption-aware, persona-weighted, door-to-door, multi-modal (rail+bus+walk) route suggestion (see below) |
| `GET /api/disruptions/planned?roadName=` | LTA RoadWorks | active planned roadworks, as a signal distinct from live incident status |
| `POST /api/notifications/subscribe` `{webhookUrl, lines?, stations?}` | ours | registers a webhook for proactive disruption/lift-outage alerts (see below) |
| `DELETE /api/notifications/subscribe/:id` | ours | removes a webhook subscription |

### Reroute: door-to-door, multi-modal (rail+bus+walk), persona-aware

`origin`/`destination` each accept either a station name/code ("Jurong
East", "NS1") **or** a bare `"lat,lon"` pair, so a journey can start/end at
an arbitrary door rather than only at a platform. A coordinate input walks
to any station *or bus stop* within 1200m (600m for the `accessible`
persona); the response includes each walking leg's distance and time.

Routing runs Dijkstra (a binary-heap implementation - the graph is
thousands of nodes once bus stops are joined in, where the earlier linear
scan would've been the bottleneck) over the full MRT/LRT-adjacent rail
network **plus a live bus-stop graph** built from LTA's `BusStops` and
`BusRoutes` datasets (~5,200 stops, ~27,000 route-stop entries), joined to
the rail network via walk-transfer edges wherever a bus stop sits within
300m of a station. Bus travel time is a planning-grade estimate (20 km/h
average, from each route's cumulative `Distance` field) since DataMall
doesn't publish inter-stop timetables - the same honest-estimate spirit as
the rail network's own per-line minutes-per-hop constants. The itinerary
collapses consecutive same-line hops into one "ride" step (e.g. `Bus 172
(11 stops, 15.3 min)`) rather than listing every physical stop.

The bus graph is a genuinely large fetch, so it's built lazily and cached
for 6 hours: **the first reroute request after server start takes several
seconds** while it loads; every request after that (within the 6h window)
is fast. If it's unavailable at all (no LTA key, network error), routing
just degrades to rail+walk only rather than failing the request.

`persona` is `"standard"` (default) or `"accessible"`. Accessible mode
shortens the walk-in radius and cross-references the live
`v2/FacilitiesMaintenance` feed (which lists lifts currently out of service,
not a maintenance schedule, despite its name) against every station on the
route, surfacing an `accessibilityWarnings` entry for each one.

The response also includes: `confidenceRangeMinutes` (a range, not one
falsely-precise number, since live transit timing always has some slop);
`usualPath`/`livePath`/`avoidedSegments` as `[lat, lon]` coordinates for
rendering the current route against the undisrupted one and highlighting
what's being avoided; and `weatherAdvisory` when a walking leg is 300m+ and
data.gov.sg's 2-hour forecast calls for rain near that leg (best-effort -
any weather API failure just omits the advisory rather than failing the
request).

### Proactive alerts: webhook subscriptions

A backend can't push an actual phone notification without a mobile push
provider (FCM/APNs) and device tokens, which is outside this project's
scope. A webhook is the equivalent server-to-server building block:
`POST /api/notifications/subscribe` with a `webhookUrl` and, optionally,
the lines/stations to watch (omit both to watch everything). A background
poller (`src/services/notificationService.ts`, started only by the real
server in `server.ts`, not by tests) checks `TrainServiceAlerts` and
`v2/FacilitiesMaintenance` every 60s and `POST`s a
`{type, newlyAffected, detectedAt}` payload to every matching subscription
the moment something *newly* becomes disrupted - not on every poll, only on
a state change, since that's the "proactive" part.

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

**LTA endpoint paths and schemas below have been confirmed against the live
API** (verified 2026-09-17, using the account key in `.env`): `v3/BusArrival`,
`v2/FacilitiesMaintenance` (returns currently-faulty lifts, not a maintenance
calendar, despite the name), `RoadWorks`, `BusStops`, and `BusRoutes` all
match what `src/lta/endpoints.ts` and the corresponding services assume. If
your own account key predates LTA's mid-2025 migration off `BusArrivalv2`
and `v3/BusArrival` 404s, fall back to `BUS_ARRIVAL_LEGACY` in that same
file.

**Saved routes are file-backed** (`data/saved-routes.json`, via
`src/repositories/fileStore.ts` - synchronous read on startup, write after
every mutation; fine for a single-process demo backend, not for multiple
instances sharing state). **Crowd reports and notification subscriptions
stay in-memory on purpose**: a crowd report already expires after 15
minutes, and a webhook subscription only matters while its owner's client
is running to receive it, so neither needs to survive a restart the way a
saved route does. All three repositories sit behind a small interface so
swapping any of them for a real database later doesn't touch the
route/service layer.

**No account system.** Saved routes are scoped by a client-supplied
`X-Device-Id` header (a UUID the app generates once via
`crypto.randomUUID()` and persists locally - see `public/app.js`). The
server now rejects a non-UUID device id outright: since this header is the
*only* access control on saved routes, a short/guessable value would let
one client stumble into another's routes, where a random UUID's keyspace
makes that practically impossible. This is still not real authentication -
anyone who obtains a specific UUID can access that device's routes - just
a meaningfully harder-to-guess identifier than an arbitrary string.

**Not implemented, deliberately, as genuinely out of scope for this
backend**: an AI/LLM layer (structured advice from free text, personalised
duration prediction, a conversational interface) - optional per the brief,
and nothing here would be more than a thin wrapper without real usage data
to ground it; historical origin-destination passenger volume (`PV/*`) as an
"unusual crowd" baseline - LTA publishes this as large monthly CSV/zip
downloads, not a queryable API, which is a data-engineering job in its own
right; and OneMap/data.gov.sg geospatial layers (`CoveredLinkWay`,
`TrainStationExit`, `CyclingPath`, `Footpath`) - these are shapefile/KML
GIS datasets requiring their own parsing pipeline, not JSON endpoints like
everything else this backend consumes.

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
- `src/routing/graph.ts` - the rail network (stations/edges), haversine and
  coordinate-parsing helpers, and the door-to-door walk-in radius logic.
- `src/routing/busGraph.ts` - the lazily-built, 6h-cached bus-stop graph
  (`BusStops` + `BusRoutes`, joined to rail via transfer walk edges).
- `src/routing/dijkstra.ts` - binary-heap Dijkstra (needed once the bus
  graph's thousands of nodes are merged in) + `RoutePlanner` interface.
- `src/routing/routePlanner.ts` - merges the rail and bus graphs per
  request, resolves station/coordinate endpoints, and builds the
  rider-facing itinerary (collapsing same-line hops into one "ride" step).
- `src/repositories/*` - saved routes (file-backed, see above),
  crowdsourced crowding reports and notification subscriptions
  (in-memory), each behind a small interface.
- `src/services/weatherService.ts` - data.gov.sg's 2-hour forecast (a
  separate public host, no key, its own small cache/timeout) used only to
  attach a rain advisory to walking legs.
- `src/services/facilitiesService.ts` / `roadWorksService.ts` - LTA's
  currently-faulty-lifts and active-roadworks feeds, the "planned
  disruption" signals surfaced via accessibility warnings and
  `/api/disruptions/planned` respectively.
- `src/services/notificationService.ts` - the proactive-alert poller
  described above.
