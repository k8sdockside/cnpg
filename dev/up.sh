#!/usr/bin/env bash
# A kind cluster with CloudNativePG and one Postgres cluster in every state the
# plugin draws: healthy with poolers and scheduled backups, single-instance
# with no backups, failing backups, and hibernated.
#
#   dev/up.sh            create (or reuse) the kind cluster and apply everything
#   CLUSTER=foo dev/up.sh   under another kind cluster name
#
# It never changes which kubectl context is current: kind switches to the new
# cluster when it creates one, and this script switches back. Every kubectl
# call below names the kind context explicitly, so nothing here can land on
# another cluster by accident.
#
# Needs: docker (or podman with KIND_EXPERIMENTAL_PROVIDER=podman), kind and
# kubectl. Everything else is pulled from the internet.

set -euo pipefail

CLUSTER="${CLUSTER:-cnpg-dev}"
# The operator release the samples were written against. The manifest URL is
# the one CloudNativePG's installation guide gives for a release.
CNPG_VERSION="${CNPG_VERSION:-1.30.1}"
CNPG_MANIFEST="https://github.com/cloudnative-pg/cloudnative-pg/releases/download/v${CNPG_VERSION}/cnpg-${CNPG_VERSION}.yaml"
CONTEXT="kind-${CLUSTER}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLES="${HERE}/samples"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
k() { kubectl --context "${CONTEXT}" "$@"; }

for tool in kind kubectl; do
    command -v "${tool}" >/dev/null || { echo "dev/up.sh needs ${tool} on the PATH" >&2; exit 1; }
done

previous="$(kubectl config current-context 2>/dev/null || true)"

if kind get clusters 2>/dev/null | grep -qx "${CLUSTER}"; then
    say "kind cluster ${CLUSTER} is already there; reusing it"
else
    say "Creating kind cluster ${CLUSTER}"
    kind create cluster --name "${CLUSTER}" --wait 120s
fi

if [[ -n "${previous}" && "${previous}" != "${CONTEXT}" ]]; then
    kubectl config use-context "${previous}" >/dev/null
    echo "(current kubectl context left at ${previous}; this script uses ${CONTEXT})"
fi

say "Installing CloudNativePG ${CNPG_VERSION}"
# Server-side apply, as the CloudNativePG docs ask: the CRDs are too large for
# the last-applied annotation a client-side apply writes.
k apply --server-side --force-conflicts -f "${CNPG_MANIFEST}"
k -n cnpg-system rollout status deployment/cnpg-controller-manager --timeout=300s

# The operator's admission webhook answers a little after its pod is ready.
# Applying a Cluster before it does fails with "connection refused", so each
# sample is retried for a while rather than failing the whole script.
apply() {
    local file="$1"
    for attempt in $(seq 1 30); do
        if k apply -f "${file}" >/dev/null 2>/tmp/cnpg-dev-apply.err; then
            echo "applied $(basename "${file}")"
            return 0
        fi
        if [[ "${attempt}" == 1 ]]; then echo "waiting for the webhook to accept $(basename "${file}")…"; fi
        sleep 4
    done
    cat /tmp/cnpg-dev-apply.err >&2
    return 1
}

say "Applying the samples"
apply "${SAMPLES}/00-namespace.yaml"
apply "${SAMPLES}/10-object-store.yaml"
k -n cnpg-demo rollout status deployment/backup-store --timeout=300s
apply "${SAMPLES}/20-shop.yaml"
apply "${SAMPLES}/30-analytics.yaml"
apply "${SAMPLES}/40-orders-bad-creds.yaml"
apply "${SAMPLES}/50-archive-hibernated.yaml"

say "Waiting for the clusters to come up (the first image pull takes a while)"
for name in shop analytics orders; do
    k -n cnpg-demo wait --for=condition=Ready "cluster/${name}" --timeout=900s
done

# Only now, so it fails because of the credentials and not for want of a
# primary to back up.
apply "${SAMPLES}/45-orders-backup.yaml"

say "Done"
k -n cnpg-demo get clusters,backups,scheduledbackups,poolers,databases 2>/dev/null || true
cat <<EOF

Open the context "${CONTEXT}" in K8s Dockside and go to Plugins -> CloudNativePG.

  - shop       healthy, 3 instances, rw and ro poolers, a backup every 10 minutes
  - analytics  1 instance, no backups: flagged on the Dashboard
  - orders     backups fail: wrong object-store credentials
  - archive    hibernated: no pods, PVCs kept ("Wake up" brings it back)

A few things to try, all from the plugin:
  - "Back up now" on shop, and watch it go running -> completed on Backups.
  - "Wake up" on archive, then "Hibernate" again.

And one from a terminal, to see an unready replica turn red:
  kubectl --context ${CONTEXT} -n cnpg-demo annotate cluster shop \\
      cnpg.io/fencedInstances='["shop-2"]' --overwrite
  # and to undo it:
  kubectl --context ${CONTEXT} -n cnpg-demo annotate cluster shop cnpg.io/fencedInstances-

Delete it all with dev/down.sh.
EOF
