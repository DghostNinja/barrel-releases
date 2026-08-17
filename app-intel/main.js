// App Intel - one-click recon dashboard for any installed app.
// Uses only the BarrelPlugin global (frozen API). Runs on Barrel 0.3+.

const api = window.BarrelPlugin;

// ── Small helpers ─────────────────────────────────────────────

const $ = (el) => document.createElement(el);

function shell(args, opts) {
  return api.execAdb(["shell", ...args], opts);
}

// Run `adb shell` and return trimmed stdout.
async function sh(args) {
  const res = await shell(args);
  return (res.stdout || "").trim();
}

// Run `adb shell su -c <cmd>` and return trimmed stdout. Falls back to the
// plain (non-root) call if su is unavailable.
async function shsu(cmd) {
  try {
    const res = await shell(["su", "-c", cmd]);
    if (res.stdout.trim()) return res.stdout.trim();
  } catch (e) {
    // fall through to non-root attempt
  }
  return sh(["sh", "-c", cmd]);
}

function makeCard(title, subtitle) {
  const card = $("div");
  card.className = "ai-card";
  const head = $("div");
  head.className = "ai-card-head";
  const h = $("div");
  h.className = "ai-card-title";
  h.textContent = title;
  head.appendChild(h);
  if (subtitle) {
    const s = $("div");
    s.className = "ai-card-sub";
    s.textContent = subtitle;
    head.appendChild(s);
  }
  card.appendChild(head);
  const body = $("div");
  body.className = "ai-card-body";
  card.appendChild(body);
  return { card, body, head };
}

function kvGrid(pairs) {
  const grid = $("div");
  grid.className = "ai-kv";
  for (const [k, v] of pairs) {
    const item = $("div");
    item.className = "ai-kv-item";
    const kEl = $("span");
    kEl.className = "ai-kv-key";
    kEl.textContent = k;
    const vEl = $("span");
    vEl.className = "ai-kv-val";
    vEl.textContent = v == null || v === "" ? "-" : v;
    item.appendChild(kEl);
    item.appendChild(vEl);
    grid.appendChild(item);
  }
  return grid;
}

function badge(text, tone) {
  const b = $("span");
  b.className = "ai-badge " + (tone ? "ai-" + tone : "");
  b.textContent = text;
  return b;
}

function pill(text, tone) {
  const p = $("span");
  p.className = "status-pill " + (tone ? tone : "");
  p.textContent = text;
  return p;
}

// ── Package discovery ─────────────────────────────────────────

async function listPackages(includeSystem) {
  const args = ["pm", "list", "packages", includeSystem ? "" : "-3"];
  const out = await sh(args.filter(Boolean));
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("package:"))
    .map((l) => l.slice("package:".length))
    .filter(Boolean)
    .sort();
}

// ── dumpsys parsing ───────────────────────────────────────────

function parsePackageInfo(dump) {
  const info = {};

  const ver = dump.match(/versionCode=(\d+)([^\n]*)/);
  if (ver) {
    info.versionCode = ver[1];
    const minSdk = ver[2].match(/minSdk=(\d+)/);
    const targetSdk = ver[2].match(/targetSdk=(\d+)/);
    info.minSdk = minSdk ? minSdk[1] : null;
    info.targetSdk = targetSdk ? targetSdk[1] : null;
  }
  const vn = dump.match(/versionName=([^\s]+)/);
  info.versionName = vn ? vn[1] : null;
  const uid = dump.match(/userId=(\d+)/);
  info.uid = uid ? uid[1] : null;
  const flags = dump.match(/flags=\[([^\]]*)\]/);
  info.flags = flags ? flags[1].split(/\s+/).filter(Boolean) : [];
  const codePath = dump.match(/codePath=([^\s]+)/);
  info.codePath = codePath ? codePath[1] : null;
  const dataDir = dump.match(/dataDir=([^\s]+)/);
  info.dataDir = dataDir ? dataDir[1] : null;
  const firstInstall = dump.match(/firstInstallTime=([^\n]+)/);
  info.firstInstallTime = firstInstall ? firstInstall[1].trim() : null;
  const lastUpdate = dump.match(/lastUpdateTime=([^\n]+)/);
  info.lastUpdateTime = lastUpdate ? lastUpdate[1].trim() : null;
  const pkgName = dump.match(/Package \[([^\]]+)\]/);
  info.pkg = pkgName ? pkgName[1] : null;
  return info;
}

function parsePermissions(dump) {
  const requested = [];
  const runtime = [];

  const reqMatch = dump.match(/requested permissions:([\s\S]*?)(?=\n\n\s*\S|\n\n\n|$)/);
  if (reqMatch) {
    for (const line of reqMatch[1].split("\n")) {
      const m = line.match(/^\s+(android\.[\w.]+)/);
      if (m) requested.push(m[1]);
    }
  }

  const runMatch = dump.match(/runtime permissions:([\s\S]*?)(?=\n\n\s*\S|\n\n\n|$)/);
  if (runMatch) {
    for (const line of runMatch[1].split("\n")) {
      const m = line.match(/^\s+(android\.[\w.]+): granted=(\w+)/);
      if (m) runtime.push({ name: m[1], granted: m[2] === "true" });
    }
  }
  return { requested, runtime };
}

// Danger-level classification for common Android permissions.
const DANGEROUS = [
  "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.CAMERA", "android.permission.RECORD_AUDIO",
  "android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS",
  "android.permission.READ_CALL_LOG", "android.permission.WRITE_CALL_LOG",
  "android.permission.READ_SMS", "android.permission.SEND_SMS", "android.permission.RECEIVE_SMS",
  "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.BODY_SENSORS", "android.permission.CALL_PHONE",
  "android.permission.READ_PHONE_STATE", "android.permission.ACTIVITY_RECOGNITION",
  "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.PACKAGE_USAGE_STATS",
  "android.permission.MANAGE_EXTERNAL_STORAGE", "android.permission.QUERY_ALL_PACKAGES",
];

function permTone(name) {
  if (DANGEROUS.includes(name)) return "danger";
  if (name.includes("READ") || name.includes("WRITE") || name.includes("ACCESS")) return "warn";
  return "";
}

function extractComponents(dump, tableName) {
  const start = dump.indexOf(tableName + ":");
  if (start === -1) return [];
  const rest = dump.slice(start);
  const end = rest.indexOf("\n\n\n");
  const block = end === -1 ? rest : rest.slice(0, end);

  const out = [];
  const seen = new Set();
  const re = /(\s)([\w.]+)\/(\.?[\w.]+)(\s|$)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const full = m[2] + (m[3].startsWith(".") ? "" : ".") + m[3];
    const key = m[2] + "/" + m[3];
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = m.index;
    const seg = block.slice(idx, idx + 400);
    const action = seg.match(/Action: "([^"]+)"/);
    out.push({ name: full, action: action ? action[1] : null });
  }
  return out;
}

// ── Data-dir exploration ──────────────────────────────────────

async function listSharedPrefs(dataDir) {
  return shsu(`ls -1 "${dataDir}/shared_prefs" 2>/dev/null || echo "__NONE__"`);
}

async function readPrefsFile(path) {
  return shsu(`cat "${path}" 2>/dev/null`);
}

async function listDatabases(dataDir) {
  return shsu(`ls -1 "${dataDir}/databases" 2>/dev/null || echo "__NONE__"`);
}

async function sqliteTables(dbPath) {
  return shsu(`sqlite3 "${dbPath}" ".tables" 2>/dev/null || echo "__NO_SQLITE__"`);
}

async function listFiles(dataDir) {
  return shsu(`ls -1 "${dataDir}/files" 2>/dev/null || echo "__NONE__"`);
}

async function listCache(dataDir) {
  return shsu(`ls -1 "${dataDir}/cache" 2>/dev/null || echo "__NONE__"`);
}

// ── Main tab ──────────────────────────────────────────────────

let packagesCache = [];
let includeSystem = false;

api.registerTab({
  id: "app-intel",
  label: "App Intel",
  async render(container) {
    container.innerHTML = "";

    // Toolbar
    const toolbar = $("div");
    toolbar.className = "ai-toolbar";

    const deviceSel = api.ui.deviceSelect({
      onSelect: () => {
        // device change resets the analyzed state
        container.querySelector(".ai-results")?.remove();
      },
    });
    toolbar.appendChild(deviceSel);

    const sysWrap = $("label");
    sysWrap.className = "ai-check";
    const sysBox = $("input");
    sysBox.type = "checkbox";
    sysBox.checked = includeSystem;
    const sysLabel = $("span");
    sysLabel.textContent = "Show system apps";
    sysWrap.appendChild(sysBox);
    sysWrap.appendChild(sysLabel);
    toolbar.appendChild(sysWrap);

    const pkgSel = $("select");
    pkgSel.className = "device-select ai-pkg-select";
    toolbar.appendChild(pkgSel);

    const search = $("input");
    search.type = "text";
    search.className = "device-select ai-search";
    search.placeholder = "Filter packages...";
    toolbar.appendChild(search);

    const analyzeBtn = api.ui.button({ label: "Analyze", variant: "accent" });
    analyzeBtn.className += " ai-analyze";
    toolbar.appendChild(analyzeBtn);

    const status = $("div");
    status.className = "ai-status";
    toolbar.appendChild(status);

    container.appendChild(toolbar);

    // Intro / empty state
    const results = $("div");
    results.className = "ai-results";
    const intro = makeCard("App Intel", "Pick an app, then hit Analyze for a full recon pass: permissions, exported components, security flags, and app data.");
    results.appendChild(intro.card);
    container.appendChild(results);

    // Refresh package list
    const refreshPackages = async () => {
      pkgSel.disabled = true;
      status.textContent = "Loading packages...";
      try {
        packagesCache = await listPackages(includeSystem);
        populateSelect(pkgSel, packagesCache, api.storage.get("app-intel-pkg"));
      } catch (e) {
        status.textContent = "Failed to list packages: " + e;
      } finally {
        pkgSel.disabled = false;
      }
    };

    sysBox.addEventListener("change", () => {
      includeSystem = sysBox.checked;
      refreshPackages();
    });

    const onSearch = () => {
      const q = search.value.toLowerCase();
      const filtered = packagesCache.filter((p) => p.toLowerCase().includes(q));
      const current = pkgSel.value;
      populateSelect(pkgSel, filtered, current || filtered[0] || "");
    };
    search.addEventListener("input", () => {
      clearTimeout(search._t);
      search._t = setTimeout(onSearch, 200);
    });

    analyzeBtn.addEventListener("click", () => analyze());
    pkgSel.addEventListener("change", () => {
      api.storage.set("app-intel-pkg", pkgSel.value);
    });

    const analyze = async () => {
      const pkg = pkgSel.value;
      if (!pkg) {
        status.textContent = "Select a package first.";
        return;
      }
      results.innerHTML = "";
      status.textContent = "Analyzing " + pkg + "...";

      try {
        const dump = await sh(["dumpsys", "package", pkg]);
        if (!dump) {
          results.appendChild(failCard("No output from dumpsys package " + pkg));
          status.textContent = "";
          return;
        }

        const info = parsePackageInfo(dump);
        const perms = parsePermissions(dump);
        const activities = extractComponents(dump, "Activity Resolver Table");
        const services = extractComponents(dump, "Service Resolver Table");
        const receivers = extractComponents(dump, "Receiver Resolver Table");
        const providers = extractComponents(dump, "Provider Resolver Table");

        results.appendChild(buildOverview(info));
        results.appendChild(buildSecurityFlags(info));
        results.appendChild(buildPermissions(perms, info));
        results.appendChild(buildComponents(activities, services, receivers, providers));
        results.appendChild(buildAppData(info.dataDir, pkg));
        results.appendChild(buildRaw(dump));
        status.textContent = "";
      } catch (e) {
        results.appendChild(failCard("Analyze failed: " + e));
        status.textContent = "";
      }
    };

    // ── Cards ──

    function buildOverview(info) {
      const { card, body } = makeCard("Overview", info.pkg || "");
      body.appendChild(kvGrid([
        ["Version name", info.versionName],
        ["Version code", info.versionCode],
        ["Min SDK", info.minSdk],
        ["Target SDK", info.targetSdk],
        ["UID", info.uid],
        ["Code path", info.codePath],
        ["Data dir", info.dataDir],
        ["Installed", info.firstInstallTime],
        ["Updated", info.lastUpdateTime],
      ]));
      return card;
    }

    function buildSecurityFlags(info) {
      const { card, body } = makeCard("Security Flags", "App-level flags from the package manager. Red = worth investigating.");
      const row = $("div");
      row.className = "ai-badges";
      const flags = info.flags || [];

      const has = (f) => flags.includes(f);

      row.appendChild(badge(has("DEBUGGABLE") ? "Debuggable" : "Not debuggable", has("DEBUGGABLE") ? "danger" : "ok"));
      row.appendChild(badge(has("ALLOW_BACKUP") ? "Backup allowed" : "Backup blocked", has("ALLOW_BACKUP") ? "warn" : "ok"));
      row.appendChild(badge(has("PERSISTENT") ? "Persistent" : "Not persistent", has("PERSISTENT") ? "warn" : "ok"));
      row.appendChild(badge(has("SYSTEM") ? "System app" : "User app", ""));
      row.appendChild(badge(has("HAS_CODE") ? "Has code" : "No code", ""));

      if (flags.includes("DEBUGGABLE")) {
        const note = $("p");
        note.className = "ai-note ai-note-danger";
        note.textContent = "This app is debuggable. Anyone with ADB access can attach a debugger, dump memory, and read sensitive state.";
        body.appendChild(note);
      }
      if (flags.includes("ALLOW_BACKUP")) {
        const note = $("p");
        note.className = "ai-note ai-note-warn";
        note.textContent = "Backups are enabled, so app data can be extracted with adb backup if the device allows it.";
        body.appendChild(note);
      }

      body.appendChild(row);
      return card;
    }

    function buildPermissions(perms, info) {
      const { card, body } = makeCard("Permissions", (perms.requested.length + perms.runtime.length) + " declared, " + perms.runtime.filter((p) => p.granted).length + " runtime-granted");

      const granted = perms.runtime.filter((p) => p.granted);
      if (granted.length) {
        const h = $("div");
        h.className = "ai-subhead";
        h.textContent = "Granted (dangerous/signature)";
        body.appendChild(h);
        body.appendChild(api.ui.table(
          ["Permission", "Risk"],
          granted.map((p) => [p.name, pill(permTone(p.name) ? "sensitive" : "normal", permTone(p.name))])
        ));
      }

      const h2 = $("div");
      h2.className = "ai-subhead";
      h2.textContent = "Declared in manifest";
      body.appendChild(h2);

      const requestedRows = perms.requested.map((name) => {
        const gr = perms.runtime.find((p) => p.name === name);
        return [name, pill(gr ? (gr.granted ? "granted" : "denied") : "not requested", gr ? (gr.granted ? "ok" : "err") : "")];
      });

      body.appendChild(api.ui.table(["Permission", "State"], requestedRows));
      return card;
    }

    function buildComponents(acts, svcs, recs, provs) {
      const total = acts.length + svcs.length + recs.length + provs.length;
      const { card, body } = makeCard("Exported Components", total + " components exposed with intent filters. These are attack surface.");

      const renderGroup = (title, rows) => {
        if (!rows.length) return;
        const h = $("div");
        h.className = "ai-subhead";
        h.textContent = title;
        body.appendChild(h);
        body.appendChild(api.ui.table(
          ["Component", "Action"],
          rows.map((c) => [c.name, c.action || ""])
        ));
      };

      renderGroup("Activities", acts);
      renderGroup("Services", svcs);
      renderGroup("Receivers", recs);
      renderGroup("Providers", provs);

      if (!total) {
        const p = $("p");
        p.className = "ai-note";
        p.textContent = "No intent-filtered components found. Check the APK Analyzer for the full manifest.";
        body.appendChild(p);
      }
      return card;
    }

    function buildAppData(dataDir, pkg) {
      const { card, body } = makeCard("App Data", dataDir || "data dir unknown. Root access may be needed to read it.");
      if (!dataDir) return card;

      const sec = $("div");
      sec.className = "ai-sec";

      // SharedPreferences
      const prefsHead = $("div");
      prefsHead.className = "ai-subhead";
      prefsHead.textContent = "SharedPreferences";
      sec.appendChild(prefsHead);
      const prefsList = $("div");
      prefsList.className = "ai-file-list";
      sec.appendChild(prefsList);

      // Databases
      const dbHead = $("div");
      dbHead.className = "ai-subhead";
      dbHead.textContent = "Databases";
      sec.appendChild(dbHead);
      const dbList = $("div");
      dbList.className = "ai-file-list";
      sec.appendChild(dbList);

      // Files
      const filesHead = $("div");
      filesHead.className = "ai-subhead";
      filesHead.textContent = "Files";
      sec.appendChild(filesHead);
      const filesList = $("div");
      filesList.className = "ai-file-list";
      sec.appendChild(filesList);

      // Cache
      const cacheHead = $("div");
      cacheHead.className = "ai-subhead";
      cacheHead.textContent = "Cache";
      sec.appendChild(cacheHead);
      const cacheList = $("div");
      cacheList.className = "ai-file-list";
      sec.appendChild(cacheList);

      const output = api.ui.outputPane();
      output.style.marginTop = "10px";
      sec.appendChild(output);

      const addFileRow = (listEl, name, viewFn) => {
        const row = $("div");
        row.className = "ai-file-row";
        const nameEl = $("span");
        nameEl.className = "ai-file-name";
        nameEl.textContent = name;
        row.appendChild(nameEl);
        if (viewFn) {
          const view = api.ui.button({ label: "View" });
          view.className += " ai-file-view";
          view.addEventListener("click", async () => {
            output._clear();
            try {
              output._append(await viewFn());
            } catch (e) {
              output._append("Read failed: " + e);
            }
          });
          row.appendChild(view);
        }
        listEl.appendChild(row);
      };

      const addDir = async (listEl, cmd, label) => {
        try {
          const out = await cmd();
          if (!out || out.includes("__NONE__") || out.includes("No such file")) {
            const p = $("p");
            p.className = "ai-note";
            p.textContent = label + ": empty or not accessible (root may be required).";
            listEl.appendChild(p);
            return;
          }
          for (const name of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
            if (name.startsWith("total")) continue;
            addFileRow(listEl, name, () => readPrefsFile(dataDir + "/shared_prefs/" + name));
          }
        } catch (e) {
          const p = $("p");
          p.className = "ai-note";
          p.textContent = label + ": " + e;
          listEl.appendChild(p);
        }
      };

      const addDbs = async () => {
        try {
          const out = await listDatabases(dataDir);
          if (!out || out.includes("__NONE__")) {
            const p = $("p");
            p.className = "ai-note";
            p.textContent = "Databases: none or not accessible.";
            dbList.appendChild(p);
            return;
          }
          for (const name of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
            const full = dataDir + "/databases/" + name;
            addFileRow(dbList, name, async () => {
              const tables = await sqliteTables(full);
              if (tables.includes("__NO_SQLITE__")) {
                return "sqlite3 is not available on this device.";
              }
              return "Tables in " + name + ":\n" + tables;
            });
          }
        } catch (e) {
          const p = $("p");
          p.className = "ai-note";
          p.textContent = "Databases: " + e;
          dbList.appendChild(p);
        }
      };

      const addPlain = async (listEl, cmd, label) => {
        try {
          const out = await cmd();
          if (!out || out.includes("__NONE__")) {
            const p = $("p");
            p.className = "ai-note";
            p.textContent = label + ": none or not accessible.";
            listEl.appendChild(p);
            return;
          }
          for (const name of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
            addFileRow(listEl, name, null);
          }
        } catch (e) {
          const p = $("p");
          p.className = "ai-note";
          p.textContent = label + ": " + e;
          listEl.appendChild(p);
        }
      };

      addDir(prefsList, () => listSharedPrefs(dataDir), "SharedPreferences");
      addDbs();
      addPlain(filesList, () => listFiles(dataDir), "Files");
      addPlain(cacheList, () => listCache(dataDir), "Cache");

      body.appendChild(sec);
      return card;
    }

    function buildRaw(dump) {
      const { card, body } = makeCard("Raw dumpsys", "Full package dump, if you want to dig deeper.");
      const output = api.ui.outputPane();
      output.style.maxHeight = "260px";
      output._append(dump);
      body.appendChild(output);
      return card;
    }

    function failCard(msg) {
      const { card, body } = makeCard("Error", msg);
      const p = $("p");
      p.className = "ai-note ai-note-danger";
      p.textContent = msg;
      body.appendChild(p);
      return card;
    }

    refreshPackages();
  },
});

function populateSelect(sel, items, preferred) {
  const prev = sel.value;
  sel.innerHTML = "";
  for (const item of items) {
    const opt = $("option");
    opt.value = item;
    opt.textContent = item;
    sel.appendChild(opt);
  }
  if (items.includes(preferred)) sel.value = preferred;
  else if (items.includes(prev)) sel.value = prev;
}