#!/usr/bin/env bash
# Builds dist/bloom-tab-<version>.zip for the Chrome Web Store: everything the extension loads, nothing dev-only.
# It works by exclusion, so new pages and folders are picked up automatically; add dev-only paths to EXCLUDE.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/bloom-tab-$VER.zip"
EXCLUDE=(".dev/*" "scripts/*" "store/*" "dist/*" ".git/*" ".claude/*" "*.md" ".gitignore" "*.lock" "*/.lock" ".i18n/*")
mkdir -p dist; rm -f "$OUT"
zip -qr "$OUT" . -x "${EXCLUDE[@]}"
# every file the manifest names must be in the zip
python3 - "$OUT" <<'PY'
import json, sys, zipfile
z = set(zipfile.ZipFile(sys.argv[1]).namelist())
m = json.load(open('manifest.json'))
need = list(m['icons'].values()) + [m['chrome_url_overrides']['newtab'], m['background']['service_worker']]
need += [p for k in ('side_panel',) if k in m for p in [m[k]['default_path']]]
missing = [p for p in need if p not in z]
if missing: sys.exit('missing from zip: ' + ', '.join(missing))
print(len(z), 'files')
PY
ls -l "$OUT" | awk '{print $5, $9}'
