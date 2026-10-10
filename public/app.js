const TAG_LABELS = {
  "safe": "Safe to remove",
  "loses-feature": "Removing this loses a feature",
  "not-recommended": "Not recommended",
};
const $ = (id) => document.getElementById(id);
let apps = [];

async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function showError(msg) { const e = $("error"); e.textContent = msg || ""; e.hidden = !msg; }

function go(step) {
  showError("");
  for (const id of ["connect", "choose", "review", "done"]) $(id).hidden = id !== step;
  for (const li of document.querySelectorAll("#steps li")) li.classList.toggle("active", li.dataset.step === step);
}

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
}

function appRow(a, { checkbox = false } = {}) {
  const img = el("img", { alt: "", src: `/api/icon/${encodeURIComponent(a.pkg)}` });
  img.onerror = () => { img.onerror = null; img.src = "/placeholder.svg"; };
  const tag = el("span", { className: `tag ${a.tag}`, textContent: TAG_LABELS[a.tag] });
  const info = el("div", { className: "info" },
    el("div", { className: "name" }, a.name, tag),
    el("div", { className: "desc", textContent: a.explanation }));
  const row = el("label", { className: "app" });
  if (checkbox) {
    const cb = el("input", { type: "checkbox", checked: a.selected });
    cb.style.flex = "none"; cb.style.minWidth = "0";
    cb.onchange = () => { a.selected = cb.checked; };
    row.append(cb);
  }
  row.append(img, info);
  return row;
}

async function loadApps() {
  const data = await api("/api/apps");
  apps = data.apps.filter((a) => a.installed);
  const list = $("appList");
  list.replaceChildren();
  if (!apps.length) list.append(el("p", { className: "hint", textContent: "None of the known bloatware apps are installed on this TV." }));
  for (const a of apps) list.append(appRow(a, { checkbox: true }));
  $("protectedNote").textContent = `${data.protectedCount} system app rules are locked and can never be removed.`;
}

async function loadRemoved() {
  const { apps: gone } = await api("/api/removed");
  const list = $("removedList");
  list.replaceChildren();
  if (!gone.length) list.append(el("p", { className: "hint", textContent: "Nothing is currently removed." }));
  for (const a of gone) {
    const row = appRow(a);
    const btn = el("button", { className: "secondary", textContent: "Restore" });
    btn.onclick = async () => {
      btn.disabled = true;
      try { await api("/api/restore", { packages: [a.pkg] }); await loadRemoved(); } catch (e) { showError(e.message); btn.disabled = false; }
    };
    row.append(btn);
    list.append(row);
  }
  return gone;
}

$("find").onclick = async () => {
  showError("");
  $("find").disabled = true; $("find").textContent = "Searching…";
  try {
    const { hosts } = await api("/api/discover");
    const box = $("found"); box.replaceChildren();
    if (!hosts.length) showError("No Fire TV found. Make sure ADB debugging is on, then type the IP address yourself.");
    for (const h of hosts) {
      const b = el("button", { className: "secondary", textContent: h });
      b.onclick = () => { $("host").value = h; };
      box.append(b);
    }
  } catch (e) { showError(e.message); }
  $("find").disabled = false; $("find").textContent = "Find my Fire TV";
};

$("connectBtn").onclick = async () => {
  showError("");
  $("connectBtn").disabled = true; $("connectBtn").textContent = "Connecting…";
  try {
    await api("/api/connect", { host: $("host").value.trim() });
    await loadApps();
    go("choose");
  } catch (e) { showError(e.message); }
  $("connectBtn").disabled = false; $("connectBtn").textContent = "Connect";
};

$("toReview").onclick = () => {
  const chosen = apps.filter((a) => a.selected);
  if (!chosen.length) return showError("Pick at least one app to remove.");
  const ul = $("reviewList"); ul.replaceChildren();
  for (const a of chosen) ul.append(el("li", {}, appRow(a)));
  go("review");
};
$("back").onclick = () => go("choose");

$("removeBtn").onclick = async () => {
  $("removeBtn").disabled = true;
  try {
    const r = await api("/api/remove", { packages: apps.filter((a) => a.selected).map((a) => a.pkg) });
    const s = $("doneSummary"); s.replaceChildren();
    s.append(el("p", { className: "ok", textContent: `Removed ${r.removed.length} app(s).` }));
    for (const x of r.skipped) s.append(el("p", { className: "warn", textContent: `Skipped ${x.pkg}: ${x.reason}` }));
    if (r.failed) s.append(el("p", { className: "warn", textContent: `Stopped at ${r.failed.pkg}: ${r.failed.reason}. ${r.notAttempted.length} app(s) were not attempted.` }));
    await loadRemoved();
    go("done");
  } catch (e) { showError(e.message); }
  $("removeBtn").disabled = false;
};

$("undoAll").onclick = async () => {
  try {
    const { apps: gone } = await api("/api/removed");
    await api("/api/restore", { packages: gone.map((a) => a.pkg) });
    await loadRemoved();
    $("doneSummary").replaceChildren(el("p", { className: "ok", textContent: "Everything has been restored." }));
  } catch (e) { showError(e.message); }
};
$("again").onclick = async () => { await loadApps(); go("choose"); };

go("connect");
