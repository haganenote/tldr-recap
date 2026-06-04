#!/usr/bin/env bash
# scripts/backup.sh — daily backup of state.db to Oracle Object Storage.
#
# Prereqs (one-time on the VM):
#   - oci CLI installed and configured (oci setup config)
#   - A bucket created (e.g. "tldr-recap-backups")
#   - Update BUCKET_NAME and NAMESPACE below.

set -euo pipefail

BUCKET_NAME="tldr-recap-backups"
NAMESPACE="$(oci os ns get --query data --raw-output)"
DB_PATH="/opt/tldr-recap/data/state.db"
DATE="$(date -u +%Y-%m-%d)"
TMP="/tmp/state-${DATE}.db.gz"

# Use sqlite3 .backup to get a consistent snapshot (works with WAL).
sqlite3 "$DB_PATH" ".backup '/tmp/state-${DATE}.db'"
gzip -f "/tmp/state-${DATE}.db"

oci os object put \
  --bucket-name "$BUCKET_NAME" \
  --namespace "$NAMESPACE" \
  --file "$TMP" \
  --name "state-${DATE}.db.gz" \
  --force

rm -f "$TMP"
echo "backed up state.db as state-${DATE}.db.gz"

# Prune backups older than 30 days
oci os object list \
  --bucket-name "$BUCKET_NAME" \
  --namespace "$NAMESPACE" \
  --query "data[?\"time-created\" < '$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)'].name" \
  --raw-output \
  | jq -r '.[]' \
  | while read -r name; do
      oci os object delete \
        --bucket-name "$BUCKET_NAME" \
        --namespace "$NAMESPACE" \
        --object-name "$name" \
        --force
    done
