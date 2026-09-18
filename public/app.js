const API = ""; // same origin - this page is served by the backend itself

// ==================== map setup ====================
const map = L.map("map", { zoomControl: false }).setView([1.3521, 103.8198], 12);
L.control.zoom({ position: "topright" }).addTo(map);

// Vector basemap via protomaps-leaflet, reading a Protomaps daily basemap
// build directly over HTTP range requests (no tile server needed - and no
// dependency on the OpenStreetMap raster tile hosts, which some networks
// block). Protomaps only retains each dated build for about a week, so a
// hardcoded filename goes stale on its own - instead we probe today's build
// and walk backwards until one resolves, and fall back to an OSM-derived
// raster basemap entirely if no recent build is reachable (e.g. offline
// during dev, or every build in range has aged out).
const PMTILES_ATTRIBUTION =
  '&copy; <a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const RASTER_FALLBACK_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function pmtilesUrlForDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `https://build.protomaps.com/${y}${m}${d}.pmtiles`;
}

async function pmtilesUrlExists(url) {
  try {
    // A ranged GET exercises the same access pattern protomaps-leaflet itself
    // uses to read the file, so a 200/206 here means the layer will work.
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    return res.ok;
  } catch {
    return false;
  }
}

async function findRecentPmtilesUrl(maxDaysBack = 14) {
  const today = new Date();
  for (let i = 0; i < maxDaysBack; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    const url = pmtilesUrlForDate(date);
    if (await pmtilesUrlExists(url)) return url;
  }
  return null;
}

(async function initBasemap() {
  const url = await findRecentPmtilesUrl();
  if (url) {
    protomapsL
      .leafletLayer({ url, flavor: "light", lang: "en", attribution: PMTILES_ATTRIBUTION })
      .addTo(map);
    return;
  }
  // No dated build in the last two weeks resolved - fall back to
  // OpenStreetMap's own raster tiles rather than showing a blank map.
  // (CARTO's free basemaps, used here previously, now require signup and
  // watermark unauthenticated tiles with "API KEY REQUIRED" - see
  // https://carto.com/basemaps/apikey - so they're no longer a usable
  // fallback.) This is a last-resort path only (Protomaps is the normal
  // basemap), so the occasional extra load on OSM's tile servers is
  // acceptable despite PS2's general preference for avoiding them.
  console.warn(
    "No recent Protomaps build reachable; falling back to OpenStreetMap's raster tiles."
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    subdomains: "abc",
    maxZoom: 19,
    attribution: RASTER_FALLBACK_ATTRIBUTION,
  }).addTo(map);
})();

const stationsLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const crowdingLayer = L.layerGroup().addTo(map);
const busLayer = L.layerGroup().addTo(map);
const pickLayer = L.layerGroup().addTo(map);

// ==================== pick origin/destination by clicking the map ====================
// Lets a journey start/end at an arbitrary door (not just a station) by
// dropping a pin, rather than requiring the user to already know and type
// exact coordinates - the "lat,lon" input format alone was real but not
// discoverable.
let pickingRole = null; // null | "origin" | "destination"
const pickMarkers = { origin: null, destination: null };

function formatCoordinate(lat, lon) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function setPicking(role) {
  pickingRole = pickingRole === role ? null : role;
  document.getElementById("pick-origin").classList.toggle("active", pickingRole === "origin");
  document.getElementById("pick-destination").classList.toggle("active", pickingRole === "destination");
  document.getElementById("map").classList.toggle("picking", !!pickingRole);
}

function placePickMarker(role, lat, lon) {
  if (pickMarkers[role]) pickLayer.removeLayer(pickMarkers[role]);
  const className = role === "origin" ? "endpoint-dot endpoint-origin" : "endpoint-dot endpoint-destination";
  const marker = L.marker([lat, lon], { icon: stationIcon(className, 16), draggable: true });
  marker.bindPopup(`<b>${role === "origin" ? "Origin" : "Destination"}</b><div class="hint">Drag to adjust</div>`);
  marker.on("drag", (e) => {
    const pos = e.target.getLatLng();
    document.getElementById(role === "origin" ? "input-origin" : "input-destination").value = formatCoordinate(pos.lat, pos.lng);
  });
  marker.addTo(pickLayer);
  pickMarkers[role] = marker;
}

map.on("click", (e) => {
  if (!pickingRole) return;
  const { lat, lng } = e.latlng;
  document.getElementById(pickingRole === "origin" ? "input-origin" : "input-destination").value = formatCoordinate(lat, lng);
  placePickMarker(pickingRole, lat, lng);
  setActiveTab("reroute");
  setPicking(null);
});

document.getElementById("pick-origin").addEventListener("click", () => setPicking("origin"));
document.getElementById("pick-destination").addEventListener("click", () => setPicking("destination"));

// name (uppercased) -> {code, name, lat, lon}
const stationsByName = new Map();

function stationIcon(className, size) {
  return L.divIcon({ className, iconSize: [size, size] });
}

async function loadStations() {
  try {
    const data = await callApi("/api/stations");
    data.stations.forEach((s) => {
      stationsByName.set(s.name.toUpperCase(), s);
      const marker = L.marker([s.lat, s.lon], { icon: stationIcon("station-dot", 10) });
      marker.bindPopup(
        `<b>${escapeHtml(s.name)}</b>
        <div class="popup-actions">
          <button type="button" data-role="origin">Set as origin</button>
          <button type="button" data-role="destination">Set as destination</button>
        </div>`
      );
      marker.on("popupopen", (e) => {
        const el = e.popup.getElement();
        el.querySelector('[data-role="origin"]').addEventListener("click", () => {
          setActiveTab("reroute");
          document.getElementById("input-origin").value = s.name;
          marker.closePopup();
        });
        el.querySelector('[data-role="destination"]').addEventListener("click", () => {
          setActiveTab("reroute");
          document.getElementById("input-destination").value = s.name;
          marker.closePopup();
        });
      });
      marker.addTo(stationsLayer);
    });
  } catch (err) {
    console.error("Failed to load stations for map", err);
  }
}
loadStations();

function findStationCoords(name) {
  return stationsByName.get((name || "").trim().toUpperCase()) || null;
}

// ==================== tabs / panel ====================
function setActiveTab(tabName) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tabName}`));
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

document.getElementById("panel-toggle").addEventListener("click", () => {
  document.getElementById("overlay-panel").classList.add("collapsed");
  document.getElementById("panel-reopen").classList.remove("hidden");
});
document.getElementById("panel-reopen").addEventListener("click", () => {
  document.getElementById("overlay-panel").classList.remove("collapsed");
  document.getElementById("panel-reopen").classList.add("hidden");
});

// ---- device id for saved routes ----
// crypto.randomUUID() only exists in secure contexts (https, or localhost) -
// opening this page over plain http://<lan-ip> (e.g. from a phone on the
// same Wi-Fi) is an insecure context, so it's undefined there and the old
// fallback (`dev-${timestamp}-...`) isn't UUID-shaped, which the backend's
// X-Device-Id validation rejects. crypto.getRandomValues has no such
// restriction, so build a proper v4 UUID from that instead.
function generateUuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDeviceId() {
  let id = localStorage.getItem("transitpulse-device-id");
  // A device that generated its id before this fix (or whose randomUUID()
  // was unavailable in an insecure context) may have a non-UUID value
  // already cached - the backend rejects that on every request, so replace
  // it rather than trusting anything already stored.
  if (!id || !UUID_RE.test(id)) {
    id = generateUuidV4();
    localStorage.setItem("transitpulse-device-id", id);
  }
  return id;
}

// ---- connectivity banner ----
// A fixed pill above the map, shown on the `offline` window event, on a
// fetch that couldn't reach the server at all (callApi below), or if the
// page loads already offline - and hidden again on `online` or the next
// successful callApi() call.
const connectivityBanner = document.getElementById("connectivity-banner");
let isOffline = false;
function setOffline(offline) {
  if (offline === isOffline) return;
  isOffline = offline;
  connectivityBanner.classList.toggle("hidden", !offline);
}
window.addEventListener("online", () => setOffline(false));
window.addEventListener("offline", () => setOffline(true));
if (!navigator.onLine) setOffline(true);

// Thrown by callApi() when the request itself couldn't complete (no
// connection, DNS/timeout failure) - distinct from an Error thrown for an
// HTTP error response, which did reach the server and has a real message.
// Callers use this to decide between an "offline" message and a normal one.
class NetworkError extends Error {}

function isNetworkError(err) {
  return err instanceof NetworkError;
}

// ---- tiny localStorage cache for read endpoints, so a lost connection can
// still show *something* instead of a bare error ----
function cacheSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage can throw (private mode, quota) - caching is a nice-to-have.
  }
}
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function formatCacheAge(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return mins < 1 ? "just now" : `${mins} min ago`;
}
function offlineCacheNote(ts) {
  return `<div class="note">⚠️ Offline — showing data from ${formatCacheAge(ts)}.</div>`;
}
function showOfflineMessage(el, message) {
  el.innerHTML = `<div class="offline-message">📡 ${escapeHtml(message)}</div>`;
}

// ---- helpers ----
async function callApi(path, options = {}) {
  // A hung request on a flaky tunnel connection would otherwise leave
  // "Loading…" on screen forever - abort and treat it the same as offline.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(API + path, {
      ...options,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
  } catch (err) {
    setOffline(true);
    throw new NetworkError(err.name === "AbortError" ? "Request timed out." : "Couldn't reach the server.");
  } finally {
    clearTimeout(timeoutId);
  }
  setOffline(false);
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (body && body.error) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body;
}

// Some backend errors surface server-config details (e.g. a missing LTA
// API key) that are meaningful to whoever runs this server, not to
// someone using it - swap those for a plain "try again later" message.
function userFacingMessage(message) {
  if (/LTA_ACCOUNT_KEY|LTA DataMall/i.test(message || "")) {
    return "This live data isn't available right now. Please try again later.";
  }
  return message;
}

function showError(el, err) {
  el.innerHTML = `<div class="error">${escapeHtml(userFacingMessage(err.message) || String(err))}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function pillClass(level) {
  return `pill pill-${(level || "unknown").toLowerCase()}`;
}

// ---- health badge ----
// Stays hidden when everything's fine; only speaks up if the app can't
// reach its server at all, so it reads like a status alert, not a debug
// readout.
async function refreshHealth() {
  const badge = document.getElementById("health-badge");
  const mockDisruptionField = document.getElementById("mock-disruption-field");
  try {
    const data = await callApi("/health");
    badge.textContent = "";
    badge.className = "badge badge-unknown hidden";
    // Stays hidden unless the server actually has ENABLE_MOCK_DISRUPTIONS=true -
    // showing a control that would just 400 on submit is worse than not
    // showing it, and a real deployment normally has this off (see env.ts).
    mockDisruptionField.classList.toggle("hidden", !data.mockDisruptionsEnabled);
  } catch (err) {
    badge.textContent = "Can't connect right now";
    badge.className = "badge badge-down";
    mockDisruptionField.classList.add("hidden");
  }
}
refreshHealth();

// ==================== reroute ====================
function drawRoute(data) {
  routeLayer.clearLayers();
  pickLayer.clearLayers(); // the route's own origin/destination markers replace any picked pins
  pickMarkers.origin = null;
  pickMarkers.destination = null;

  // Usual (undisrupted) path drawn first, dashed and muted, so the live
  // path can be compared against it - "here's what you'd normally take"
  // vs "here's what you're taking now", per PS2's before/after ask.
  const usualDiffersFromLive = JSON.stringify(data.usualPath) !== JSON.stringify(data.livePath);
  if (usualDiffersFromLive && data.usualPath.length >= 2) {
    L.polyline(data.usualPath, { color: "#8b90a0", weight: 4, opacity: 0.6, dashArray: "6 8" }).addTo(routeLayer);
  }

  // Segments of the usual route being avoided due to disruption, highlighted red.
  (data.avoidedSegments || []).forEach(([from, to]) => {
    L.polyline([from, to], { color: "#ff5c5c", weight: 5, opacity: 0.9, dashArray: "2 6" }).addTo(routeLayer);
  });

  if (data.livePath.length >= 2) {
    const line = L.polyline(data.livePath, {
      color: usualDiffersFromLive ? "#e6a53c" : "#4f8cff",
      weight: 5,
      opacity: 0.9,
    }).addTo(routeLayer);
    fitBoundsAvoidingPanel(line.getBounds());
  } else if (data.livePath.length === 1) {
    map.setView(data.livePath[0], 15);
  }

  data.steps.forEach((step) => {
    if (step.mode === "origin") {
      L.marker([step.lat, step.lon], { icon: stationIcon("endpoint-dot endpoint-origin", 16) })
        .bindPopup(`<b>${escapeHtml(step.station)}</b><div class="hint">Origin</div>`)
        .addTo(routeLayer);
    } else if (step.mode === "destination") {
      L.marker([step.lat, step.lon], { icon: stationIcon("endpoint-dot endpoint-destination", 16) })
        .bindPopup(`<b>${escapeHtml(step.station)}</b><div class="hint">Destination</div>`)
        .addTo(routeLayer);
    } else if (step.mode === "walk") {
      L.marker([step.lat, step.lon], { icon: stationIcon("walk-dot", 10) })
        .bindPopup(`<b>${escapeHtml(step.station)}</b><div class="hint">${escapeHtml(step.note)}</div>`)
        .addTo(routeLayer);
    } else if (step.mode === "cycle") {
      L.marker([step.lat, step.lon], { icon: stationIcon("cycle-dot", 10) })
        .bindPopup(`<b>${escapeHtml(step.station)}</b><div class="hint">${escapeHtml(step.note)}</div>`)
        .addTo(routeLayer);
    } else if (step.mode === "bus") {
      L.marker([step.lat, step.lon], { icon: stationIcon("bus-dot", 12) })
        .bindPopup(`<b>${escapeHtml(step.station)}</b><div class="hint">${escapeHtml(step.note)}</div>`)
        .addTo(routeLayer);
    }
  });
}

// Keeps fitted content clear of the floating control panel - on a wide
// viewport that's a ~400px side panel on the left, but on a phone
// (<=640px, see style.css's mobile breakpoint) the panel is a bottom sheet
// instead, so the occluded edge is the bottom, not the left.
function isMobileLayout() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function fitBoundsAvoidingPanel(bounds) {
  const panelVisible = !document.getElementById("overlay-panel").classList.contains("collapsed");
  if (isMobileLayout()) {
    const sheetHeight = panelVisible ? Math.round(window.innerHeight * 0.72) : 60;
    map.fitBounds(bounds, {
      paddingTopLeft: [20, 20],
      paddingBottomRight: [20, sheetHeight],
    });
    return;
  }
  map.fitBounds(bounds, {
    paddingTopLeft: [panelVisible ? 420 : 60, 60],
    paddingBottomRight: [60, 60],
  });
}

function setViewAvoidingPanel(latlng, zoom) {
  const panelVisible = !document.getElementById("overlay-panel").classList.contains("collapsed");
  map.setView(latlng, zoom, { animate: false });
  if (!panelVisible) return;
  if (isMobileLayout()) {
    map.panBy([0, -Math.round(window.innerHeight * 0.36)], { animate: false });
  } else {
    map.panBy([-190, 0], { animate: false });
  }
}

// Demo presets for the "Depart" picker: rather than a full datetime input,
// each option jumps to a wall-clock time in Singapore that lands in the
// matching bucket the backend's timeOfDay classifier uses (see
// src/routing/timeOfDay.ts) - peak presets are pinned to the next weekday
// so picking "Morning peak" always lands there even on a weekend.
const DEPART_PRESETS = {
  amPeak: { hour: 8, minute: 0, weekdayOnly: true },
  pmPeak: { hour: 18, minute: 30, weekdayOnly: true },
  offPeak: { hour: 13, minute: 0, weekdayOnly: false },
  night: { hour: 0, minute: 30, weekdayOnly: false },
};

function presetDepartAtIso(preset) {
  const cfg = DEPART_PRESETS[preset];
  if (!cfg) return null;
  // Built against UTC calendar fields with an explicit +08:00 offset, so
  // the resulting instant is that clock time in Singapore regardless of
  // the browser's own timezone.
  const day = new Date();
  if (cfg.weekdayOnly) {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
      day.setUTCDate(day.getUTCDate() + 1);
    }
  }
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");
  const hh = String(cfg.hour).padStart(2, "0");
  const mm = String(cfg.minute).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:00+08:00`;
}

const TIME_CONTEXT_ICONS = { amPeak: "🌅", pmPeak: "🌇", night: "🌙", offPeak: "🕐" };
const DEPART_PRESET_LABELS = {
  amPeak: "Morning peak",
  pmPeak: "Evening peak",
  offPeak: "Midday off-peak",
  night: "Late night",
};

let lastRerouteResult = null;

// The API labels a picked-on-map point as "Your location" rather than
// returning its coordinates, since that's meant as a display label, not
// an identifier - fine for showing the route just planned, but useless
// for saving (every pin would collapse to the same name and "Show" would
// have nothing to route back to). Fall back to the raw "lat,lon" string
// that was actually submitted so the saved route still points somewhere.
function saveableEndpoint(resolvedLabel, rawInput) {
  return resolvedLabel === "Your location" ? rawInput : resolvedLabel;
}

async function saveCurrentRoute() {
  if (!lastRerouteResult) return;
  const btn = document.getElementById("save-route-btn");
  const originStation = saveableEndpoint(lastRerouteResult.originStation, lastRerouteResult.requestOrigin);
  const destinationStation = saveableEndpoint(lastRerouteResult.destinationStation, lastRerouteResult.requestDestination);
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await callApi("/api/saved-routes", {
      method: "POST",
      headers: { "x-device-id": getDeviceId() },
      body: JSON.stringify({
        name: `${originStation} → ${destinationStation}`,
        originStation,
        destinationStation,
        persona: lastRerouteResult.requestPersona,
        ...(lastRerouteResult.requestDepartPreset ? { departPreset: lastRerouteResult.requestDepartPreset } : {}),
      }),
    });
    btn.textContent = "Saved ✓";
    loadSavedRoutes();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Save this route";
    document.getElementById("save-route-error").textContent = userFacingMessage(err.message);
  }
}

// A disrupted commuter is choosing between several new optimal routes, not
// between the old route and one new one (see RerouteSuggestionDto.routes) -
// this renders that choice as a row of tappable option cards above the
// summary, one per ranked route, so a route with more than one viable
// option is actually explorable in the demo rather than only ever showing
// the fastest.
function buildRoutePickerHtml(routes, selectedId) {
  if (!routes || routes.length <= 1) return "";
  const cards = routes
    .map((r, i) => {
      const rank = i === 0 ? "Fastest" : `Option ${i + 1}`;
      const transferLabel = `${r.transfers} transfer${r.transfers === 1 ? "" : "s"}`;
      return `<button type="button" class="route-option-btn${r.id === selectedId ? " active" : ""}" data-route-id="${r.id}" role="tab" aria-selected="${r.id === selectedId}">
        <span class="route-option-rank">${rank}</span>
        <span class="route-option-time">${r.totalMinutes} min</span>
        <span class="route-option-meta">${transferLabel}</span>
      </button>`;
    })
    .join("");
  return `<div class="route-picker" role="tablist" aria-label="Route options">${cards}</div>`;
}

// Renders one selected route option (steps, summary, map) - `data` carries
// the fields shared across every option (usualPath/usualMinutes/
// timeContext/serviceHoursNote/the full routes list), `option` carries the
// fields specific to the one currently picked (steps/livePath/
// avoidedSegments/totalMinutes/etc, see RouteOptionDto).
function renderRouteOption(data, option) {
  const el = document.getElementById("result-reroute");
  const stepsHtml = option.steps
    .map((s) => `<li><span>${s.order}. ${escapeHtml(s.station)}</span><span class="hint">${escapeHtml(s.note)}</span></li>`)
    .join("");
  const warningsHtml = (option.accessibilityWarnings || [])
    .map((w) => `<div class="pill pill-disrupted" style="display:block;margin-top:6px">${escapeHtml(w)}</div>`)
    .join("");
  const timeIcon = TIME_CONTEXT_ICONS[data.timeContext?.period] || "🕐";
  el.innerHTML = `
    ${buildRoutePickerHtml(data.routes, option.id)}
    <div class="summary-row">
      <div><b>${option.confidenceRangeMinutes.min}–${option.confidenceRangeMinutes.max} min</b>estimated</div>
      <div><b>${data.usualMinutes} min</b>usual</div>
      <div><b>${option.deltaMinutes >= 0 ? "+" : ""}${option.deltaMinutes} min</b>vs usual</div>
      <div><b>${option.transfers}</b>transfers</div>
    </div>
    ${data.timeContext ? `<div class="pill pill-normal">${timeIcon} ${escapeHtml(data.timeContext.label)} timing</div>` : ""}
    ${data.serviceHoursNote ? `<div class="pill pill-medium" style="display:block;margin-top:6px">🕒 ${escapeHtml(data.serviceHoursNote)}</div>` : ""}
    ${option.disruptionReason ? `<div class="pill pill-disrupted">🚧 ${escapeHtml(option.disruptionReason)}</div>` : `<div class="pill pill-normal">No known disruption on this route</div>`}
    ${option.crowdingReason ? `<div class="pill pill-medium" style="display:block;margin-top:6px">👥 ${escapeHtml(option.crowdingReason)}</div>` : ""}
    ${option.weatherAdvisory ? `<div class="pill pill-medium" style="display:block;margin-top:6px">☔ ${escapeHtml(option.weatherAdvisory.message)}</div>` : ""}
    ${warningsHtml}
    ${
      JSON.stringify(data.usualPath) !== JSON.stringify(option.livePath) && data.usualPath.length >= 2
        ? `<div class="route-legend"><span><i class="swatch swatch-live"></i>Route you're taking (${option.totalMinutes} min)</span><span><i class="swatch swatch-usual"></i>Usual route (${data.usualMinutes} min)</span><span><i class="swatch swatch-avoided"></i>Segment avoided</span></div>`
        : ""
    }
    <ul class="steps" style="margin-top:12px">${stepsHtml}</ul>
    <button type="button" id="save-route-btn" style="margin-top:12px">Save this route</button>
    <div id="save-route-error" class="error" style="display:inline-block;margin-left:8px"></div>
  `;
  document.getElementById("save-route-btn").addEventListener("click", saveCurrentRoute);
  drawRoute({ ...data, ...option });
}

// Event delegation on the (stable) result container, rather than binding a
// listener per option button - the container's innerHTML is replaced on
// every render, which would otherwise leak listeners or silently drop them.
document.getElementById("result-reroute").addEventListener("click", (e) => {
  const btn = e.target.closest(".route-option-btn");
  if (!btn || !lastRerouteResult) return;
  const option = lastRerouteResult.routes.find((r) => r.id === btn.dataset.routeId);
  if (option) renderRouteOption(lastRerouteResult, option);
});

async function submitReroute(origin, destination, persona, departPreset, mockDisruption) {
  const el = document.getElementById("result-reroute");
  el.textContent = "Loading…";
  lastRerouteResult = null;
  try {
    const departAt = presetDepartAtIso(departPreset);
    const data = await callApi("/api/reroute", {
      method: "POST",
      body: JSON.stringify({
        origin,
        destination,
        persona: persona || "standard",
        ...(departAt ? { departAt } : {}),
        ...(mockDisruption ? { mockDisruption } : {}),
      }),
    });
    lastRerouteResult = {
      ...data,
      requestOrigin: origin,
      requestDestination: destination,
      requestPersona: persona || "standard",
      requestDepartPreset: departPreset || null,
    };
    renderRouteOption(lastRerouteResult, data.routes[0]);
  } catch (err) {
    lastRerouteResult = null;
    // Reroute is point-in-time (based on live disruption/crowding data), so
    // there's no sensible cached fallback - just say plainly that it needs
    // a connection, rather than showing stale directions as if current.
    if (isNetworkError(err)) {
      showOfflineMessage(el, "You're offline — can't plan a route right now.");
    } else {
      showError(el, err);
    }
  }
}

document.getElementById("form-reroute").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  submitReroute(
    form.get("origin"),
    form.get("destination"),
    form.get("persona"),
    form.get("departAt"),
    form.get("mockDisruption")
  );
});

// ==================== bus arrivals ====================
document.getElementById("form-arrivals").addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("result-arrivals");
  el.textContent = "Loading…";
  busLayer.clearLayers();
  const form = new FormData(e.target);
  const serviceNo = form.get("serviceNo");
  const query = serviceNo ? `?serviceNo=${encodeURIComponent(serviceNo)}` : "";
  try {
    const data = await callApi(`/api/arrivals/bus/${encodeURIComponent(form.get("busStopCode"))}${query}`);
    if (data.services.length === 0) {
      el.innerHTML = `<div class="hint">No services reported at this stop right now.</div>`;
      return;
    }
    el.innerHTML = data.services
      .map(
        (svc) => `
      <div style="margin-bottom:10px">
        <b>Bus ${escapeHtml(svc.serviceNo)}</b> (${escapeHtml(svc.operator)})
        <ul class="steps">
          ${svc.nextArrivals
            .map(
              (a) =>
                `<li><span>${a.etaMinutes ?? "?"} min</span><span class="hint">${a.load.replace("_", " ")} · ${a.busType}${a.wheelchairAccessible ? " · wheelchair accessible" : ""}</span></li>`
            )
            .join("")}
        </ul>
      </div>`
      )
      .join("");

    const busPoints = [];
    data.services.forEach((svc) => {
      svc.nextArrivals.forEach((a) => {
        if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)) return;
        busPoints.push([a.latitude, a.longitude]);
        L.marker([a.latitude, a.longitude], { icon: stationIcon("bus-dot", 12) })
          .bindPopup(`<b>Bus ${escapeHtml(svc.serviceNo)}</b><div class="hint">${a.etaMinutes ?? "?"} min · ${a.load.replace("_", " ")}</div>`)
          .addTo(busLayer);
      });
    });
    if (busPoints.length >= 2) {
      fitBoundsAvoidingPanel(L.latLngBounds(busPoints));
    } else if (busPoints.length === 1) {
      // fitBounds on a single-point (zero-area) bounds computes an invalid
      // zoom with this panel's asymmetric padding and permanently corrupts
      // the map (every future render goes to NaN) - setView sidesteps the
      // degenerate bounds case entirely, same as drawRoute does for a
      // single-point livePath.
      setViewAvoidingPanel(busPoints[0], 15);
    }
  } catch (err) {
    // Bus arrival ETAs are live/point-in-time like reroute - a cached ETA
    // from 10 minutes ago is actively misleading, so say "offline" plainly
    // rather than showing stale numbers as if current.
    if (isNetworkError(err)) {
      showOfflineMessage(el, "You're offline — can't fetch live bus arrivals right now.");
    } else {
      showError(el, err);
    }
  }
});

// ==================== train alerts ====================
const TRAIN_ALERTS_CACHE_KEY = "transitpulse-cache-train-alerts";

function renderTrainAlerts(el, data, cachedTs) {
  const staleNote = cachedTs ? offlineCacheNote(cachedTs) : "";
  const advisoriesHtml = (data.generalAdvisories || [])
    .map((m) => `<div class="advisory advisory-medium">${escapeHtml(m)}</div>`)
    .join("");
  if (data.overallStatus === "normal") {
    el.innerHTML = `${staleNote}<span class="pill pill-normal">All lines normal</span>${advisoriesHtml ? `<div style="margin-top:10px">${advisoriesHtml}</div>` : ""}`;
    return;
  }
  el.innerHTML = staleNote + advisoriesHtml + data.lines
    .map(
      (l) => `
    <div style="margin-bottom:10px">
      <span class="pill pill-disrupted">${escapeHtml(l.line)}</span>
      ${l.affectedStations.length ? `<div class="hint">Affected: ${l.affectedStations.map(escapeHtml).join(", ")}</div>` : ""}
      ${l.messages.map((m) => `<div class="hint">${escapeHtml(m)}</div>`).join("")}
    </div>`
    )
    .join("");
}

document.getElementById("btn-alerts").addEventListener("click", async () => {
  const el = document.getElementById("result-alerts");
  el.textContent = "Loading…";
  try {
    const data = await callApi("/api/train-alerts");
    cacheSet(TRAIN_ALERTS_CACHE_KEY, data);
    renderTrainAlerts(el, data);
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = cacheGet(TRAIN_ALERTS_CACHE_KEY);
      if (cached) {
        renderTrainAlerts(el, cached.data, cached.ts);
      } else {
        showOfflineMessage(el, "You're offline and there's no cached train alert data yet.");
      }
      return;
    }
    showError(el, err);
  }
});

// ==================== crowding ====================
function crowdingCacheKey(stationName) {
  return `transitpulse-cache-crowding-${(stationName || "").trim().toUpperCase()}`;
}

function renderCrowding(el, stationName, data, cachedTs) {
  const staleNote = cachedTs ? offlineCacheNote(cachedTs) : "";
  const staleness =
    data.live.staleForSeconds != null ? `updated ${Math.round(data.live.staleForSeconds / 60)} min ago` : "no live reading";
  el.innerHTML = `
    ${staleNote}
    <div><span class="${pillClass(data.live.level)}">${data.live.level}</span> <span class="hint">${staleness}</span></div>
    ${
      data.crowdsourced.length
        ? `<div class="hint" style="margin-top:8px">Crowdsourced: ${data.crowdsourced
            .map((r) => `<span class="${pillClass(r.level)}">${r.level}</span>`)
            .join(" ")}</div>`
        : ""
    }
    ${
      data.forecast.length
        ? `<ul class="steps" style="margin-top:10px">${data.forecast
            .filter((f) => new Date(f.end).getTime() > Date.now())
            .slice(0, 6)
            .map(
              (f) =>
                `<li><span>${new Date(f.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span class="${pillClass(f.level)}">${f.level}</span></li>`
            )
            .join("")}</ul>`
        : ""
    }
  `;

  crowdingLayer.clearLayers();
  const coords = findStationCoords(stationName);
  if (coords) {
    L.marker([coords.lat, coords.lon], { icon: stationIcon(`crowd-dot crowd-${data.live.level}`, 20) })
      .bindPopup(`<b>${escapeHtml(coords.name)}</b><div class="hint">${escapeHtml(data.live.level)} crowding</div>`)
      .addTo(crowdingLayer)
      .openPopup();
    setViewAvoidingPanel([coords.lat, coords.lon], 15);
  }
}

document.getElementById("form-crowding").addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("result-crowding");
  el.textContent = "Loading…";
  const form = new FormData(e.target);
  const stationName = form.get("station");
  const cacheKey = crowdingCacheKey(stationName);
  try {
    const data = await callApi(`/api/crowding?station=${encodeURIComponent(stationName)}`);
    cacheSet(cacheKey, data);
    renderCrowding(el, stationName, data);
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = cacheGet(cacheKey);
      if (cached) {
        renderCrowding(el, stationName, cached.data, cached.ts);
      } else {
        showOfflineMessage(el, "You're offline and there's no cached crowding data for this station yet.");
      }
      return;
    }
    showError(el, err);
  }
});

document.getElementById("form-report").addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("result-report");
  el.textContent = "Submitting…";
  const form = new FormData(e.target);
  try {
    await callApi("/api/crowding/report", {
      method: "POST",
      body: JSON.stringify({ station: form.get("station"), level: form.get("level") }),
    });
    el.innerHTML = `<div class="hint">Thanks — report recorded, expires in 15 min.</div>`;
  } catch (err) {
    if (isNetworkError(err)) {
      showOfflineMessage(el, "You're offline — this report couldn't be submitted.");
    } else {
      showError(el, err);
    }
  }
});

// ==================== saved routes ====================
const SAVED_ROUTES_CACHE_KEY = "transitpulse-cache-saved-routes";

function renderSavedRoutes(list, routes, cachedTs) {
  const staleNote = cachedTs
    ? `<li class="hint">${offlineCacheNote(cachedTs)}Showing/removing routes needs a connection.</li>`
    : "";
  list.innerHTML =
    staleNote +
    (routes.length
      ? routes
          .map(
            (r) => `
        <li>
          <div>
            <div><b>${escapeHtml(r.name)}</b></div>
            <div class="hint">${escapeHtml(r.originStation)} → ${escapeHtml(r.destinationStation)}</div>
            <div class="hint">${r.persona === "accessible" ? "Accessibility-first" : "Standard"}${r.departPreset ? ` · ${DEPART_PRESET_LABELS[r.departPreset] || r.departPreset}` : ""}</div>
          </div>
          <div class="list-actions">
            <button type="button" data-show="${r.id}">Show</button>
            <button type="button" class="remove" data-id="${r.id}">Remove</button>
          </div>
        </li>`
          )
          .join("")
      : `<li class="hint">No saved routes yet.</li>`);

  list.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await callApi(`/api/saved-routes/${btn.dataset.id}`, {
          method: "DELETE",
          headers: { "x-device-id": getDeviceId() },
        });
        loadSavedRoutes();
      } catch (err) {
        if (isNetworkError(err)) {
          showOfflineMessage(list, "You're offline — can't remove this route right now.");
        } else {
          showError(list, err);
        }
      }
    });
  });

  list.querySelectorAll("button[data-show]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const route = routes.find((r) => r.id === btn.dataset.show);
      if (!route) return;
      setActiveTab("reroute");
      document.getElementById("input-origin").value = route.originStation;
      document.getElementById("input-destination").value = route.destinationStation;
      document.getElementById("input-persona").value = route.persona || "standard";
      document.getElementById("input-depart-at").value = route.departPreset || "";
      submitReroute(route.originStation, route.destinationStation, route.persona, route.departPreset);
    });
  });
}

async function loadSavedRoutes() {
  const list = document.getElementById("saved-list");
  try {
    const routes = await callApi("/api/saved-routes", { headers: { "x-device-id": getDeviceId() } });
    cacheSet(SAVED_ROUTES_CACHE_KEY, routes);
    renderSavedRoutes(list, routes);
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = cacheGet(SAVED_ROUTES_CACHE_KEY);
      if (cached) {
        renderSavedRoutes(list, cached.data, cached.ts);
      } else {
        list.innerHTML = `<li class="hint">You're offline and there are no cached saved routes yet.</li>`;
      }
      return;
    }
    list.innerHTML = `<li class="error">${escapeHtml(err.message)}</li>`;
  }
}

document.getElementById("form-saved").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-saved-error");
  errorEl.textContent = "";
  const form = new FormData(e.target);
  try {
    await callApi("/api/saved-routes", {
      method: "POST",
      headers: { "x-device-id": getDeviceId() },
      body: JSON.stringify({
        name: form.get("name") || undefined,
        originStation: form.get("originStation"),
        destinationStation: form.get("destinationStation"),
      }),
    });
    e.target.reset();
    e.target.originStation.value = "Jurong East";
    e.target.destinationStation.value = "Raffles Place";
    loadSavedRoutes();
  } catch (err) {
    errorEl.textContent = isNetworkError(err) ? "You're offline — can't save this route right now." : userFacingMessage(err.message);
  }
});

loadSavedRoutes();
