#!/bin/sh
# Show recent headset logs shipped by the XR page (POST /xr-log on the gateway).
#   ./read-xr-logs.sh            last 80 lines from today
#   ./read-xr-logs.sh 200 input  last 200 lines matching "input"
#   TDS_XR_LOG_DIR=~/tds-vr-demo/logs ./read-xr-logs.sh   logs from the demo (mock) server
cd "${TDS_XR_LOG_DIR:-$(dirname "$0")/logs}" 2>/dev/null || { echo "no logs yet"; exit 0; }
N=${1:-80}
FILTER=${2:-}
FILE=$(ls -1 xr-*.jsonl 2>/dev/null | tail -1)
[ -n "$FILE" ] || { echo "no logs yet"; exit 0; }
python3 - "$FILE" "$N" "$FILTER" <<'PY'
import json, sys
path, n, needle = sys.argv[1], int(sys.argv[2]), sys.argv[3]
rows = []
for line in open(path, encoding="utf-8"):
    try:
        entry = json.loads(line)
    except ValueError:
        continue
    if needle and needle.lower() not in entry.get("message", "").lower():
        continue
    rows.append(entry)
for entry in rows[-n:]:
    ua = "headset" if "aarch64" in entry.get("ua", "") or "SteamOS" in entry.get("ua", "") else "browser"
    print(f'{entry.get("at","")[11:19]} {entry.get("session","")[:8]} {ua:7} {entry.get("level",""):5} {entry.get("message","")}')
PY
