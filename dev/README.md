# Trying the plugin on a kind cluster

`dev/up.sh` makes a local Kubernetes cluster with CloudNativePG in it and one
Postgres cluster in each state the plugin draws, so you can see every page
with real objects behind it.

```sh
dev/up.sh     # about five minutes the first time, mostly pulling images
dev/down.sh   # deletes the kind cluster and everything in it
```

It needs `docker` (or podman, with `KIND_EXPERIMENTAL_PROVIDER=podman`),
[`kind`](https://kind.sigs.k8s.io) and `kubectl`. It creates a kind cluster
called `cnpg-dev` (set `CLUSTER=` for another name), installs the
CloudNativePG operator from its release manifest
(`cnpg-1.30.1.yaml`; set `CNPG_VERSION=` for another release), and applies
`dev/samples/` into the namespace `cnpg-demo`. It never changes which kubectl
context is current: kind switches to the new cluster when it makes one, and
the script switches back.

## What you get

| Cluster | Shows |
| --- | --- |
| `shop` | Healthy: three instances, one synchronous standby (`method: any`, `number: 1`), a PgBouncer `rw` pooler with two pods and an `ro` one with one, a declarative Database, WAL archiving and a ScheduledBackup every ten minutes to an S3 store in the cluster. |
| `analytics` | One instance and no backups at all: flagged on the Dashboard as "no backups" and "a single instance". |
| `orders` | Backups that fail: the object store is right, the credentials are not. WAL archiving fails and the Backup `orders-before-migration` fails with the store's own "InvalidAccessKeyId" error. |
| `archive` | Hibernated: created with `cnpg.io/hibernation: "on"`, so the operator brings it up, then deletes its pod and keeps its volume. |

The object store is [RustFS](https://rustfs.com) (`rustfs/rustfs:1.0.0`), in
the `backup-store` Deployment with an emptyDir: MinIO no longer publishes
container images. It speaks the same S3 API, and barman-cloud creates the
buckets itself the first time it checks the WAL archive.

The object-store backups use the operator's built-in `barmanObjectStore`
method, which CloudNativePG has deprecated since 1.26 in favour of the Barman
Cloud plugin but still runs. It is used here because it needs nothing but the
operator; the plugin method is drawn from the fixtures (`billing`) in
`npm run preview`.

Two states a kind cluster will not produce on its own are only in the
preview fixtures: a standby far behind its primary (that needs load and a
Prometheus scraping the exporter) and a cluster in the middle of a failover.

## Things to try in the app

Open the `kind-cnpg-dev` context in K8s Dockside and go to **Plugins →
CloudNativePG**. If the plugin is not installed, **Settings → Plugins → Watch
another folder** and point it at this checkout.

- **Back up now** on `shop` (Topology, Backups, or the Cluster's own action
  bar): a Backup named `shop-manual-…` appears, runs, and completes on the
  Backups timeline.
- **Wake up** on `archive`, then **Hibernate** it again. Each asks first.
- **Restart** on `shop`, from the Topology view: the operator restarts the
  standbys one at a time, then the primary.
- **Back up now** on `orders` to watch another backup fail, with its error on
  the Backups page.

And one from a terminal, to see a standby turn red: fencing stops Postgres on
an instance without deleting its pod.

```sh
kubectl --context kind-cnpg-dev -n cnpg-demo annotate cluster shop \
    cnpg.io/fencedInstances='["shop-2"]' --overwrite
# undo it
kubectl --context kind-cnpg-dev -n cnpg-demo annotate cluster shop cnpg.io/fencedInstances-
```

Replication lag and the charts need a Prometheus scraping the instances
(a `PodMonitor` per cluster, as the CloudNativePG monitoring guide describes).
Without one, the Dashboard says so and everything else works.

## Starting over

`kubectl --context kind-cnpg-dev delete namespace cnpg-demo` and run
`dev/up.sh` again, or `dev/down.sh` to remove the whole kind cluster.
