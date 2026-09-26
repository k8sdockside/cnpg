// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/cnpg.ts
  var CLUSTERS = "crd:clusters.postgresql.cnpg.io";
  var BACKUPS = "crd:backups.postgresql.cnpg.io";
  var SCHEDULED_BACKUPS = "crd:scheduledbackups.postgresql.cnpg.io";
  var POOLERS = "crd:poolers.postgresql.cnpg.io";
  var PODS = "pods";
  var PVCS = "persistentvolumeclaims";
  var SERVICES = "services";
  var NODES = "nodes";
  var LABEL = {
    cluster: "cnpg.io/cluster",
    /** `primary` or `replica` on an instance pod; the current label. */
    instanceRole: "cnpg.io/instanceRole",
    /** The same, under the name older operators used. Still set, deprecated. */
    legacyRole: "role",
    /** `instance` or `pooler`. */
    podRole: "cnpg.io/podRole",
    instanceName: "cnpg.io/instanceName",
    /** `PG_DATA`, `PG_WAL` or `PG_TABLESPACE` on a PVC. */
    pvcRole: "cnpg.io/pvcRole",
    poolerName: "cnpg.io/poolerName",
    /** Set on a pod that is a job: `initdb`, `join`, `snapshot-recovery` ... */
    jobRole: "cnpg.io/jobRole",
    /** The ScheduledBackup a Backup was made by. */
    scheduledBackup: "cnpg.io/scheduled-backup"
  };
  var ANNOTATION = {
    /** `on` hibernates the cluster, `off` (or absent) wakes it. */
    hibernation: "cnpg.io/hibernation",
    /** A new timestamp here is what `kubectl cnpg restart` writes: a rolling restart. */
    restartedAt: "kubectl.kubernetes.io/restartedAt",
    /** A JSON list of fenced instance names, or `["*"]`. */
    fencedInstances: "cnpg.io/fencedInstances"
  };
  var CONDITION = {
    ready: "Ready",
    archiving: "ContinuousArchiving",
    lastBackup: "LastBackupSucceeded",
    hibernation: "cnpg.io/hibernation"
  };
  function condition(conditions, type) {
    return (conditions ?? []).find((c) => c.type === type);
  }
  function key(namespace, name) {
    return `${namespace ?? ""}/${name ?? ""}`;
  }

  // src/model/units.ts
  function severity(tone) {
    return tone === "error" ? 3 : tone === "warn" ? 2 : tone === "info" ? 1 : 0;
  }
  function worst(a, b) {
    return severity(b) > severity(a) ? b : a;
  }
  function size(value2) {
    if (!Number.isFinite(value2) || value2 <= 0) return "0";
    const units = ["B", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];
    let n = value2;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
      n /= 1024;
      unit++;
    }
    const digits = n >= 100 || unit === 0 || Number.isInteger(n) ? 0 : n >= 10 ? 1 : 2;
    return `${Number(n.toFixed(digits))} ${units[unit]}`;
  }
  function quantity(value2) {
    if (typeof value2 === "number") return Number.isFinite(value2) ? value2 : 0;
    if (!value2) return 0;
    const match = /^\s*([0-9.]+)\s*([EPTGMk]i?|m)?\s*$/.exec(value2);
    if (!match) return 0;
    const n = Number(match[1]);
    if (!Number.isFinite(n)) return 0;
    const suffix = match[2] ?? "";
    const binary = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
    const decimal = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, m: 1e-3 };
    return n * (binary[suffix] ?? decimal[suffix] ?? 1);
  }
  var SECOND = 1e3;
  var MINUTE = 60 * SECOND;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;
  function span(ms) {
    if (!Number.isFinite(ms)) return "—";
    const abs = Math.max(0, Math.round(ms / 1e3));
    if (abs < 60) return `${abs}s`;
    const minutes = Math.floor(abs / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 14) return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
    return `${Math.floor(days / 7)}w`;
  }
  function parseTime(timestamp) {
    if (!timestamp) return void 0;
    const then = Date.parse(timestamp);
    return Number.isNaN(then) ? void 0 : then;
  }

  // src/ui/dom.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value2] of Object.entries(attrs)) {
      if (value2 === void 0 || value2 === false) continue;
      if (name === "class") node.className = String(value2);
      else if (name === "text") node.textContent = String(value2);
      else node.setAttribute(name, String(value2));
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(child);
    }
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }

  // src/model/cron.ts
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var FIELDS = [
    { min: 0, max: 59 },
    // second
    { min: 0, max: 59 },
    // minute
    { min: 0, max: 23 },
    // hour
    { min: 1, max: 31 },
    // day of month
    { min: 1, max: 12, names: MONTHS },
    // month
    { min: 0, max: 6, names: WEEKDAYS }
    // day of week
  ];
  function parse(source) {
    const spec = (source ?? "").trim();
    if (!spec) return { ok: false, error: "the schedule is empty" };
    if (spec.startsWith("@")) return descriptor(spec);
    const parts = spec.split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      return { ok: false, error: `expected 5 or 6 fields (seconds first), found ${parts.length}` };
    }
    if (parts.length === 5) parts.push("*");
    const fields = [];
    for (let i = 0; i < 6; i++) {
      const field = FIELDS[i];
      const parsed = parseField(parts[i], field);
      if (typeof parsed === "string") return { ok: false, error: parsed };
      fields.push(parsed);
    }
    return { ok: true, schedule: { kind: "spec", fields, source: spec } };
  }
  function descriptor(spec) {
    const fixed = {
      "@yearly": "0 0 0 1 1 *",
      "@annually": "0 0 0 1 1 *",
      "@monthly": "0 0 0 1 * *",
      "@weekly": "0 0 0 * * 0",
      "@daily": "0 0 0 * * *",
      "@midnight": "0 0 0 * * *",
      "@hourly": "0 0 * * * *"
    };
    const lower = spec.toLowerCase();
    if (fixed[lower]) {
      const parsed = parse(fixed[lower]);
      if (parsed.ok && parsed.schedule.kind === "spec") parsed.schedule.source = spec;
      return parsed;
    }
    if (lower.startsWith("@every ")) {
      const every = goDuration(spec.slice(7).trim());
      if (every === void 0 || every <= 0) return { ok: false, error: `cannot read the duration in "${spec}"` };
      return { ok: true, schedule: { kind: "every", every, source: spec } };
    }
    return { ok: false, error: `unrecognised descriptor "${spec}"` };
  }
  function parseField(text, field) {
    const values = new Array(field.max + 1).fill(false);
    let star = false;
    for (const expr of text.split(",")) {
      const [range = "", stepText, extra] = expr.split("/");
      if (extra !== void 0) return `too many slashes in "${expr}"`;
      let start2;
      let end;
      const bounds = range.split("-");
      if (range === "*" || range === "?") {
        start2 = field.min;
        end = field.max;
        star = true;
      } else {
        if (bounds.length > 2) return `too many hyphens in "${expr}"`;
        const low = value(bounds[0] ?? "", field);
        if (low === void 0) return `cannot read "${bounds[0]}" in "${text}"`;
        start2 = low;
        end = low;
        if (bounds.length === 2) {
          const high = value(bounds[1] ?? "", field);
          if (high === void 0) return `cannot read "${bounds[1]}" in "${text}"`;
          end = high;
        }
      }
      let step = 1;
      if (stepText !== void 0) {
        if (!/^\d+$/.test(stepText) || Number(stepText) === 0) return `bad step in "${expr}"`;
        step = Number(stepText);
        if (bounds.length === 1 && range !== "*" && range !== "?") end = field.max;
      }
      if (start2 < field.min || end > field.max || start2 > end) return `"${expr}" is out of range ${field.min}-${field.max}`;
      for (let v = start2; v <= end; v += step) values[v] = true;
    }
    return { values, star, raw: text };
  }
  function value(text, field) {
    const named = field.names?.[text.toLowerCase()];
    if (named !== void 0) return named;
    return /^\d+$/.test(text) ? Number(text) : void 0;
  }
  function goDuration(text) {
    const units = { h: HOUR, m: MINUTE, s: SECOND, ms: 1 };
    let total = 0;
    let rest = text;
    if (!rest) return void 0;
    while (rest) {
      const match = /^(\d+(?:\.\d+)?)(ms|h|m|s)/.exec(rest);
      if (!match) return void 0;
      total += Number(match[1]) * (units[match[2]] ?? 0);
      rest = rest.slice(match[0].length);
    }
    return total;
  }
  function next(schedule, from) {
    if (schedule.kind === "every") {
      return Math.floor((from + schedule.every) / SECOND) * SECOND;
    }
    const [sec, min, hour, dom, month, dow] = schedule.fields;
    const d = new Date(Math.floor(from / SECOND) * SECOND + SECOND);
    const limit = from + 5 * 366 * DAY;
    while (d.getTime() <= limit) {
      if (!month.values[d.getUTCMonth() + 1]) {
        d.setUTCMonth(d.getUTCMonth() + 1, 1);
        d.setUTCHours(0, 0, 0, 0);
        continue;
      }
      if (!dayMatches(dom, dow, d)) {
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(0, 0, 0, 0);
        continue;
      }
      if (!hour.values[d.getUTCHours()]) {
        d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
        continue;
      }
      if (!min.values[d.getUTCMinutes()]) {
        d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
        continue;
      }
      if (!sec.values[d.getUTCSeconds()]) {
        d.setUTCSeconds(d.getUTCSeconds() + 1, 0);
        continue;
      }
      return d.getTime();
    }
    return void 0;
  }
  function dayMatches(dom, dow, d) {
    const domMatch = dom.values[d.getUTCDate()] === true;
    const dowMatch = dow.values[d.getUTCDay()] === true;
    return dom.star || dow.star ? domMatch && dowMatch : domMatch || dowMatch;
  }
  function interval(schedule, from) {
    if (schedule.kind === "every") return schedule.every;
    const first = next(schedule, from);
    if (first === void 0) return void 0;
    const second = next(schedule, first);
    return second === void 0 ? void 0 : second - first;
  }
  var DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  function words(schedule) {
    if (schedule.kind === "every") return `every ${everyWords(schedule.every)}`;
    const [sec, min, hour, dom, month, dow] = schedule.fields;
    const single = (set) => /^\d+$/.test(set.raw) ? Number(set.raw) : void 0;
    const stepOf = (set) => {
      const m2 = /^(?:\*|0)\/(\d+)$/.exec(set.raw);
      return m2 ? Number(m2[1]) : void 0;
    };
    const any = (set) => set.raw === "*" || set.raw === "?";
    const two = (n) => String(n).padStart(2, "0");
    const s = single(sec);
    const m = single(min);
    const h = single(hour);
    if (!any(month) || s === void 0) return "on a custom schedule";
    const everyDay = any(dom) && any(dow);
    if (everyDay && any(hour)) {
      const minuteStep = stepOf(min);
      if (minuteStep !== void 0) return minuteStep === 1 ? "every minute" : `every ${minuteStep} minutes`;
      if (m !== void 0) return `every hour at :${two(m)}`;
      if (min.raw === "*") return "every minute";
    }
    if (everyDay && m !== void 0) {
      const hourStep = stepOf(hour);
      if (hourStep !== void 0) return `every ${hourStep} hours at :${two(m)}`;
    }
    if (m === void 0 || h === void 0) return "on a custom schedule";
    const at = `at ${two(h)}:${two(m)} UTC`;
    if (everyDay) return `daily ${at}`;
    if (any(dom)) {
      const days = DAY_NAMES.filter((_, i) => dow.values[i]);
      if (days.length === 5 && !dow.values[0] && !dow.values[6]) return `on weekdays ${at}`;
      if (days.length > 0 && days.length <= 3) return `on ${days.join(", ")} ${at}`;
    }
    const day = single(dom);
    if (any(dow) && day !== void 0) return `on day ${day} of every month ${at}`;
    return "on a custom schedule";
  }
  function everyWords(ms) {
    if (ms % HOUR === 0) return ms === HOUR ? "hour" : `${ms / HOUR} hours`;
    if (ms % MINUTE === 0) return ms === MINUTE ? "minute" : `${ms / MINUTE} minutes`;
    return `${Math.round(ms / SECOND)} seconds`;
  }
  function cronFor(source, now) {
    const parsed = parse(source);
    if (!parsed.ok) return { words: "a schedule the operator cannot read", error: parsed.error, next: void 0, every: void 0 };
    return { words: words(parsed.schedule), error: "", next: next(parsed.schedule, now), every: interval(parsed.schedule, now) };
  }

  // src/model/backups.ts
  var PHASES = {
    pending: { state: "pending", words: "Pending", tone: "info" },
    started: { state: "running", words: "Started", tone: "info" },
    running: { state: "running", words: "Running", tone: "info" },
    finalizing: { state: "running", words: "Finalizing", tone: "info" },
    completed: { state: "completed", words: "Completed", tone: "ok" },
    failed: { state: "failed", words: "Failed", tone: "error" },
    walArchivingFailing: { state: "failed", words: "WAL archiving failing", tone: "error" },
    "invalid backup definition": { state: "failed", words: "Invalid definition", tone: "error" }
  };
  function methodWords(method, plugin = "") {
    switch (method) {
      case "barmanObjectStore":
        return "object store";
      case "volumeSnapshot":
        return "volume snapshot";
      case "plugin":
        return plugin ? `plugin ${plugin}` : "plugin";
      default:
        return method || "object store";
    }
  }
  function backupView(backup) {
    const phase = backup.status?.phase ?? "";
    const known = PHASES[phase];
    const method = backup.status?.method ?? backup.spec?.method ?? "barmanObjectStore";
    const started = parseTime(backup.status?.startedAt);
    const stopped = parseTime(backup.status?.stoppedAt);
    const created = parseTime(backup.metadata.creationTimestamp);
    const owner = (backup.metadata.ownerReferences ?? []).find((ref) => ref.kind === "ScheduledBackup");
    return {
      backup,
      name: backup.metadata.name,
      namespace: backup.metadata.namespace ?? "",
      cluster: backup.spec?.cluster?.name ?? "",
      phase,
      state: known?.state ?? (phase ? "unknown" : "pending"),
      words: known?.words ?? (phase || "Not started"),
      tone: known?.tone ?? (phase ? "warn" : "info"),
      method,
      methodWords: methodWords(method, backup.spec?.pluginConfiguration?.name ?? ""),
      at: stopped ?? started ?? created,
      started,
      stopped,
      took: started !== void 0 && stopped !== void 0 && stopped >= started ? stopped - started : void 0,
      error: (backup.status?.error || backup.status?.commandError || "").trim(),
      scheduledBy: backup.metadata.labels?.[LABEL.scheduledBackup] ?? owner?.name ?? "",
      instance: backup.status?.instanceID?.podName ?? ""
    };
  }
  function scheduleView(scheduled, now) {
    const schedule = scheduled.spec?.schedule ?? "";
    const cron = cronFor(schedule, now);
    const method = scheduled.spec?.method ?? "barmanObjectStore";
    const suspended = scheduled.spec?.suspend === true;
    const fromStatus = parseTime(scheduled.status?.nextScheduleTime);
    return {
      scheduled,
      name: scheduled.metadata.name,
      namespace: scheduled.metadata.namespace ?? "",
      cluster: scheduled.spec?.cluster?.name ?? "",
      schedule,
      words: cron.words,
      invalid: cron.error,
      suspended,
      method,
      methodWords: methodWords(method, scheduled.spec?.pluginConfiguration?.name ?? ""),
      // A suspended schedule has no next run, whatever the status last said.
      next: suspended ? void 0 : fromStatus !== void 0 && fromStatus > now ? fromStatus : cron.next,
      every: cron.every,
      last: parseTime(scheduled.status?.lastScheduleTime),
      error: scheduled.status?.error ?? ""
    };
  }
  function freshness(last, every, configured, now) {
    if (!configured) return { tone: "warn", words: "not configured", why: "This cluster has no backup configuration: nothing could bring its data back." };
    if (last === void 0) return { tone: "warn", words: "never", why: "Backups are configured, but none has completed yet." };
    const age = Math.max(0, now - last);
    const words2 = `${span(age)} ago`;
    const warnAfter = every ? Math.max(2 * every, 10 * 60 * 1e3) : 26 * HOUR;
    const errorAfter = every ? Math.max(6 * every, 30 * 60 * 1e3) : 7 * DAY;
    const basis = every ? `its schedule runs every ${span(every)}` : "there is no schedule, so a day is the measure";
    if (age > errorAfter) return { tone: "error", words: words2, why: `Much older than it should be: ${basis}.` };
    if (age > warnAfter) return { tone: "warn", words: words2, why: `Older than it should be: ${basis}.` };
    return { tone: "ok", words: words2, why: every ? `On schedule: ${basis}.` : "Within the last day." };
  }
  function methodsOf(cluster) {
    const backup = cluster.spec?.backup;
    const methods = [];
    if (backup?.barmanObjectStore) methods.push("barmanObjectStore");
    if (backup?.volumeSnapshot) methods.push("volumeSnapshot");
    if ((cluster.spec?.plugins ?? []).some((plugin) => plugin.isWALArchiver || /barman/i.test(plugin.name ?? ""))) methods.push("plugin");
    return methods;
  }
  function summarise(cluster, allBackups, allSchedules, now) {
    const name = cluster.metadata.name;
    const namespace = cluster.metadata.namespace ?? "";
    const backups = allBackups.filter((b) => (b.metadata.namespace ?? "") === namespace && b.spec?.cluster?.name === name).map(backupView).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const schedules = allSchedules.filter((s) => (s.metadata.namespace ?? "") === namespace && s.spec?.cluster?.name === name).map((s) => scheduleView(s, now));
    const completed = backups.filter((b) => b.state === "completed");
    const status = cluster.status ?? {};
    const fromCluster = parseTime(status.lastSuccessfulBackup);
    const fromBackups = completed[0]?.stopped ?? completed[0]?.at;
    const last = [fromCluster, fromBackups].filter((t) => t !== void 0).sort((a, b) => b - a)[0];
    const firstFromCluster = parseTime(status.firstRecoverabilityPoint);
    const oldest = completed[completed.length - 1];
    const firstFromBackups = oldest?.stopped ?? oldest?.at;
    const firstPoint = firstFromCluster ?? firstFromBackups;
    const methods = methodsOf(cluster);
    const configured = methods.length > 0 || schedules.length > 0;
    const active = schedules.filter((s) => !s.suspended && !s.invalid);
    const every = active.map((s) => s.every).filter((e) => e !== void 0).sort((a, b) => a - b)[0];
    const next2 = active.map((s) => s.next).filter((n) => n !== void 0).sort((a, b) => a - b)[0];
    const lastOk = last ?? -Infinity;
    const failures = backups.filter((b) => b.state === "failed" && (b.at ?? 0) > lastOk);
    const archivingCondition = (status.conditions ?? []).find((c) => c.type === "ContinuousArchiving");
    return {
      methods,
      configured,
      last,
      lastFailed: parseTime(status.lastFailedBackup) ?? backups.find((b) => b.state === "failed")?.at,
      firstPoint,
      estimated: firstFromCluster === void 0 && firstFromBackups !== void 0,
      archiving: archivingCondition ? archivingCondition.status === "True" : void 0,
      freshness: freshness(last, every, configured, now),
      backups,
      schedules,
      running: backups.filter((b) => b.state === "running" || b.state === "pending"),
      failures,
      next: next2
    };
  }

  // src/model/metrics.ts
  function labels(name) {
    const out = {};
    for (const part of name.split(", ")) {
      const eq = part.indexOf("=");
      if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
    }
    return out;
  }
  function latest(points) {
    for (let i = points.length - 1; i >= 0; i--) {
      const v = points[i]?.v;
      if (v !== void 0 && Number.isFinite(v)) return v;
    }
    return void 0;
  }
  function byPod(chart) {
    const out = /* @__PURE__ */ new Map();
    for (const series of chart?.series ?? []) {
      const l = labels(series.name);
      if (!l.pod || !l.namespace) continue;
      const value2 = latest(series.points);
      if (value2 !== void 0) out.set(key(l.namespace, l.pod), value2);
    }
    return out;
  }
  var LAG_WARN = 30;
  var LAG_ERROR = 300;

  // src/model/health.ts
  var PHASES2 = {
    "Cluster in healthy state": { words: "Healthy", tone: "ok", state: "healthy" },
    "Switchover in progress": { words: "Switching primary", tone: "warn", state: "switchover" },
    "Failing over": { words: "Failing over", tone: "error", state: "failover" },
    "Setting up primary": { words: "Creating the primary", tone: "info", state: "working" },
    "Creating a new replica": { words: "Adding a replica", tone: "info", state: "working" },
    "Upgrading cluster": { words: "Upgrading", tone: "info", state: "working" },
    "Upgrading Postgres major version": { words: "Major version upgrade", tone: "info", state: "working" },
    "Cluster upgrade delayed": { words: "Upgrade delayed", tone: "warn", state: "working" },
    "Waiting for user action": { words: "Waiting for you", tone: "warn", state: "working" },
    "Primary instance is being restarted in-place": { words: "Restarting the primary", tone: "info", state: "working" },
    "Primary instance is being restarted without a switchover": { words: "Restarting the primary", tone: "info", state: "working" },
    "Cluster cannot proceed to reconciliation due to an unknown plugin being required": { words: "Unknown plugin", tone: "error", state: "failing" },
    "Cluster cannot proceed to reconciliation due to an error while interacting with plugins": { words: "Plugin error", tone: "error", state: "failing" },
    "Cluster has incomplete or invalid image catalog": { words: "Image catalog error", tone: "error", state: "failing" },
    "Cluster is unrecoverable and needs manual intervention": { words: "Unrecoverable", tone: "error", state: "failing" },
    "Cluster cannot execute instance online upgrade due to missing architecture binary": { words: "Missing binary", tone: "error", state: "failing" },
    "Waiting for the instances to become active": { words: "Waiting for instances", tone: "warn", state: "working" },
    "Online upgrade in progress": { words: "Online upgrade", tone: "info", state: "working" },
    "Applying configuration": { words: "Applying configuration", tone: "info", state: "working" },
    "Promoting to primary cluster": { words: "Promoting", tone: "info", state: "working" },
    "Unable to create required cluster objects": { words: "Cannot create objects", tone: "error", state: "failing" },
    "Invalid cluster definition": { words: "Invalid definition", tone: "error", state: "failing" }
  };
  function versionOf(image) {
    const tag = image.split("@")[0]?.split("/").pop()?.split(":")[1] ?? "";
    const match = /^(\d+(?:\.\d+)?)/.exec(tag);
    return match?.[1] ?? "";
  }
  function storageOf(config) {
    return quantity(config?.size ?? config?.pvcTemplate?.resources?.requests?.storage);
  }
  function clusterView(cluster) {
    const spec = cluster.spec ?? {};
    const status = cluster.status ?? {};
    const phase = status.phase ?? "";
    const known = PHASES2[phase];
    const instances = spec.instances ?? status.instances ?? 0;
    const ready = status.readyInstances ?? 0;
    const image = status.image ?? spec.imageName ?? "";
    const catalogMajor = spec.imageCatalogRef?.major;
    let words2 = known?.words ?? (phase || "Not reconciled yet");
    let tone = known?.tone ?? (phase ? "warn" : "");
    let state = known?.state ?? "unknown";
    const hibernationRequested = (cluster.metadata.annotations?.[ANNOTATION.hibernation] ?? "") === "on";
    const hibernation = condition(status.conditions, CONDITION.hibernation);
    const hibernatedNow = hibernation?.status === "True" && hibernation.reason === "Hibernated";
    if (hibernationRequested) {
      state = hibernatedNow ? "hibernated" : "hibernating";
      words2 = hibernatedNow ? "Hibernated" : "Going to sleep";
      tone = "info";
    } else if (hibernatedNow || hibernation?.status === "True" && ready < instances) {
      state = "waking";
      words2 = "Waking up";
      tone = "info";
    } else if (state === "healthy" && ready < instances) {
      state = "degraded";
      words2 = ready === 0 ? "No instance ready" : `${ready} of ${instances} ready`;
      tone = ready === 0 ? "error" : "warn";
    }
    const synchronous = spec.postgresql?.synchronous;
    let sync = null;
    if (synchronous && (synchronous.number ?? 0) > 0) {
      sync = { number: synchronous.number ?? 0, method: synchronous.method ?? "any" };
    } else if ((spec.minSyncReplicas ?? 0) > 0 || (spec.maxSyncReplicas ?? 0) > 0) {
      sync = { number: spec.maxSyncReplicas || spec.minSyncReplicas || 0, method: "any" };
    }
    const archivingCondition = condition(status.conditions, CONDITION.archiving);
    const archiving = archivingCondition ? { ok: archivingCondition.status === "True", message: archivingCondition.message ?? archivingCondition.reason ?? "" } : null;
    return {
      cluster,
      name: cluster.metadata.name,
      namespace: cluster.metadata.namespace ?? "",
      description: spec.description ?? "",
      phase,
      phaseReason: status.phaseReason ?? "",
      words: words2,
      tone,
      state,
      instances,
      ready,
      primary: status.currentPrimary ?? "",
      targetPrimary: status.targetPrimary ?? "",
      timeline: status.timelineID,
      image,
      version: versionOf(image) || (catalogMajor ? String(catalogMajor) : "") || (status.pgDataImageInfo?.majorVersion ? String(status.pgDataImageInfo.majorVersion) : ""),
      storage: storageOf(spec.storage),
      walStorage: storageOf(spec.walStorage),
      storageClass: spec.storage?.storageClass ?? spec.storage?.pvcTemplate?.storageClassName ?? "",
      hibernationRequested,
      sync,
      replicaCluster: spec.replica?.enabled === true,
      archiving
    };
  }

  // src/model/topology.ts
  var ZONE_LABELS = ["topology.kubernetes.io/zone", "failure-domain.beta.kubernetes.io/zone"];
  function podReady(pod) {
    if (!pod) return false;
    const cond = pod.status?.conditions?.find((c) => c.type === "Ready");
    if (cond) return cond.status === "True";
    const containers = pod.status?.containerStatuses ?? [];
    return containers.length > 0 && containers.every((c) => c.ready === true);
  }
  function podTrouble(pod) {
    if (!pod) return "no pod";
    for (const container of pod.status?.containerStatuses ?? []) {
      const reason = container.state?.waiting?.reason ?? container.state?.terminated?.reason;
      if (reason) return reason;
    }
    if (pod.status?.phase && pod.status.phase !== "Running") return pod.status.phase;
    return podReady(pod) ? "" : "not ready";
  }
  function isInstancePod(pod, cluster) {
    const labels2 = pod.metadata.labels ?? {};
    if (labels2[LABEL.cluster] !== cluster) return false;
    if (labels2[LABEL.jobRole] || labels2[LABEL.poolerName]) return false;
    return labels2[LABEL.podRole] === "instance" || labels2[LABEL.instanceName] !== void 0 || labels2[LABEL.instanceRole] !== void 0 || labels2[LABEL.legacyRole] !== void 0;
  }
  function build(cluster, sources) {
    const view = clusterView(cluster);
    const { name, namespace } = view;
    const status = cluster.status ?? {};
    const inNamespace = (items) => items.filter((item) => (item.metadata.namespace ?? "") === namespace);
    const pods = inNamespace(sources.pods).filter((pod) => isInstancePod(pod, name));
    const podsByName = new Map(pods.map((pod) => [pod.metadata.name, pod]));
    const nodesByName = new Map(sources.nodes.map((node) => [node.metadata.name, node]));
    const names = /* @__PURE__ */ new Set([...status.instanceNames ?? [], ...Object.keys(status.instancesReportedState ?? {}), ...pods.map((pod) => pod.metadata.name)]);
    const claims = inNamespace(sources.pvcs).filter((pvc) => pvc.metadata.labels?.[LABEL.cluster] === name);
    if (names.size === 0) {
      for (const pvc of claims) {
        const instance = pvc.metadata.labels?.[LABEL.instanceName];
        if (instance) names.add(instance);
      }
    }
    const reported = /* @__PURE__ */ new Map();
    for (const [state, list] of Object.entries(status.instancesStatus ?? {})) {
      for (const instance of list ?? []) reported.set(instance, state);
    }
    const hibernated = view.state === "hibernated";
    const primaryName = view.primary;
    const moving = view.targetPrimary && view.targetPrimary !== primaryName && view.targetPrimary !== "pending" ? view.targetPrimary : "";
    const instances = [...names].sort(byOrdinal).map((instance) => {
      const pod = podsByName.get(instance);
      const labels2 = pod?.metadata.labels ?? {};
      const role = labels2[LABEL.instanceRole] ?? labels2[LABEL.legacyRole] ?? "";
      const primary2 = instance === primaryName || !primaryName && (role === "primary" || status.instancesReportedState?.[instance]?.isPrimary === true);
      const nodeName = pod?.spec?.nodeName ?? "";
      const node = nodesByName.get(nodeName);
      const topologyLabels = status.topology?.instances?.[instance] ?? {};
      const zone = ZONE_LABELS.map((label) => node?.metadata.labels?.[label] ?? topologyLabels[label]).find((z) => z) ?? "";
      const volumes = claims.filter((pvc) => pvc.metadata.labels?.[LABEL.instanceName] === instance || pvc.metadata.name === instance || pvc.metadata.name === `${instance}-wal`).map((pvc) => ({
        name: pvc.metadata.name,
        role: pvc.metadata.labels?.[LABEL.pvcRole] ?? (pvc.metadata.name.endsWith("-wal") ? "PG_WAL" : "PG_DATA"),
        bytes: quantity(pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage),
        phase: pvc.status?.phase ?? ""
      })).sort((a, b) => a.role.localeCompare(b.role));
      const ready = podReady(pod);
      const lag = sources.lag?.get(key(namespace, instance));
      return {
        name: instance,
        namespace,
        primary: primary2,
        becomingPrimary: instance === moving,
        reported: reported.get(instance) ?? "",
        podFound: pod !== void 0,
        ready,
        trouble: hibernated ? "" : podTrouble(pod),
        restarts: (pod?.status?.containerStatuses ?? []).reduce((n, c) => n + (c.restartCount ?? 0), 0),
        node: nodeName,
        zone,
        timeline: status.instancesReportedState?.[instance]?.timeLineID,
        volumes,
        lag,
        streaming: false,
        link: "none",
        tone: "",
        note: ""
      };
    });
    const primary = instances.find((i) => i.primary);
    const replicas = instances.filter((i) => !i.primary);
    const sync = view.sync;
    for (const instance of instances) judge(instance, { hibernated, sync: sync !== null && !view.replicaCluster });
    const syncWords = hibernated ? "hibernated: nothing replicates while the pods are gone" : replicas.length === 0 ? "no standby: a single instance" : view.replicaCluster ? `a replica cluster: the primary here follows ${cluster.spec?.replica?.source ?? "another cluster"}` : sync ? `${sync.method === "first" ? "the first" : "any"} ${sync.number} of ${replicas.length} standby${replicas.length === 1 ? "" : "s"} must confirm each commit (synchronous)` : "asynchronous: commits do not wait for a standby";
    const entries = entryPoints(cluster, view, inNamespace(sources.poolers), inNamespace(sources.pods), inNamespace(sources.services));
    const nodeNames = instances.map((i) => i.node).filter((n) => n !== "");
    const distinct = [...new Set(nodeNames)];
    let tone = view.tone;
    for (const instance of instances) tone = worst(tone, instance.tone === "ok" ? "" : instance.tone);
    return {
      view,
      primary,
      replicas,
      entries,
      syncWords,
      nodes: distinct,
      sharedNode: distinct.length < nodeNames.length,
      tone
    };
  }
  function judge(instance, context) {
    if (context.hibernated) {
      instance.tone = "";
      instance.note = "asleep: volume kept";
      instance.link = instance.primary ? "none" : context.sync ? "sync" : "async";
      return;
    }
    if (instance.primary) {
      instance.tone = instance.ready ? "ok" : "error";
      instance.note = instance.ready ? "primary: takes the writes" : `primary, not ready${instance.trouble ? `: ${instance.trouble}` : ""}`;
      return;
    }
    instance.link = context.sync ? "sync" : "async";
    if (!instance.ready || instance.reported === "failed") {
      instance.streaming = false;
      instance.tone = "error";
      instance.note = `not streaming${instance.trouble ? `: ${instance.trouble}` : ""}`;
      return;
    }
    instance.streaming = true;
    if (instance.lag !== void 0 && instance.lag >= LAG_ERROR) {
      instance.tone = "error";
      instance.note = `streaming, ${span(instance.lag * 1e3)} behind`;
    } else if (instance.lag !== void 0 && instance.lag >= LAG_WARN) {
      instance.tone = "warn";
      instance.note = `streaming, ${span(instance.lag * 1e3)} behind`;
    } else {
      instance.tone = "ok";
      instance.note = instance.lag === void 0 ? "streaming" : instance.lag < 1 ? "streaming, in step" : `streaming, ${span(instance.lag * 1e3)} behind`;
    }
    if (instance.becomingPrimary) {
      instance.tone = worst(instance.tone, "warn");
      instance.note = "being promoted to primary";
    }
  }
  function entryPoints(cluster, view, poolers, pods, services) {
    const out = [];
    for (const pooler of poolers) {
      if (pooler.spec?.cluster?.name !== view.name) continue;
      const name = pooler.metadata.name;
      const mine = pods.filter((pod) => pod.metadata.labels?.[LABEL.poolerName] === name);
      const ready = mine.filter(podReady).length;
      const wanted = pooler.spec?.instances ?? 1;
      const phase = pooler.status?.phase ?? "";
      const paused = pooler.spec?.pgbouncer?.paused === true || phase === "paused";
      let tone = "ok";
      let note = `${ready} of ${wanted} ready`;
      if (phase === "failed" || phase === "inactive") {
        tone = "error";
        note = pooler.status?.phaseReason || pooler.status?.error || phase;
      } else if (view.state === "hibernated") {
        tone = "";
        note = "no primary to send to while hibernated";
      } else if (wanted > 0 && ready === 0) {
        tone = "error";
        note = `none of ${wanted} ready`;
      } else if (ready < wanted) {
        tone = "warn";
      }
      if (paused) {
        tone = worst(tone, "warn");
        note = `paused: holding new connections · ${note}`;
      }
      const mode = pooler.spec?.pgbouncer?.poolMode;
      out.push({ kind: "pooler", name, namespace: view.namespace, type: pooler.spec?.type ?? "rw", ready, wanted, tone, note: mode ? `${note} · ${mode} pooling` : note });
    }
    for (const [suffix, type, words2] of [
      ["-rw", "rw", "the primary"],
      ["-ro", "ro", "the standbys"],
      ["-r", "r", "any instance"]
    ]) {
      const service = services.find((s) => s.metadata.name === `${cluster.metadata.name}${suffix}`);
      if (!service) continue;
      const port = service.spec?.ports?.[0]?.port;
      out.push({ kind: "service", name: service.metadata.name, namespace: view.namespace, type, ready: 0, wanted: 0, tone: "", note: `to ${words2}${port ? ` on port ${port}` : ""}` });
    }
    return out;
  }
  function byOrdinal(a, b) {
    const na = Number(/-(\d+)$/.exec(a)?.[1] ?? NaN);
    const nb = Number(/-(\d+)$/.exec(b)?.[1] ?? NaN);
    if (Number.isFinite(na) && Number.isFinite(nb) && a.replace(/\d+$/, "") === b.replace(/\d+$/, "")) return na - nb;
    return a.localeCompare(b);
  }

  // src/ui/page.ts
  function fail(host, err) {
    const message = err instanceof Error ? err.message : String(err);
    replace(host, el("div", { class: "failure" }, el("strong", {}, "That did not work. "), el("span", {}, message)));
  }
  function start(hostId, body) {
    const run = async () => {
      const host = document.getElementById(hostId);
      try {
        const ctx = await k8sdockside.ready();
        await body(ctx);
      } catch (err) {
        if (host) fail(host, err);
      }
    };
    void run();
  }
  async function maybeList(query) {
    try {
      return await k8sdockside.list(query);
    } catch {
      return [];
    }
  }
  async function maybeCharts(minutes) {
    try {
      return await k8sdockside.charts({ minutes });
    } catch {
      return null;
    }
  }
  var focusKey = (viewId) => `focus-${viewId}`;
  async function openOn(viewId, namespace, name) {
    try {
      await k8sdockside.storage?.set(focusKey(viewId), { namespace, name });
    } catch {
    }
    await k8sdockside.openView(viewId);
  }

  // src/ui/load.ts
  async function load(options = {}) {
    const namespace = options.namespace ?? "";
    const [clusters, backups, schedules, poolers, pods, pvcs, services, nodes, charts] = await Promise.all([
      k8sdockside.list({ kind: CLUSTERS, namespace }),
      maybeList({ kind: BACKUPS, namespace }),
      maybeList({ kind: SCHEDULED_BACKUPS, namespace }),
      maybeList({ kind: POOLERS, namespace }),
      maybeList({ kind: PODS, namespace, selector: LABEL.cluster }),
      maybeList({ kind: PVCS, namespace, selector: LABEL.cluster }),
      maybeList({ kind: SERVICES, namespace, selector: LABEL.cluster }),
      maybeList({ kind: NODES }),
      options.charts ? maybeCharts(options.minutes ?? 60) : Promise.resolve(null)
    ]);
    const now = Date.now();
    const lag = byPod(charts?.charts.find((chart) => chart.id === "replication-lag"));
    const facts2 = [...clusters].sort((a, b) => (a.metadata.namespace ?? "").localeCompare(b.metadata.namespace ?? "") || a.metadata.name.localeCompare(b.metadata.name)).map((cluster) => ({
      topology: build(cluster, { pods, pvcs, poolers, services, nodes, lag }),
      backups: summarise(cluster, backups, schedules, now)
    }));
    return { now, clusters, backups, schedules, poolers, pods, pvcs, services, nodes, charts, facts: facts2 };
  }

  // src/ui/parts.ts
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
  }
  function facts(pairs) {
    const list = el("dl", { class: "facts" });
    for (const [term, value2] of pairs) {
      list.append(el("dt", {}, term), el("dd", {}, typeof value2 === "string" ? value2 || "—" : value2));
    }
    return list;
  }
  function nothing(message) {
    return el("p", { class: "empty" }, message);
  }
  function openName(label, ref, className = "link-name") {
    const node = el("button", { type: "button", class: className, title: `Open ${label}` }, label);
    node.addEventListener("click", () => void k8sdockside.open(ref));
    return node;
  }

  // src/pages/pod.ts
  start("panel", async () => {
    const host = byId("panel");
    const pod = await k8sdockside.object();
    const labels2 = pod.metadata.labels ?? {};
    const clusterName = labels2[LABEL.cluster];
    const namespace = pod.metadata.namespace ?? "";
    if (!clusterName) {
      replace(host, nothing("This pod is not part of a CloudNativePG cluster."));
      return;
    }
    const clusterRef = { kind: CLUSTERS, namespace, name: clusterName };
    const pooler = labels2[LABEL.poolerName];
    if (pooler) {
      replace(host, el("div", { class: "panel-head" }, pill("PgBouncer", "info"), el("span", {}, "in front of "), openName(clusterName, clusterRef)), facts([["Pooler", openName(pooler, { kind: POOLERS, namespace, name: pooler })]]));
      return;
    }
    const job = labels2[LABEL.jobRole];
    if (job) {
      replace(host, el("div", { class: "panel-head" }, pill(`${job} job`), el("span", {}, "for "), openName(clusterName, clusterRef)), el("p", { class: "faint" }, "A one-off job the operator ran for this cluster, not a Postgres instance."));
      return;
    }
    const world = await load({ namespace });
    const found = world.facts.find((f) => key(f.topology.view.namespace, f.topology.view.name) === key(namespace, clusterName));
    const all = found ? [...found.topology.primary ? [found.topology.primary] : [], ...found.topology.replicas] : [];
    const instance = all.find((i) => i.name === pod.metadata.name);
    const cluster = world.clusters.find((c) => c.metadata.name === clusterName);
    const primary = instance?.primary ?? (labels2[LABEL.instanceRole] ?? labels2[LABEL.legacyRole]) === "primary";
    const tone = instance?.tone ?? "";
    const head = el(
      "div",
      { class: "panel-head" },
      pill(primary ? "Primary" : "Standby", primary ? "info" : ""),
      el("span", {}, "in"),
      openName(clusterName, clusterRef),
      found ? pill(found.topology.view.words, found.topology.view.tone) : null
    );
    const pairs = [["State", el("span", { class: `tone-${tone || "none"}` }, instance?.note ?? (cluster ? "not in the cluster’s status" : "the Cluster could not be read"))]];
    if (!primary && found?.topology.primary) pairs.push(["Follows", `${found.topology.primary.name} (${instance?.link === "sync" ? "synchronous candidate" : "asynchronous"})`]);
    if (instance?.timeline !== void 0) pairs.push(["Timeline", String(instance.timeline)]);
    if (instance?.zone) pairs.push(["Zone", instance.zone]);
    if (instance?.volumes.length) pairs.push(["Disks", instance.volumes.map((v) => `${v.name} (${v.role === "PG_WAL" ? "WAL" : "data"}, ${size(v.bytes)})`).join(", ")]);
    const topology = el("button", { type: "button" }, "Open the topology");
    topology.addEventListener("click", () => void openOn("topology", namespace, clusterName));
    replace(host, head, facts(pairs), el("div", { class: "links", style: "margin-top:8px" }, topology));
  });
})();
