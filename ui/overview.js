// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
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
  function count(n, noun, plural = `${noun}s`) {
    return `${n} ${n === 1 ? noun : plural}`;
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
  function percent(part, whole) {
    if (!(whole > 0)) return 0;
    return Math.max(0, Math.min(100, part / whole * 100));
  }

  // src/model/attention.ts
  function issues(clusters) {
    const found = [];
    for (const { topology, backups } of clusters) {
      const view = topology.view;
      const at = { kind: CLUSTERS, namespace: view.namespace, name: view.name };
      const add = (tone, title, detail, ref = at) => found.push({ tone, cluster: view.name, title: `${view.name}: ${title}`, detail, ref });
      if (view.state === "hibernated" || view.state === "hibernating") {
        add("info", view.state === "hibernated" ? "hibernated" : "going into hibernation", "No pods run and the volumes are kept. Wake it up to use it again.");
        continue;
      }
      if (view.state === "failing") add("error", view.words.toLowerCase(), view.phaseReason || view.phase);
      else if (view.state === "failover") add("error", "failing over", `The primary ${view.primary} failed; ${view.targetPrimary === "pending" || !view.targetPrimary ? "a replica" : view.targetPrimary} is being promoted.`);
      else if (view.state === "switchover") add("warn", "switchover in progress", `The primary is moving from ${view.primary} to ${view.targetPrimary}.`);
      else if (view.state === "degraded") add(view.tone === "error" ? "error" : "warn", view.words, `${view.ready} of ${count(view.instances, "instance")} ready.`);
      else if (view.tone === "warn" && view.state === "working") add("warn", view.words.toLowerCase(), view.phaseReason || view.phase);
      if (topology.primary && !topology.primary.ready && view.state !== "failover" && view.state !== "switchover") {
        add("error", `the primary ${topology.primary.name} is not ready`, topology.primary.trouble || "Writes are failing until it is back or a replica is promoted.", { kind: PODS, namespace: view.namespace, name: topology.primary.name });
      }
      for (const replica of topology.replicas) {
        const pod = { kind: PODS, namespace: view.namespace, name: replica.name };
        if (!replica.streaming) add("error", `${replica.name} is not streaming`, replica.trouble ? `The standby is ${replica.trouble}.` : "The standby is not ready, so it is not keeping up with the primary.", pod);
        else if (!replica.becomingPrimary && (replica.tone === "error" || replica.tone === "warn")) add(replica.tone, `${replica.name} is lagging`, `${span((replica.lag ?? 0) * 1e3)} behind the primary.`, pod);
      }
      if (view.instances === 1 && topology.replicas.length === 0) {
        add("info", "a single instance", "Nothing stands by if its pod or its node goes; add instances for a standby to fail over to.");
      } else if (topology.sharedNode) {
        add("warn", "instances share a node", `${count(topology.nodes.length, "node")} for ${count(topology.replicas.length + (topology.primary ? 1 : 0), "instance")}: losing one node loses more than one of them.`);
      }
      for (const entry of topology.entries) {
        if (entry.kind !== "pooler" || entry.tone === "ok" || entry.tone === "") continue;
        add(entry.tone, `pooler ${entry.name} ${entry.tone === "error" ? "is down" : "is short of pods"}`, entry.note, { kind: POOLERS, namespace: view.namespace, name: entry.name });
      }
      if (backups.failures.length > 0) {
        const latest2 = backups.failures[0];
        const title = backups.failures.length === 1 ? "the last backup failed" : `the last ${backups.failures.length} backups failed`;
        add("error", title, latest2.error || latest2.words, { kind: BACKUPS, namespace: view.namespace, name: latest2.name });
      }
      if (backups.archiving === false) {
        const message = (view.cluster.status?.conditions ?? []).find((c) => c.type === "ContinuousArchiving")?.message ?? "";
        add("error", "WAL archiving is failing", message || "Changes since the last backup are not being saved anywhere, so a restore cannot reach them.");
      }
      if (!backups.configured) add("warn", "no backups", backups.freshness.why);
      else if (backups.failures.length === 0 && (backups.freshness.tone === "error" || backups.freshness.tone === "warn")) {
        add(backups.freshness.tone, backups.last === void 0 ? "never backed up" : `last backup ${backups.freshness.words}`, backups.freshness.why);
      }
      for (const schedule of backups.schedules) {
        const ref = { kind: SCHEDULED_BACKUPS, namespace: schedule.namespace, name: schedule.name };
        if (schedule.invalid) add("error", `schedule ${schedule.name} cannot run`, `"${schedule.schedule}": ${schedule.invalid}. CloudNativePG's schedule has six fields, seconds first.`, ref);
        else if (schedule.error) add("error", `schedule ${schedule.name} is refused`, schedule.error, ref);
        else if (schedule.suspended) add("info", `schedule ${schedule.name} is suspended`, "No backups are taken on it until it is resumed.", ref);
      }
    }
    return found.sort((a, b) => severity(b.tone) - severity(a.tone) || a.cluster.localeCompare(b.cluster) || a.title.localeCompare(b.title));
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
      const every2 = goDuration(spec.slice(7).trim());
      if (every2 === void 0 || every2 <= 0) return { ok: false, error: `cannot read the duration in "${spec}"` };
      return { ok: true, schedule: { kind: "every", every: every2, source: spec } };
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
  function freshness(last, every2, configured, now) {
    if (!configured) return { tone: "warn", words: "not configured", why: "This cluster has no backup configuration: nothing could bring its data back." };
    if (last === void 0) return { tone: "warn", words: "never", why: "Backups are configured, but none has completed yet." };
    const age = Math.max(0, now - last);
    const words2 = `${span(age)} ago`;
    const warnAfter = every2 ? Math.max(2 * every2, 10 * 60 * 1e3) : 26 * HOUR;
    const errorAfter = every2 ? Math.max(6 * every2, 30 * 60 * 1e3) : 7 * DAY;
    const basis = every2 ? `its schedule runs every ${span(every2)}` : "there is no schedule, so a day is the measure";
    if (age > errorAfter) return { tone: "error", words: words2, why: `Much older than it should be: ${basis}.` };
    if (age > warnAfter) return { tone: "warn", words: words2, why: `Older than it should be: ${basis}.` };
    return { tone: "ok", words: words2, why: every2 ? `On schedule: ${basis}.` : "Within the last day." };
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
    const every2 = active.map((s) => s.every).filter((e) => e !== void 0).sort((a, b) => a - b)[0];
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
      freshness: freshness(last, every2, configured, now),
      backups,
      schedules,
      running: backups.filter((b) => b.state === "running" || b.state === "pending"),
      failures,
      next: next2
    };
  }
  function windowWords(summary, now) {
    if (summary.firstPoint === void 0) {
      return { words: summary.configured ? "no recovery point yet" : "none", tone: summary.configured ? "warn" : "" };
    }
    const reach = span(now - summary.firstPoint);
    if (summary.archiving === false) return { words: `${reach} — but WAL archiving is failing, so not up to now`, tone: "error" };
    return { words: `${reach} back${summary.estimated ? " (estimated)" : ""}`, tone: "ok" };
  }

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
  function sentence(view) {
    const instances = view.instances === 1 ? "its one instance" : `${view.instances} instances`;
    switch (view.state) {
      case "hibernated":
        return `Hibernated: no pods run, and the volumes of ${instances} are kept until it is woken up.`;
      case "hibernating":
        return "Hibernation was asked for: the operator is stopping the pods and keeping the volumes.";
      case "waking":
        return "Waking up: the operator is starting the pods again on the volumes it kept.";
      case "switchover":
        return `The primary is moving from ${view.primary || "the old primary"} to ${view.targetPrimary || "a new one"}. Writes pause for a moment.`;
      case "failover": {
        const next2 = !view.targetPrimary || view.targetPrimary === "pending" ? "the most advanced replica" : view.targetPrimary;
        return `The primary${view.primary ? ` ${view.primary}` : ""} failed; ${next2} is being promoted in its place.`;
      }
      case "failing":
        return view.phaseReason || view.phase;
      case "degraded":
        return `${view.ready} of ${instances} ready${view.primary ? `; ${view.primary} is the primary` : ""}.`;
      case "healthy":
        if (view.instances === 1) return `One instance, ${view.primary || "the primary"}, and nothing standing by if it goes.`;
        return `All ${view.instances} instances ready; ${view.primary || "the primary"} takes the writes.`;
      default:
        return view.phaseReason || (view.phase ? view.phase : "The operator has not reported on this cluster yet.");
    }
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
  function seriesLabel(name) {
    const l = labels(name);
    const who = l.pod ?? l.cluster ?? l.datname ?? "";
    if (who) return l.namespace ? `${l.namespace}/${who}` : who;
    return name || "all";
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
  function svgEl(tag, attrs = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value2] of Object.entries(attrs)) {
      if (value2 !== void 0) node.setAttribute(name, String(value2));
    }
    for (const child of children) {
      if (child === null || child === void 0) continue;
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

  // src/ui/parts.ts
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
  }
  function stat(label, value2, note = "", tone = "", noteTone = "") {
    return el(
      "div",
      { class: "stat" },
      el("div", { class: `stat-value tone-${tone || "none"}` }, value2),
      el("div", { class: "stat-label" }, label),
      note ? el("div", { class: `stat-note${noteTone ? ` tone-${noteTone}` : ""}` }, note) : null
    );
  }
  function block(title, note, ...children) {
    return el("section", { class: "block" }, el("h2", {}, title), note ? el("p", { class: "note" }, note) : null, ...children.filter((c) => c !== null));
  }
  function nothing(message) {
    return el("p", { class: "empty" }, message);
  }
  function heading(title, note, ...right) {
    return el(
      "header",
      { class: "page-head" },
      el("img", { class: "mark", src: "logo.svg", alt: "", width: 26, height: 26 }),
      el("div", { class: "page-title" }, el("h1", {}, title), note ? el("p", { class: "note" }, note) : null),
      ...right
    );
  }
  function clickable(node, onPick, label = "") {
    node.classList.add("pick");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      onPick();
    });
    node.addEventListener("keydown", (event) => {
      const key2 = event.key;
      if (key2 === "Enter" || key2 === " ") {
        event.preventDefault();
        onPick();
      }
    });
    return node;
  }
  function sparkline(series, width = 220, height = 40) {
    const drawing = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, class: "spark", preserveAspectRatio: "none", "aria-hidden": "true" });
    const points = series.flatMap((s) => s.points);
    if (points.length < 2) return drawing;
    const first = Math.min(...points.map((p) => p.t));
    const last = Math.max(...points.map((p) => p.t));
    const top = Math.max(...points.map((p) => p.v), 0);
    const spanT = Math.max(1, last - first);
    drawing.append(svgEl("line", { x1: 0, x2: width, y1: height - 0.5, y2: height - 0.5, class: "spark-base" }));
    series.slice(0, 8).forEach((s, index) => {
      if (s.points.length < 2) return;
      const path = s.points.map((p) => `${((p.t - first) / spanT * width).toFixed(1)},${(height - 2 - (top > 0 ? p.v / top * (height - 4) : 0)).toFixed(1)}`).join(" ");
      drawing.append(svgEl("polyline", { points: path, class: `spark-line series-${index + 1}`, fill: "none", "vector-effect": "non-scaling-stroke" }));
    });
    return drawing;
  }
  function formatValue(unit, value2) {
    if (value2 === void 0 || !Number.isFinite(value2)) return "—";
    switch (unit) {
      case "percent":
        return `${(value2 * 100).toFixed(0)}%`;
      case "bytes":
        return size(value2);
      case "bytes/s":
        return `${size(value2)}/s`;
      case "seconds":
        if (value2 < 1) return value2 === 0 ? "0 s" : `${(value2 * 1e3).toFixed(0)} ms`;
        if (value2 < 120) return `${value2.toFixed(value2 < 10 ? 1 : 0)} s`;
        return `${Math.round(value2 / 60)} min`;
      case "ops/s":
        return `${value2 >= 100 ? value2.toFixed(0) : value2.toFixed(1)}/s`;
      default:
        return value2 >= 100 || Number.isInteger(value2) ? value2.toFixed(0) : value2.toFixed(1);
    }
  }
  function toneVar(tone) {
    return tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "error" ? "var(--error)" : tone === "info" ? "var(--accent)" : "var(--border)";
  }

  // src/ui/glyph.ts
  var toneClass = (tone) => `tone-${tone || "none"}`;
  function nodeClass(instance, asleep) {
    if (asleep) return "node node-asleep";
    const parts = ["node", instance.primary ? "node-primary" : "node-replica", toneClass(instance.tone)];
    if (instance.becomingPrimary) parts.push("node-promoting");
    return parts.join(" ");
  }
  function edgeClass(instance, asleep) {
    const parts = ["edge", instance.link === "sync" ? "edge-sync" : "edge-async"];
    if (asleep) parts.push("edge-asleep");
    else if (!instance.streaming) parts.push("edge-broken");
    else parts.push(toneClass(instance.tone));
    return parts.join(" ");
  }
  function miniGlyph(topology, width = 112, height = 66) {
    const asleep = topology.view.state === "hibernated" || topology.view.state === "hibernating";
    const drawing = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, class: `glyph${asleep ? " glyph-asleep" : ""}`, role: "img" });
    drawing.append(svgEl("title", {}, glyphTitle(topology)));
    const px = 30;
    const py = height / 2;
    const pr = 13;
    const shown = topology.replicas.slice(0, 4);
    const extra = topology.replicas.length - shown.length;
    const rx = width - 22;
    const rr = 8;
    const gap = shown.length > 1 ? Math.min(20, (height - 18) / (shown.length - 1)) : 0;
    const top = py - gap * (shown.length - 1) / 2;
    shown.forEach((replica, i) => {
      const y = top + i * gap;
      const dx = rx - px;
      const dy = y - py;
      const length = Math.hypot(dx, dy) || 1;
      drawing.append(
        svgEl("line", {
          x1: (px + dx / length * pr).toFixed(1),
          y1: (py + dy / length * pr).toFixed(1),
          x2: (rx - dx / length * rr).toFixed(1),
          y2: (y - dy / length * rr).toFixed(1),
          class: edgeClass(replica, asleep)
        })
      );
      drawing.append(svgEl("circle", { cx: rx, cy: y.toFixed(1), r: rr, class: nodeClass(replica, asleep) }));
    });
    if (topology.replicas.length === 0 && !asleep) {
      drawing.append(svgEl("line", { x1: px + pr, y1: py, x2: rx - rr, y2: py, class: "edge edge-ghost" }));
      drawing.append(svgEl("circle", { cx: rx, cy: py, r: rr, class: "node node-ghost" }));
    }
    if (extra > 0) drawing.append(svgEl("text", { x: rx, y: height - 1, class: "glyph-more", "text-anchor": "middle" }, `+${extra}`));
    const primary = topology.primary;
    drawing.append(
      svgEl("circle", {
        cx: px,
        cy: py,
        r: pr,
        class: primary ? nodeClass(primary, asleep) : "node node-missing"
      })
    );
    if (asleep) drawing.append(svgEl("text", { x: px + pr + 3, y: py - pr + 2, class: "glyph-zz" }, "z z"));
    return drawing;
  }
  function glyphTitle(topology) {
    const primary = topology.primary ? `primary ${topology.primary.name}` : "no primary";
    const standbys = topology.replicas.map((r) => `${r.name} ${r.note}`).join("; ");
    return standbys ? `${primary}; ${standbys}` : `${primary}; no standby`;
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
  function every(ms, body, onError) {
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        await body();
      } catch (err) {
        onError(err);
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
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
    const [clusters, backups, schedules, poolers, pods, pvcs, services, nodes, charts2] = await Promise.all([
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
    const lag = byPod(charts2?.charts.find((chart) => chart.id === "replication-lag"));
    const facts = [...clusters].sort((a, b) => (a.metadata.namespace ?? "").localeCompare(b.metadata.namespace ?? "") || a.metadata.name.localeCompare(b.metadata.name)).map((cluster) => ({
      topology: build(cluster, { pods, pvcs, poolers, services, nodes, lag }),
      backups: summarise(cluster, backups, schedules, now)
    }));
    return { now, clusters, backups, schedules, poolers, pods, pvcs, services, nodes, charts: charts2, facts };
  }

  // src/pages/overview.ts
  var REFRESH = 15e3;
  start("page", async (ctx) => {
    replace(byId("head"), heading("CloudNativePG", `PostgreSQL in ${ctx.contextName}.`));
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    try {
      const summary = await k8sdockside.summary();
      if (summary.checked && !summary.installed) {
        document.getElementById("first")?.remove();
        replace(body, notInstalled(ctx));
        return;
      }
    } catch {
    }
    const stop = every(
      REFRESH,
      async () => {
        const world = await load({ charts: true, minutes: 60 });
        failure.textContent = "";
        document.getElementById("first")?.remove();
        replace(body, failure, ...draw(world));
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function draw(world) {
    if (world.facts.length === 0) {
      return [
        block(
          "No Postgres clusters yet",
          "The operator is installed, but no Cluster exists in any namespace you can see. Create one and it appears here within a few seconds.",
          el("p", { class: "links" }, linkButton("Quickstart", "https://cloudnative-pg.io/documentation/current/quickstart/"))
        )
      ];
    }
    const problems = issues(world.facts);
    return [stats(world), el("div", { class: "cards" }, ...world.facts.map((facts) => card(facts, world.now))), attention(problems), charts(world.charts)];
  }
  function stats(world) {
    const views = world.facts.map((f) => f.topology.view);
    const healthy = views.filter((v) => v.state === "healthy").length;
    const asleep = views.filter((v) => v.state === "hibernated" || v.state === "hibernating").length;
    const bad = views.filter((v) => v.tone === "error").length;
    const awake = world.facts.filter((f) => f.topology.view.state !== "hibernated");
    const wanted = awake.reduce((n, f) => n + f.topology.view.instances, 0);
    const ready = awake.reduce((n, f) => n + f.topology.view.ready, 0);
    const dayAgo = world.now - DAY;
    const recent = world.facts.flatMap((f) => f.backups.backups).filter((b) => (b.at ?? 0) >= dayAgo);
    const completed = recent.filter((b) => b.state === "completed").length;
    const failed = recent.filter((b) => b.state === "failed").length;
    const poolers = world.facts.flatMap((f) => f.topology.entries.filter((e) => e.kind === "pooler"));
    const poolersOk = poolers.filter((p) => p.tone === "ok").length;
    return el(
      "div",
      { class: "stats" },
      stat("Clusters healthy", `${healthy} / ${views.length}`, [bad ? `${bad} failing` : "", asleep ? `${asleep} asleep` : "", !bad && !asleep ? "all of them" : ""].filter((s) => s).join(" · "), bad ? "error" : healthy < views.length - asleep ? "warn" : "", bad ? "error" : ""),
      stat("Instances ready", `${ready} / ${wanted}`, asleep ? "hibernated clusters left out" : "across every cluster", ready < wanted ? "warn" : ""),
      stat("Backups, last 24h", String(completed), failed ? `${failed} failed` : "none failed", "", failed ? "error" : ""),
      stat("Poolers", poolers.length ? `${poolersOk} / ${poolers.length}` : "—", poolers.length ? "serving" : "no PgBouncer in front of any cluster", poolersOk < poolers.length ? "warn" : "")
    );
  }
  function card(facts, now) {
    const { topology, backups } = facts;
    const view = topology.view;
    const backupTone = backups.failures.length > 0 || backups.archiving === false ? "error" : backups.freshness.tone === "ok" ? "" : backups.freshness.tone;
    const tone = view.state === "hibernated" ? "info" : worst(topology.tone, backupTone);
    const open = () => void openOn("topology", view.namespace, view.name);
    const glyph = el("div", { class: "card-glyph", title: "Open the topology" }, miniGlyph(topology));
    clickable(glyph, open, `Open the topology of ${view.name}`);
    const title = el("button", { type: "button", class: "card-name", title: "Open the topology" }, view.name);
    title.addEventListener("click", open);
    const reach = windowWords(backups, now);
    const lastTone = backups.freshness.tone;
    const nextRun = backups.next !== void 0 ? ` · next in ${span(backups.next - now)}` : "";
    const storage = view.storage ? size(view.storage) + (view.walStorage ? ` + ${size(view.walStorage)} WAL` : "") : "—";
    const instances = view.state === "hibernated" ? `${count(view.instances, "instance")}, asleep` : `${view.ready} of ${view.instances} ready`;
    const node = el(
      "article",
      { class: "card" },
      el(
        "div",
        { class: "card-top" },
        glyph,
        el(
          "div",
          { class: "card-id" },
          el("div", { class: "card-title" }, title, el("span", { class: "card-ns" }, view.namespace)),
          el("div", { class: "card-state" }, pill(view.words, view.tone), view.version ? el("span", { class: "faint" }, `Postgres ${view.version}`) : null)
        )
      ),
      el("p", { class: "card-sentence" }, sentence(view)),
      el(
        "dl",
        { class: "card-facts" },
        el("dt", {}, "Instances"),
        el("dd", {}, instances),
        el("dt", {}, "Storage"),
        el("dd", {}, storage),
        el("dt", {}, "Last backup"),
        el("dd", { title: backups.freshness.why }, el("span", { class: `dot dot-${lastTone || "none"}` }), el("span", { class: `tone-${lastTone || "none"}` }, backups.freshness.words), el("span", { class: "faint" }, nextRun)),
        el("dt", {}, "Can restore"),
        el("dd", {}, windowBar(backups.firstPoint, now, reach.tone, view.cluster.spec?.backup?.retentionPolicy), el("span", { class: `tone-${reach.tone || "none"}` }, reach.words))
      ),
      el(
        "div",
        { class: "card-foot" },
        footLink("Topology", open),
        footLink("Backups", () => void openOn("backups", view.namespace, view.name)),
        topology.entries.some((e) => e.kind === "pooler") ? el("span", { class: "faint" }, count(topology.entries.filter((e) => e.kind === "pooler").length, "pooler")) : null
      )
    );
    node.style.borderLeftColor = toneVar(tone);
    return node;
  }
  function windowBar(first, now, tone, retention) {
    const bar = el("span", { class: "mini-bar", "aria-hidden": "true" });
    const fill = el("span", { class: `mini-fill fill-${first === void 0 ? "none" : tone || "none"}` });
    const match = /^(\d+)([dwm])$/.exec(retention ?? "");
    const whole = match ? Number(match[1]) * (match[2] === "d" ? 1 : match[2] === "w" ? 7 : 30) * DAY : 30 * DAY;
    fill.style.width = `${first === void 0 ? 0 : Math.max(4, percent(now - first, whole))}%`;
    bar.append(fill);
    return bar;
  }
  function footLink(label, onClick) {
    const node = el("button", { type: "button", class: "foot-link" }, label);
    node.addEventListener("click", onClick);
    return node;
  }
  function linkButton(label, url) {
    const node = el("button", { type: "button" }, label);
    node.addEventListener("click", () => void k8sdockside.openUrl(url));
    return node;
  }
  function attention(problems) {
    if (problems.length === 0) {
      return block("Needs attention", "", nothing("Nothing. Every cluster is up, every standby is streaming, and every backup is on time."));
    }
    const list = el("ul", { class: "issues" });
    for (const issue of problems.slice(0, 25)) {
      const row = el(
        "li",
        { class: "issue" },
        el("span", { class: `dot dot-${issue.tone || "none"}` }),
        el("span", { class: "issue-title" }, issue.title),
        el("span", { class: "issue-detail" }, issue.detail)
      );
      clickable(row, () => void k8sdockside.open(issue.ref));
      list.append(row);
    }
    const errors = problems.filter((p) => p.tone === "error").length;
    const note = `${errors ? `${count(errors, "problem")} to fix, worst first.` : "Nothing is broken; these are worth knowing."} Each row opens the object it is about.`;
    return block("Needs attention", problems.length > 25 ? `The worst 25 of ${problems.length}. ${note}` : note, list);
  }
  function charts(panel) {
    if (!panel || !panel.attached) return null;
    if (!panel.source.available) {
      return block(
        "From Prometheus",
        "CloudNativePG exports replication lag, connections, commits and archiving failures for Prometheus. No Prometheus was found for this cluster, so the charts are empty and replication lag is left off the topology.",
        el("p", { class: "faint" }, panel.source.error || "Set one in the cluster’s settings in the sidebar to fill them in.")
      );
    }
    const tiles = el("div", { class: "chart-tiles" });
    for (const chart of panel.charts) {
      const ranked = [...chart.series].sort((a, b) => (latest(b.points) ?? -Infinity) - (latest(a.points) ?? -Infinity));
      const top = ranked.slice(0, 3);
      const peak = latest(top[0]?.points ?? []);
      const legend = el("ul", { class: "chart-legend" });
      top.forEach((series, index) => {
        legend.append(
          el("li", {}, el("span", { class: `swatch series-${index + 1}` }), el("span", { class: "legend-name" }, seriesLabel(series.name)), el("span", { class: "legend-value" }, formatValue(chart.unit, latest(series.points))))
        );
      });
      const empty = chart.series.length === 0;
      tiles.append(
        el(
          "div",
          { class: "chart-tile", title: chart.description },
          el("div", { class: "chart-head" }, el("span", { class: "chart-label" }, chart.label), el("span", { class: "chart-value" }, empty ? "—" : formatValue(chart.unit, peak))),
          empty ? el("p", { class: "chart-empty" }, chart.error || "No data: the exporter has not reported this yet.") : sparkline(top),
          empty ? null : legend,
          ranked.length > 3 ? el("p", { class: "chart-more" }, `and ${ranked.length - 3} more`) : null
        )
      );
    }
    return block("From Prometheus", `The last hour, through ${panel.source.describe}. Highest first.`, tiles);
  }
  function notInstalled(ctx) {
    return block(
      "CloudNativePG is not installed here",
      `${ctx.contextName} does not serve the postgresql.cnpg.io API, so there are no Postgres clusters for this plugin to show. It stays out of the way until the operator is installed.`,
      el("p", { class: "links" }, linkButton("Installing CloudNativePG", "https://cloudnative-pg.io/documentation/current/installation_upgrade/"))
    );
  }
})();
