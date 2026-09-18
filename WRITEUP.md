# TransitPulse — Write-up

## Solution Overview

TransitPulse is a smart commuter companion designed for Singapore's rush-hour
commuters. It continuously monitors a commuter's usual route and, when a
disruption affects it, immediately suggests an alternative route so the
commuter does not have to stop and manually search for one.

The prototype supports the full flow from disruption detection → alternative
route suggestion → route saving → turn-by-turn navigation, with crowding
information and accessibility considerations integrated into the journey.

## Personas

**Rachel — Fixed-schedule commuter.** Rachel follows a regular daily route
and wants to know immediately when something changes, without having to
manually re-plan. Her priorities are saving time, reducing stress, staying on
schedule, and travelling comfortably.

**Mdm Lim — Accessibility-conscious commuter.** Mdm Lim wants to avoid
routes that may be difficult to navigate and to be informed when
accessibility issues, such as lift outages, affect her journey. The routing
system can account for accessibility constraints and station lift
availability.

| | Functional | Emotional | Social |
|---|---|---|---|
| Rachel | Fastest time to reach work | Lazy to think how to get to work | Don't want to be judged if late |
| | Enjoy comfort during travel | Too stressed to plan routes | Don't want to look lost finding routes |
| | Save costs | Anxious about spending | Want to look efficient / productive |

## Architecture

The system uses a Node.js/TypeScript/Express backend connected to LTA
DataMall.

```
Frontend → Express API → Services → LTA DataMall
                        ↘ Routing Engine
                        ↘ Repositories
```

- **`src/lta/client.ts` — LTA Data Layer.** Provides a single wrapper for
  all LTA DataMall requests, including authentication, caching, and error
  handling. Each dataset uses a cache duration based on its refresh
  frequency, such as 15s for bus arrivals and ~30min for crowd density.
- **`src/routing/graph.ts` — Rail Network.** Contains Singapore's heavy-rail
  network with station-to-station running times based on LTA's published
  line diagrams. This provides the base rail network used for route
  calculation.
- **`src/routing/busGraph.ts` — Bus Network.** Builds a live bus-stop graph
  from LTA's `BusStops` and `BusRoutes` data and connects nearby bus stops
  to the rail network. The graph is cached for 6 hours to avoid repeatedly
  rebuilding the network.
- **`src/routing/dijkstra.ts` — Route Calculation.** Uses binary-heap
  Dijkstra to find routes across the combined bus and rail network. The
  algorithm accounts for boarding waits when changing or starting a
  bus/train service.
- **`src/routing/routePlanner.ts` — Rerouting Engine.** Calculates both the
  commuter's usual route and the current route with disrupted segments
  removed. It then returns the alternative route, disruption reason,
  estimated time difference, avoided segments, and relevant accessibility
  or weather advisories.
- **`src/routing/timeOfDay.ts` — Time Estimation.** Classifies journeys into
  peak, off-peak, and night periods using Singapore local time. It applies
  different planning-grade travel and boarding-time estimates while
  respecting first/last-service cutoffs.
- **`src/services/*` — Live Data Services.** Handles individual LTA
  datasets including disruptions, crowding, bus arrivals, lift outages, and
  road works, alongside weather and notification services. The
  notification service checks for newly affected routes and sends updates
  to subscribed webhooks.
- **`src/repositories/*` — Data Storage.** Stores saved routes,
  crowdsourced crowding reports, and notification subscriptions behind
  simple repository interfaces. Saved routes persist between restarts,
  while crowd reports and subscriptions are currently stored in memory.
- **`public/` — Frontend Console.** Provides the interactive map-based
  interface using Leaflet and a Protomaps/OpenStreetMap-based map. It
  displays routes, avoided segments, stations, buses, and crowding, while
  allowing users to select their own origin and destination.

LTA data is fetched through a shared client with endpoint-specific caching.
The routing engine combines the Singapore rail network with a live bus-stop
graph and uses Dijkstra's algorithm to calculate routes. When a disruption
is detected, the system compares the usual route with a live route and
returns an alternative together with the disruption reason and estimated
time difference.

## Features

**Input options**
- Able to input current location and destination, and time of departure
- Able to specify preferred bus/train service
- Able to interact with the map directly to specify destination
- Save routes

**Transit route options**
- Multimodal routing that combines multiple forms of transit
- Real-time data integration that shows a live estimate of travel time
- Service alerts that warn users of route disruptions

**Live updates**
- Refresh on train alerts and crowding in specific areas
- Reroutes based on user request or route disruption

## Assumptions

- **Bus travel time** is estimated using an average 20 km/h, derived from
  each route's cumulative distance, because LTA does not provide inter-stop
  bus timetables.
- **Boarding waits** are planning-grade constants based on commonly cited
  headway ranges.
- **Rail travel time** is based on LTA's published station-running-time
  diagrams.
- **Walking time** is currently estimated using straight-line distance and
  a fixed walking pace rather than the actual pedestrian network.
- **Confidence range** is shown instead of presenting estimated journey
  times as falsely precise.

## Limitations

- LTA does not provide a real-time MRT/LRT arrival ETA feed, so rail arrival
  figures are estimates rather than live countdowns.
- Walking routes currently use straight-line distance rather than OSM
  pedestrian paths.
- Saved routes are file-backed, while crowd reports and subscriptions are
  currently in-memory.
- There is no account/authentication system yet.
- Persona-weighted comfort vs. travel speed vs. shelter scoring is not yet
  implemented.
- The `public/` console is a functional debugging/demo interface covering
  every mandatory capability, not yet the persona-styled, one-thumb mobile
  product the brief describes for Rachel and Mdm Lim individually.

## What's next

In priority order, given the gaps above:

1. Route walking legs over OSM's actual pedestrian layer (`Footpath`,
   `CoveredLinkWay`, `TrainStationExit`) instead of haversine, since that's
   the concrete GIS-requirement gap.
2. A persona-weighted scoring layer (speed vs. comfort vs. shelter) rather
   than only a binary standard/accessible split.
3. A real database behind saved routes/subscriptions once this needs to run
   as more than one process.
