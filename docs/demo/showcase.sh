#!/bin/sh
# The showcase stage's scene for this README (herdr-showcase: stage.sh runs it after the cast).
#
#   w=$(SHOWCASE_HOOK=$PWD/docs/demo/showcase.sh sh ~/workspace/herdr/herdr-showcase/stage.sh)
#
# It ends on the main picture: studio's "Train the ranking model" in front, and the floating
# viewer showing the loss chart that run saved on studio, opened from that agent's terminal as
# `herdr-open runs/w46/loss.png` opens it. On the way it:
#
# - gives studio herdr-open (this repository's remote/herdr-open, in studio's bin);
# - draws the run's two charts (art.py) into studio's ~/code/search/runs/w46, and a plot.py
#   that only says it saved them, for the right-click scene (shots.sh);
# - gives the stage's copy of the mod a stand-in host name. The mod names this Mac in its
#   labels by `/bin/hostname -s`, which on the Mac that takes the pictures is a real machine's
#   name: the stage's copy asks a script that answers `sams-macbook` (the name the stats show).
#   Only that copy, in the stage's app home, changes; the repository's mod doesn't.
set -eu
w=$(cd "${1:?usage: showcase.sh <stage folder>}" && pwd -P)
here=$(cd "$(dirname "$0")" && pwd -P)
repo_root=$(cd "$here/../.." && pwd -P)
# Pillow's python, found before the stage's PATH takes over.
py=
for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 || :)"; do
  [ -x "$p" ] && "$p" -c 'import PIL' 2>/dev/null && { py=$p; break; }
done
[ -n "$py" ] || { echo "showcase.sh: needs a python3 with Pillow, for the charts" >&2; exit 2; }
# shellcheck disable=SC1091
. "$w/env.sh"
S="$w/studio"
say() { printf 'remote-open: %s\n' "$*" >&2; }
do_() { herdr-app "do" "$@" >/dev/null; }

# ---------------------------------------------------------------- the host name
cat > "$w/bin/hostname-standin" <<'SH'
#!/bin/sh
# The stage's host name for remote-open's labels (docs/demo/showcase.sh in herdr-remote-open).
echo sams-macbook
SH
chmod +x "$w/bin/hostname-standin"
js="$HERDR_APP_HOME/mods/remote-open/host.js"
sed -i '' "s#exec(\"/bin/hostname\"#exec(\"$w/bin/hostname-standin\"#" "$js"
grep -q "hostname-standin" "$js" || { say "couldn't give the mod a stand-in host name"; exit 1; }
grep -q '"/bin/hostname"' "$js" && { say "the mod still asks /bin/hostname"; exit 1; }
# Herdr loads the changed mod again by itself: a moment for its watcher to start over.
sleep 3

# ---------------------------------------------------------------- studio
cp "$repo_root/remote/herdr-open" "$S/bin/herdr-open"
chmod 755 "$S/bin/herdr-open"
runs="$S/code/search/runs/w46"
mkdir -p "$runs"
"$py" "$here/art.py" loss "$runs/loss.png"
"$py" "$here/art.py" ndcg "$runs/ndcg.png"
cat > "$S/code/search/plot.py" <<'PY'
"""Plots a training run's loss and ndcg@10 (the showcase's stand-in: the charts are there)."""
import sys

run = sys.argv[1] if len(sys.argv) > 1 else "runs/w46"
print(f"Reading {run}/metrics.jsonl: 12 epochs")
print(f"Saved {run}/loss.png")
print(f"Saved {run}/ndcg.png")
PY

# ---------------------------------------------------------------- the main picture
# studio's space (the fifth), its first tab: Claude Code training the ranking model.
do_ space.select --index 5
do_ tab.select --index 1
sleep 1
agent=$(hc ls --json | "$py" -c '
import json, sys
for t in json.load(sys.stdin)["terminals"]:
    if t.get("address", "").startswith("studio/") and t.get("cwd", "").endswith("/code/search"):
        print(t["address"]); break')
[ -n "$agent" ] || { say "no terminal of studio's in ~/code/search"; exit 1; }
printf '%s\n' "$agent" > "$w/run/remote-open-agent"
# What the agent runs to show you its chart. HERDR_OPEN_OPENER: if no Herdr window took it, it
# falls back to nothing, never to this Mac's own `open`.
"$here/open.sh" "$w" "$runs/loss.png"
say "the viewer shows runs/w46/loss.png from $agent"
