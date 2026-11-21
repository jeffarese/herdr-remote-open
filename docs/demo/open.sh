#!/bin/sh
# Opens an image from studio on a showcase stage as herdr-open opens it from a terminal there,
# and waits for the viewer; or closes the viewer.
#
#   sh open.sh <stage> <path on studio> [terminal]   default terminal: the agent showcase.sh found
#   sh open.sh <stage> --close
#
# herdr-open runs on studio (the stage's second herdr-core) with that terminal's id, so the
# request is a label on that terminal, exactly as when a program in it runs herdr-open.
set -eu
w=$(cd "${1:?usage: open.sh <stage> <path>|--close}" && pwd -P)
# shellcheck disable=SC1091
. "$w/env.sh"
shown() { herdr-app status | /usr/bin/python3 -c 'import json, sys; sys.exit(0 if "remote-open" in json.load(sys.stdin).get("overlays", []) else 1)'; }

if [ "${2:-}" = --close ]; then
  # The viewer takes its key commands once it has loaded, so this asks until it's gone.
  i=0
  while shown; do
    i=$((i + 1)); [ $i -lt 20 ] || { echo "open.sh: the viewer didn't close" >&2; exit 1; }
    herdr-app "do" remote-open.close >/dev/null || :
    sleep 0.5
  done
  exit 0
fi

path=${2:?usage: open.sh <stage> <path>}
terminal=${3:-$(cat "$w/run/remote-open-agent")}
# HERDR_OPEN_OPENER: when no Herdr window takes it, herdr-open falls back to nothing, never to
# this Mac's own `open`.
hc exec --on studio "cd '$(dirname "$path")' && HC_SESSION='$SC_STUDIO_SESSION' HC_TERMINAL_ID='${terminal#*/}' HERDR_OPEN_OPENER=/usr/bin/true herdr-open '$(basename "$path")'" >/dev/null
i=0
until shown; do
  i=$((i + 1)); [ $i -lt 50 ] || { echo "open.sh: the viewer didn't open" >&2; exit 1; }
  sleep 0.2
done
# The copy and the picture's first draw.
sleep 2
