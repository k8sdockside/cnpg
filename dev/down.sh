#!/usr/bin/env bash
# Deletes the kind cluster dev/up.sh made, and everything in it.

set -euo pipefail

CLUSTER="${CLUSTER:-cnpg-dev}"
kind delete cluster --name "${CLUSTER}"
