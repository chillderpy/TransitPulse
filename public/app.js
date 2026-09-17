const API = ""; // same origin - this page is served by the backend itself

// ==================== map setup ====================
const map = L.map("map", { zoomControl: false }).setView([1.3521, 103.8198], 12);
L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const stationsLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const crowdingLayer = L.layerGroup().addTo(map);
const busLayer = L.layerGroup().addTo(map);

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
  const points = [];
  data.steps.forEach((step) => {
    const coords = findStationCoords(step.station);
    if (!coords) return;
    points.push([coords.lat, coords.lon]);
    if (step.mode === "origin") {
      L.marker([coords.lat, coords.lon], { icon: stationIcon("endpoint-dot endpoint-origin", 16) })
        .bindPopup(`<b>${escapeHtml(step.station)}</b><div class="hint">Origin</div>`)
        .addTo(routeLayer);
    } else if (step.mode === "destination") {
      L.marker([coords.lat, coords.lon], { icon: stationIcon("endpoint-dot endpoint-destination", 16) })
        .bindPopup(`<b>${escapeHtml(step.station)}</b><div class="hint">Destination</div>`)
        .addTo(routeLayer);
    }
  });
  if (points.length >= 2) {
    const line = L.polyline(points, { color: "#4f8cff", weight: 5, opacity: 0.85 }).addTo(routeLayer);
    fitBoundsAvoidingPanel(line.getBounds());
  } else if (points.length === 1) {
    map.setView(points[0], 15);
  }
}

// Keeps fitted content clear of the floating control panel, which covers
// the left ~400px of the map when expanded.
function fitBoundsAvoidingPanel(bounds) {
  const panelVisible = !document.getElementById("overlay-panel").classList.contains("collapsed");
  map.fitBounds(bounds, {
    paddingTopLeft: [panelVisible ? 420 : 60, 60],
    paddingBottomRight: [60, 60],
  });
}

function setViewAvoidingPanel(latlng, zoom) {
  const panelVisible = !document.getElementById("overlay-panel").classList.contains("collapsed");
  map.setView(latlng, zoom, { animate: false });
  if (panelVisible) map.panBy([-190, 0], { animate: false });
}

async function submitReroute(origin, destination) {
  const el = document.getElementById("result-reroute");
  el.textContent = "Loading…";
  try {
    const data = await callApi("/api/reroute", {
      method: "POST",
      body: JSON.stringify({ origin, destination }),
    });
    const stepsHtml = data.steps
      .map((s) => `<li><span>${s.order}. ${escapeHtml(s.station)}</span><span class="hint">${escapeHtml(s.note)}</span></li>`)
      .join("");
    el.innerHTML = `
      <div class="summary-row">
        <div><b>${data.totalMinutes} min</b>total</div>
        <div><b>${data.usualMinutes} min</b>usual</div>
        <div><b>${data.deltaMinutes >= 0 ? "+" : ""}${data.deltaMinutes} min</b>vs usual</div>
        <div><b>${data.transfers}</b>transfers</div>
      </div>
      ${data.disruptionReason ? `<div class="pill pill-disrupted">${escapeHtml(data.disruptionReason)}</div>` : `<div class="pill pill-normal">No known disruption on this route</div>`}
      <ul class="steps" style="margin-top:12px">${stepsHtml}</ul>
    `;
    drawRoute(data);
  } catch (err) {
    showError(el, err);
  }
}

document.getElementById("form-reroute").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  submitReroute(form.get("origin"), form.get("destination"));
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
        if (a.latitude == null || a.longitude == null) return;
        busPoints.push([a.latitude, a.longitude]);
        L.marker([a.latitude, a.longitude], { icon: stationIcon("bus-dot", 12) })
          .bindPopup(`<b>Bus ${escapeHtml(svc.serviceNo)}</b><div class="hint">${a.etaMinutes ?? "?"} min · ${a.load.replace("_", " ")}</div>`)
          .addTo(busLayer);
      });
    });
    if (busPoints.length) {
      fitBoundsAvoidingPanel(L.latLngBounds(busPoints));
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
    if (data.overallStatus === "normal") {
      el.innerHTML = `<span class="pill pill-normal">All lines normal</span>`;
      return;
    }
    el.innerHTML = data.lines
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
    const data = await callApi(
      `/api/crowding?trainLine=${encodeURIComponent(form.get("trainLine"))}&station=${encodeURIComponent(stationName)}`
    );
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
        submitReroute(route.originStation, route.destinationStation);
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
