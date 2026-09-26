// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/cnpg.ts
  var CLUSTERS = "crd:clusters.postgresql.cnpg.io";
  var PODS = "pods";
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

  // src/model/units.ts
  function size(value) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    const units = ["B", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
      n /= 1024;
      unit++;
    }
    const digits = n >= 100 || unit === 0 || Number.isInteger(n) ? 0 : n >= 10 ? 1 : 2;
    return `${Number(n.toFixed(digits))} ${units[unit]}`;
  }
  function quantity(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const match = /^\s*([0-9.]+)\s*([EPTGMk]i?|m)?\s*$/.exec(value);
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

  // src/model/health.ts
  var PHASES = {
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
    const known = PHASES[phase];
    const instances = spec.instances ?? status.instances ?? 0;
    const ready = status.readyInstances ?? 0;
    const image = status.image ?? spec.imageName ?? "";
    const catalogMajor = spec.imageCatalogRef?.major;
    let words = known?.words ?? (phase || "Not reconciled yet");
    let tone = known?.tone ?? (phase ? "warn" : "");
    let state = known?.state ?? "unknown";
    const hibernationRequested = (cluster.metadata.annotations?.[ANNOTATION.hibernation] ?? "") === "on";
    const hibernation = condition(status.conditions, CONDITION.hibernation);
    const hibernatedNow = hibernation?.status === "True" && hibernation.reason === "Hibernated";
    if (hibernationRequested) {
      state = hibernatedNow ? "hibernated" : "hibernating";
      words = hibernatedNow ? "Hibernated" : "Going to sleep";
      tone = "info";
    } else if (hibernatedNow || hibernation?.status === "True" && ready < instances) {
      state = "waking";
      words = "Waking up";
      tone = "info";
    } else if (state === "healthy" && ready < instances) {
      state = "degraded";
      words = ready === 0 ? "No instance ready" : `${ready} of ${instances} ready`;
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
      words,
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

  // src/ui/dom.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
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
  var focusKey = (viewId) => `focus-${viewId}`;
  async function openOn(viewId, namespace, name) {
    try {
      await k8sdockside.storage?.set(focusKey(viewId), { namespace, name });
    } catch {
    }
    await k8sdockside.openView(viewId);
  }

  // src/ui/parts.ts
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
  }
  function facts(pairs) {
    const list = el("dl", { class: "facts" });
    for (const [term, value] of pairs) {
      list.append(el("dt", {}, term), el("dd", {}, typeof value === "string" ? value || "—" : value));
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

  // src/pages/pvc.ts
  var ROLES = {
    PG_DATA: "the data directory",
    PG_WAL: "the write-ahead log",
    PG_TABLESPACE: "a tablespace"
  };
  start("panel", async () => {
    const host = byId("panel");
    const claim = await k8sdockside.object();
    const labels = claim.metadata.labels ?? {};
    const clusterName = labels[LABEL.cluster];
    const namespace = claim.metadata.namespace ?? "";
    if (!clusterName) {
      replace(host, nothing("This claim does not belong to a CloudNativePG cluster."));
      return;
    }
    const role = labels[LABEL.pvcRole] ?? "";
    const instance = labels[LABEL.instanceName] ?? "";
    let cluster;
    try {
      cluster = await k8sdockside.get({ kind: CLUSTERS, namespace, name: clusterName });
    } catch {
      cluster = void 0;
    }
    const view = cluster ? clusterView(cluster) : void 0;
    const status = cluster?.status ?? {};
    const name = claim.metadata.name;
    const state = status.danglingPVC?.includes(name) ? ["dangling: no pod is using it", "warn"] : status.resizingPVC?.includes(name) ? ["being resized", "info"] : status.initializingPVC?.includes(name) ? ["being initialised", "info"] : status.unusablePVC?.includes(name) ? ["unusable: a claim it needs is missing", "error"] : status.healthyPVC?.includes(name) ? ["healthy", "ok"] : [view?.state === "hibernated" ? "kept while the cluster hibernates" : "not listed by the cluster yet", view?.state === "hibernated" ? "info" : ""];
    const isPrimary = instance !== "" && view?.primary === instance;
    const head = el(
      "div",
      { class: "panel-head" },
      pill(role === "PG_WAL" ? "WAL" : role === "PG_TABLESPACE" ? "Tablespace" : "Data", "info"),
      el("span", {}, `holds ${ROLES[role] ?? "Postgres data"} of`),
      instance ? openName(instance, { kind: PODS, namespace, name: instance }) : el("span", {}, "an instance"),
      isPrimary ? pill("primary", "info") : instance ? pill("standby") : null
    );
    const pairs = [
      ["Cluster", openName(clusterName, { kind: CLUSTERS, namespace, name: clusterName })],
      ["Size", size(quantity(claim.status?.capacity?.storage ?? claim.spec?.resources?.requests?.storage)) || "—"],
      ["State", el("span", { class: `tone-${state[1] || "none"}` }, state[0] ?? "")]
    ];
    const topology = el("button", { type: "button" }, "Open the topology");
    topology.addEventListener("click", () => void openOn("topology", namespace, clusterName));
    replace(host, head, facts(pairs), el("div", { class: "links", style: "margin-top:8px" }, topology));
  });
})();
