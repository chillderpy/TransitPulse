# TransitPulse

Node.js/TypeScript API that wraps LTA DataMall's live datasets (bus arrivals,
train service alerts, platform crowd density) plus app-side state the app
needs but LTA doesn't provide (saved routes, crowdsourced crowding reports,
a disruption-aware reroute suggestion). It also serves a mobile web
front end (`public/`) directly from this server — see
[What to click first](#what-to-click-first) below.

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
npm run dev      # tsx watch dev server with reload, http://localhost:3000
npm test         # vitest
npm run build && npm start   # production build
```

Without `LTA_ACCOUNT_KEY` set, the server still starts: `/health`,
`/api/saved-routes`, `/api/crowding/report`, and `/api/reroute` (which
degrades to "assume no known disruptions") all work so you can develop the
app against it before you have a key. `/api/arrivals`, `/api/train-alerts`,
and the live half of `/api/crowding` return `503` until the key is set.

### Opening it on a real phone

The server listens on all network interfaces, so any device on the same Wi-Fi can reach it directly — no
tunnel or extra config needed:

```bash
# find your machine's LAN IP
# macOS/Linux:
ipconfig getifaddr en0   || hostname -I
# Windows (PowerShell):
ipconfig
```

Then, on your phone (same Wi-Fi network), open `http://<that-ip>:3000` in
its browser. If you need to test from a different network (e.g. cellular)
or want a shareable HTTPS link, tunnel the port instead:

```bash
npx localtunnel --port 3000
# or: ngrok http 3000
```

## Deploying to Render

`render.yaml` defines this as a single Render **web service** (build:
`npm install && npm run build`, start: `npm start`)

## What to click first

Open `http://localhost:3000` (or `http://<lan-ip>:3000` on a phone — see
above) after `npm run dev`.

After getting a route, **Save route** asks for a name and files it under the
**Saved routes** tab, which lists saved routes only; **Check route** there
re-runs the reroute for that journey. The other tabs (bus arrivals, train
alerts, crowding) are straightforward forms over the corresponding API
endpoint below.

## Endpoints

| Method & path | Source | Notes |
|---|---|---|
| `GET /health` | - | liveness, whether an LTA key is configured, and whether mock-disruption demo scenarios are enabled |
| `GET /api/arrivals/bus/:busStopCode?serviceNo=` | LTA Bus Arrival | real per-bus ETA, load, wheelchair access |
| `GET /api/train-alerts` | LTA Train Service Alerts | current disruption status per line |
| `GET /api/crowding?trainLine=NSL&station=Jurong+East` | LTA PCDRealTime + PCDForecast + our own reports | live level, forecast, and any active crowdsourced reports for that station |
| `POST /api/crowding/report` `{station, level}` | ours | crowdsourced report, expires after 15 min |
| `GET /api/saved-routes` (header `X-Device-Id`) | ours | list a device's saved routes |
| `POST /api/saved-routes` `{originStation, destinationStation, name?, persona?, departPreset?}` | ours | save a route |
| `DELETE /api/saved-routes/:id` | ours | remove a saved route |
| `POST /api/reroute` `{origin, destination, persona?, departAt?, mockDisruption?}` | ours + live alerts + LTA buses/lifts + data.gov.sg weather | disruption- and crowding-aware, persona-weighted, time-of-day-aware, door-to-door, multi-modal (rail+bus+cycle+walk) route suggestion, returning up to 3 ranked alternatives (see below) |
| `GET /api/disruptions/planned?roadName=` | LTA RoadWorks | active planned roadworks, as a signal distinct from live incident status |
| `POST /api/notifications/subscribe` `{webhookUrl, lines?, stations?}` | ours | registers a webhook for proactive disruption/lift-outage alerts (see below) |
| `DELETE /api/notifications/subscribe/:id` | ours | removes a webhook subscription |

### Reroute: door-to-door, multi-modal (rail+bus+cycle+walk), persona-aware

`origin`/`destination` each accept either a station name/code ("Jurong
East", "NS1") **or** a bare `"lat,lon"` pair, so a journey can start/end at
an arbitrary door rather than only at a platform. A coordinate input must fall within Singapore (an approximate boundary polygon in
`src/geo/singaporeBoundary.ts`); anything outside, e.g. Johor Bahru or Batam, is
rejected with a `422` (`400` on `POST /api/saved-routes`). A coordinate input walks
to any station *or bus stop* within 1200m (600m for the `accessible`
persona), and additionally offers cycling out to 3000m (standard persona
only - accessible mode is about reducing physical effort, so it skips
cycling) whenever that beats walking; the response includes each
walking/cycling leg's distance and time.

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

**Multiple ranked alternatives.** Rather than one "optimal" suggestion, the
response's `routes` array holds up to 3 distinct, ranked (fastest-first)
route options, found via Yen's k-shortest-paths algorithm
(`src/routing/multiRouteDijkstra.ts`) run on top of the same Dijkstra core -
a commuter facing a disruption is choosing between several new options, not
comparing old-vs-new. Top-level fields (`totalMinutes`, `steps`, etc.)
mirror `routes[0]` for callers that only want a single suggestion.

**Crowding-aware, not just disruption-aware.** Live per-station platform
crowding (the same `PCDRealTime`/`PCDForecast`-derived data `/api/crowding`
exposes) adds a boarding-cost penalty at highly/moderately crowded
platforms, so the optimizer can choose to board a line one stop
earlier/later - or a different line entirely - when that's worth it. When
this changes the route taken, that option's `crowdingReason` explains why,
distinct from `disruptionReason` (which is about outages).

**Time-of-day aware.** An optional `departAt` (ISO 8601 timestamp,
defaulting to "now") drives peak/off-peak/night classification
(`src/routing/timeOfDay.ts`): rush-hour rail gets a small dwell-time
markup and shorter waits, buses slow down more under peak road traffic,
and late-night journeys use wider train/bus headways. Outside MRT/bus
operating hours, routing degrades to whichever mode(s) are actually
running and `serviceHoursNote` explains why; the response's `timeContext`
reports which period was used.

**Demo-only disruption simulation.** With `ENABLE_MOCK_DISRUPTIONS=true` in
the environment (off by default, so a real deployment can't have its
disruption data spoofed by a caller), `POST /api/reroute` also accepts a
`mockDisruption` scenario name - see `src/services/mockDisruptions.ts` for
the full list (e.g. `ewlBuonaVista`, `ewlPayaLebarBugis`,
`twoLinesEwlCcl`, `networkWideOutage`) - which feeds the planner canned
alert data instead of a live LTA fetch, so the reroute engine's disruption
handling can be shown on demand rather than waiting for (or faking) a real
MRT incident. The frontend's "Simulate disruption" dropdown only appears
when `GET /health` reports `mockDisruptionsEnabled: true`.

`persona` is `"standard"` (default) or `"accessible"`. Accessible mode
shortens the walk-in radius, skips cycling, and cross-references the live
`v2/FacilitiesMaintenance` feed (which lists lifts currently out of service,
not a maintenance schedule, despite its name) against every station on the
route, surfacing an `accessibilityWarnings` entry for each one.

`disruptionDataStatus` says what the disruption check was based on: `live`,
`stale` (LTA errored, so the last good reading was used) or `unavailable` (no
key, or LTA errored with no earlier reading - "no disruptions" is then an
assumption). The reroute endpoint no longer returns `502` for an LTA alerts
outage, since a rush-hour commuter is better served by a flagged route than
by none. Displayed minutes are real travel time: the crowding penalty only
steers which route is chosen.

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
provider (FCM/APNs) and device tokens. A webhook is the equivalent server-to-server building block:
`POST /api/notifications/subscribe` with a `webhookUrl` and, optionally,
the lines/stations to watch (omit both to watch everything). A background
poller (`src/services/notificationService.ts`, started only by the real
server in `server.ts`, not by tests) checks `TrainServiceAlerts` and
`v2/FacilitiesMaintenance` every 60s and `POST`s a
`{type, newlyAffected, detectedAt}` payload to every matching subscription
the moment something *newly* becomes disrupted - not on every poll, only on
a state change, since that's the "proactive" part.

`webhookUrl` must be an `https` URL that resolves to a public address (checked
at subscribe time and before each delivery; redirects are not followed). A
failed LTA poll is skipped rather than treated as "all clear", so an outage
can't cause already-known incidents to be re-announced.
