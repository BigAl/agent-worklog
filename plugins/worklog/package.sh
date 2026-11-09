#!/usr/bin/env bash
# Build the self-contained worklog package: worklog-<version>.zip with the
# plugin folder at the top of the archive (claude.ai / marketplace upload
# format; contains skill + tools + installer so it works standalone).
set -euo pipefail

cd "$(dirname "$0")"
VERSION=$(python3 -c "import json; print(json.load(open('.claude-plugin/plugin.json'))['version'])")
OUT="worklog-${VERSION}.zip"

command -v zip >/dev/null || { echo "zip is required"; exit 1; }
rm -f "$OUT"
zip -qr "$OUT" . -x "*.zip" -x ".git/*"
echo "built $OUT"
