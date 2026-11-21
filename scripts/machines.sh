#!/bin/sh
# Sets herdr-open up on machines Herdr reaches (`hc machine ls`), or takes it off them.
#
#   scripts/machines.sh install <machine>... | --all
#   scripts/machines.sh remove  <machine>... | --all
#   scripts/machines.sh status  <machine>... | --all
#
# It copies remote/herdr-open to ~/.local/share/herdr-open/bin there and runs remote/setup.sh,
# which points BROWSER at it in Herdr terminals. Everything goes through hc, so it works for any
# machine Herdr is connected to. Nothing is installed on this computer.
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
hc=$(command -v hc 2>/dev/null || echo "$HOME/.local/bin/hc")
[ -x "$hc" ] || { echo "needs hc (herdr-core)" >&2; exit 1; }

action=${1:-}
case $action in install | remove | status) shift ;; *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;; esac
[ $# -gt 0 ] || { echo "name a machine, or --all" >&2; exit 2; }

if [ "$1" = --all ]; then
  # shellcheck disable=SC2046 # one machine name per word
  set -- $("$hc" machine ls --json | python3 -c 'import json,sys; print(" ".join(m["name"] for m in json.load(sys.stdin)["machines"] if m.get("state") == "connected" and not m.get("temporary")))')
  [ $# -gt 0 ] || { echo "No connected machines." >&2; exit 0; }
fi

status=0
for m in "$@"; do
  printf '%s: ' "$m"
  # shellcheck disable=SC2016 # $HOME is the other machine's
  home=$("$hc" exec --on "$m" -- /bin/sh -c 'printf %s "$HOME"' 2>/dev/null) || { echo "not reachable"; status=1; continue; }
  case $home in /*) ;; *) echo "no home folder"; status=1; continue ;; esac
  if [ "$action" = install ]; then
    if ! "$hc" file write --on "$m" "$home/.local/share/herdr-open/bin/herdr-open" <"$here/remote/herdr-open" >/dev/null ||
      ! "$hc" exec --on "$m" -- /bin/chmod 755 "$home/.local/share/herdr-open/bin/herdr-open" >/dev/null; then
      echo "couldn't copy herdr-open there"
      status=1
      continue
    fi
  fi
  "$hc" exec -i --on "$m" -- /bin/sh -s -- "$action" <"$here/remote/setup.sh" || status=1
done
exit $status
