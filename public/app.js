const TAG_LABELS = {
  "safe": "Safe to remove",
  "loses-feature": "Removing this loses a feature",
  "not-recommended": "Not recommended",
};
const $ = (id) => document.getElementById(id);
let apps = [];          // what the Choose step is showing
let advanced = false;   // "show all apps" mode
const selectedPkgs = new Set(); // survives re-filtering in advanced mode

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

const mode = () => document.querySelector('input[name="mode"]:checked')?.value || "remove";

function appRow(a, { checkbox = false, locked = false, extra = "" } = {}) {
  const img = el("img", { alt: "", loading: "lazy", src: `/api/icon/${encodeURIComponent(a.pkg)}` });
  img.onerror = () => { img.onerror = null; img.src = "/placeholder.svg"; };
  const nameLine = el("div", { className: "name" }, a.name || a.pkg);
  if (a.tag) nameLine.append(el("span", { className: `tag ${a.tag}`, textContent: TAG_LABELS[a.tag] }));
  if (a.system) nameLine.append(el("span", { className: "chip", textContent: "system" }));
  if (a.disabled) nameLine.append(el("span", { className: "chip", textContent: "disabled" }));
  if (locked) nameLine.append(el("span", { className: "chip", textContent: "🔒 locked" }));
  if (extra) nameLine.append(el("span", { className: "chip", textContent: extra }));
  const info = el("div", { className: "info" }, nameLine);
  if (a.explanation) info.append(el("div", { className: "desc", textContent: a.explanation }));
  if (a.name && a.name !== a.pkg) info.append(el("div", { className: "pkg", textContent: a.pkg }));
  const row = el("label", { className: "app" + (locked ? " locked" : "") });
  if (checkbox) {
    const cb = el("input", { type: "checkbox", checked: selectedPkgs.has(a.pkg), disabled: locked });
    cb.style.flex = "none"; cb.style.minWidth = "0";
    cb.onchange = () => { if (cb.checked) selectedPkgs.add(a.pkg); else selectedPkgs.delete(a.pkg); updateCount(); };
    row.append(cb);
  }
  row.append(img, info);
  return row;
}

function updateCount() {
  if (advanced) $("advCount").textContent = `${selectedPkgs.size} selected of ${apps.length} apps.`;
}

function renderChoose() {
  const list = $("appList");
  list.replaceChildren();
  let shown = apps;
  if (advanced) {
    const q = $("search").value.trim().toLowerCase();
    if (q) shown = shown.filter((a) => a.pkg.toLowerCase().includes(q) || (a.name || "").toLowerCase().includes(q));
    if ($("hideSystem").checked) shown = shown.filter((a) => !a.system);
    if ($("onlyCurated").checked) shown = shown.filter((a) => a.curated);
    updateCount();
  }
  if (!shown.length) list.append(el("p", { className: "hint", textContent: advanced ? "No apps match." : "None of the known bloatware apps are installed on this TV." }));
  for (const a of shown) list.append(appRow(a, { checkbox: true, locked: !!a.locked }));
}

async function loadApps() {
  selectedPkgs.clear();
  if (advanced) {
    apps = (await api("/api/all-apps")).apps;
    $("protectedNote").textContent = "Locked apps are needed by the Fire TV and can never be changed.";
  } else {
    const data = await api("/api/apps");
    apps = data.apps.filter((a) => a.installed);
    for (const a of apps) if (a.selected) selectedPkgs.add(a.pkg);
    $("protectedNote").textContent = `${data.protectedCount} system app rules are locked and can never be removed.`;
  }
  renderChoose();
}

async function loadRemoved() {
  const { apps: gone } = await api("/api/removed");
  const list = $("removedList");
  list.replaceChildren();
  if (!gone.length) list.append(el("p", { className: "hint", textContent: "Nothing is currently removed or disabled." }));
  for (const a of gone) {
    const row = appRow(a, { extra: a.mode === "disable" ? "disabled" : "removed" });
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

$("advToggle").onchange = async () => {
  advanced = $("advToggle").checked;
  $("advBox").hidden = !advanced;
  try { await loadApps(); } catch (e) { showError(e.message); }
};
for (const id of ["search", "hideSystem", "onlyCurated"]) $(id).oninput = renderChoose;

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
  const chosen = apps.filter((a) => selectedPkgs.has(a.pkg) && !a.locked);
  if (!chosen.length) return showError("Pick at least one app.");
  if (advanced && !$("advAck").checked) return showError("Tick \"I understand the risks\" to continue in advanced mode.");
  const action = advanced ? mode() : "remove";
  $("reviewIntro").textContent = action === "disable"
    ? "These apps will be disabled on your Fire TV. You can turn them back on with Restore."
    : "These apps will be removed for your user on the Fire TV. You can bring them back with Restore.";
  const ul = $("reviewList"); ul.replaceChildren();
  for (const a of chosen) ul.append(el("li", {}, appRow(a)));
  $("removeBtn").textContent = action === "disable" ? `Disable ${chosen.length} app(s)` : `Remove ${chosen.length} app(s)`;
  go("review");
};
$("back").onclick = () => go("choose");

$("removeBtn").onclick = async () => {
  $("removeBtn").disabled = true;
  try {
    const action = advanced ? mode() : "remove";
    const packages = apps.filter((a) => selectedPkgs.has(a.pkg) && !a.locked).map((a) => a.pkg);
    const r = await api("/api/remove", { packages, advanced, mode: action });
    const s = $("doneSummary"); s.replaceChildren();
    const verb = action === "disable" ? "Disabled" : "Removed";
    s.append(el("p", { className: "ok", textContent: `${verb} ${r.removed.length} app(s).` }));
    if (r.removed.length) s.append(el("p", { className: "hint", textContent: "Restart your Fire TV and check that everything still works before changing more." }));
    for (const x of r.errors) s.append(el("p", { className: "warn", textContent: `Couldn't change ${x.pkg}: ${x.reason}` }));
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
    const r = await api("/api/restore", { packages: gone.map((a) => a.pkg) });
    await loadRemoved();
    $("doneSummary").replaceChildren(r.failed
      ? el("p", { className: "warn", textContent: `Restored ${r.restored.length} app(s), then stopped at ${r.failed.pkg}: ${r.failed.reason}. Try Undo again.` })
      : el("p", { className: "ok", textContent: "Everything has been restored." }));
  } catch (e) { showError(e.message); }
};
$("again").onclick = async () => { await loadApps(); go("choose"); };

go("connect");
