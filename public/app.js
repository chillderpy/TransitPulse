const API = ""; // same origin - this page is served by the backend itself

// ---- tabs ----
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
  });
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
document.getElementById("device-id").textContent = getDeviceId();

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

function showError(el, err) {
  el.innerHTML = `<div class="error">${escapeHtml(err.message || String(err))}</div>`;
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
async function refreshHealth() {
  const badge = document.getElementById("health-badge");
  try {
    const health = await callApi("/health");
    if (health.ltaConfigured) {
      badge.textContent = "backend up · LTA key configured";
      badge.className = "badge badge-ok";
    } else {
      badge.textContent = "backend up · no LTA key set";
      badge.className = "badge badge-warn";
    }
  } catch (err) {
    badge.textContent = "backend unreachable";
    badge.className = "badge badge-down";
  }
}
refreshHealth();

// ---- reroute ----
document.getElementById("form-reroute").addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("result-reroute");
  el.textContent = "Loading…";
  const form = new FormData(e.target);
  try {
    const data = await callApi("/api/reroute", {
      method: "POST",
      body: JSON.stringify({ origin: form.get("origin"), destination: form.get("destination") }),
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
  } catch (err) {
    showError(el, err);
  }
});

// ---- bus arrivals ----
document.getElementById("form-arrivals").addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("result-arrivals");
  el.textContent = "Loading…";
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
  } catch (err) {
    showError(el, err);
  }
});

// ---- train alerts ----
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

// ---- crowding ----
document.getElementById("form-crowding").addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("result-crowding");
  el.textContent = "Loading…";
  const form = new FormData(e.target);
  try {
    const data = await callApi(
      `/api/crowding?trainLine=${encodeURIComponent(form.get("trainLine"))}&station=${encodeURIComponent(form.get("station"))}`
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

// ---- saved routes ----
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
          <button data-id="${r.id}">Remove</button>
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
