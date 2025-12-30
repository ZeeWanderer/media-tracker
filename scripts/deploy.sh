#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_DIR="${MEDIA_TRACKER_VAULT:-/var/mnt/E/Tools/MediaTracker/MediaTracker}"
PLUGIN_ID="media-tracker"
PLUGIN_DIR="${VAULT_DIR}/.obsidian/plugins/${PLUGIN_ID}"

if [[ ! -d "${VAULT_DIR}" ]]; then
  echo "Vault not found at ${VAULT_DIR}."
  echo "Set MEDIA_TRACKER_VAULT to your vault path."
  exit 1
fi

cd "${ROOT_DIR}"
npm run build

mkdir -p "${PLUGIN_DIR}"
cp "${ROOT_DIR}/manifest.json" "${ROOT_DIR}/main.js" "${ROOT_DIR}/styles.css" "${PLUGIN_DIR}/"
if [[ -d "${ROOT_DIR}/assets" ]] && [[ -n "$(ls -A "${ROOT_DIR}/assets" 2>/dev/null)" ]]; then
  mkdir -p "${PLUGIN_DIR}/assets"
  cp -R "${ROOT_DIR}/assets/"* "${PLUGIN_DIR}/assets/"
fi

echo "Deployed to ${PLUGIN_DIR}"
