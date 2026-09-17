const API = ""; // same origin - this page is served by the backend itself

// ==================== map setup ====================
const map = L.map("map", { zoomControl: false }).setView([1.3521, 103.8198], 12);
L.control.zoom({ position: "topright" }).addTo(map);

// Vector basemap via protomaps-leaflet, reading a Protomaps daily basemap
// build directly over HTTP range requests (no tile server needed - and no
// dependency on the OpenStreetMap raster tile hosts, which some networks
// block). Protomaps only retains each dated build for about a week, so if
// this ever 404s, grab the current filename from https://maps.protomaps.com/builds
// and update PMTILES_URL below.
const PMTILES_URL = "https://build.protomaps.com/20260917.pmtiles";
protomapsL
  .leafletLayer({
    url: PMTILES_URL,
    flavor: "light",
    lang: "en",
    attribution:
      '&copy; <a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  })
  .addTo(map);

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
function getDeviceId() {
  let id = localStorage.getItem("transitpulse-device-id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem("transitpulse-device-id", id);
  }
  return id;
}

// ---- helpers ----
async function callApi(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
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
  try {
    await callApi("/health");
    badge.textContent = "";
    badge.className = "badge badge-unknown hidden";
  } catch (err) {
    badge.textContent = "Can't connect right now";
    badge.className = "badge badge-down";
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
    const stepsHtml = data.steps
      .map((s) => `<li><span>${s.order}. ${escapeHtml(s.station)}</span><span class="hint">${escapeHtml(s.note)}</span></li>`)
      .join("");
    const warningsHtml = (data.accessibilityWarnings || [])
      .map((w) => `<div class="pill pill-disrupted" style="display:block;margin-top:6px">${escapeHtml(w)}</div>`)
      .join("");
    const timeIcon = TIME_CONTEXT_ICONS[data.timeContext?.period] || "🕐";
    lastRerouteResult = {
      ...data,
      requestOrigin: origin,
      requestDestination: destination,
      requestPersona: persona || "standard",
      requestDepartPreset: departPreset || null,
    };
    el.innerHTML = `
      <div class="summary-row">
        <div><b>${data.confidenceRangeMinutes.min}–${data.confidenceRangeMinutes.max} min</b>estimated</div>
        <div><b>${data.usualMinutes} min</b>usual</div>
        <div><b>${data.deltaMinutes >= 0 ? "+" : ""}${data.deltaMinutes} min</b>vs usual</div>
        <div><b>${data.transfers}</b>transfers</div>
      </div>
      ${data.timeContext ? `<div class="pill pill-normal">${timeIcon} ${escapeHtml(data.timeContext.label)} timing</div>` : ""}
      ${data.serviceHoursNote ? `<div class="pill pill-medium" style="display:block;margin-top:6px">🕒 ${escapeHtml(data.serviceHoursNote)}</div>` : ""}
      ${data.disruptionReason ? `<div class="pill pill-disrupted">🚧 ${escapeHtml(data.disruptionReason)}</div>` : `<div class="pill pill-normal">No known disruption on this route</div>`}
      ${data.crowdingReason ? `<div class="pill pill-medium" style="display:block;margin-top:6px">👥 ${escapeHtml(data.crowdingReason)}</div>` : ""}
      ${data.weatherAdvisory ? `<div class="pill pill-medium" style="display:block;margin-top:6px">☔ ${escapeHtml(data.weatherAdvisory.message)}</div>` : ""}
      ${warningsHtml}
      ${
        JSON.stringify(data.usualPath) !== JSON.stringify(data.livePath) && data.usualPath.length >= 2
          ? `<div class="route-legend"><span><i class="swatch swatch-live"></i>Route you're taking (${data.totalMinutes} min)</span><span><i class="swatch swatch-usual"></i>Usual route (${data.usualMinutes} min)</span><span><i class="swatch swatch-avoided"></i>Segment avoided</span></div>`
          : ""
      }
      <ul class="steps" style="margin-top:12px">${stepsHtml}</ul>
      <button type="button" id="save-route-btn" style="margin-top:12px">Save this route</button>
      <div id="save-route-error" class="error" style="display:inline-block;margin-left:8px"></div>
    `;
    document.getElementById("save-route-btn").addEventListener("click", saveCurrentRoute);
    drawRoute(data);
  } catch (err) {
    lastRerouteResult = null;
    showError(el, err);
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
    showError(el, err);
  }
});

// ==================== train alerts ====================
document.getElementById("btn-alerts").addEventListener("click", async () => {
  const el = document.getElementById("result-alerts");
  el.textContent = "Loading…";
  try {
    const data = await callApi("/api/train-alerts");
    const advisoriesHtml = (data.generalAdvisories || [])
      .map((m) => `<div class="advisory advisory-medium">${escapeHtml(m)}</div>`)
      .join("");
    if (data.overallStatus === "normal") {
      el.innerHTML = `<span class="pill pill-normal">All lines normal</span>${advisoriesHtml ? `<div style="margin-top:10px">${advisoriesHtml}</div>` : ""}`;
      return;
    }
    el.innerHTML = advisoriesHtml + data.lines
      .map(
        (l) => `
      <div style="margin-bottom:10px">
        <span class="pill pill-disrupted">${escapeHtml(l.line)}</span>
        ${l.affectedStations.length ? `<div class="hint">Affected: ${l.affectedStations.map(escapeHtml).join(", ")}</div>` : ""}
        ${l.messages.map((m) => `<div class="hint">${escapeHtml(m)}</div>`).join("")}
      </div>`
      )
      .join("");
  } catch (err) {
    showError(el, err);
  }
});

// ==================== crowding ====================
document.getElementById("form-crowding").addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("result-crowding");
  el.textContent = "Loading…";
  const form = new FormData(e.target);
  const stationName = form.get("station");
  try {
    const data = await callApi(`/api/crowding?station=${encodeURIComponent(stationName)}`);
    const staleness =
      data.live.staleForSeconds != null ? `updated ${Math.round(data.live.staleForSeconds / 60)} min ago` : "no live reading";
    el.innerHTML = `
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
  } catch (err) {
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
    showError(el, err);
  }
});

// ==================== saved routes ====================
async function loadSavedRoutes() {
  const list = document.getElementById("saved-list");
  try {
    const routes = await callApi("/api/saved-routes", { headers: { "x-device-id": getDeviceId() } });
    list.innerHTML = routes.length
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
      : `<li class="hint">No saved routes yet.</li>`;

    list.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await callApi(`/api/saved-routes/${btn.dataset.id}`, {
          method: "DELETE",
          headers: { "x-device-id": getDeviceId() },
        });
        loadSavedRoutes();
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
  } catch (err) {
    list.innerHTML = `<li class="error">${escapeHtml(err.message)}</li>`;
  }
}

document.getElementById("form-saved").addEventListener("submit", async (e) => {
  e.preventDefault();
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
    alert(err.message);
  }
});

loadSavedRoutes();
