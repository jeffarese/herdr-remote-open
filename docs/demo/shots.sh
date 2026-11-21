#!/bin/sh
# Takes the README's pictures on a showcase stage built with this folder's hook (showcase.sh),
# saves the main one as preview.png and makes docs/media/demo.gif.
#
#   sh docs/demo/shots.sh <stage folder>
#
# The stage starts where showcase.sh leaves it: studio's "Train the ranking model" in front and
# the viewer showing runs/w46/loss.png.
#
# 2  that, the main picture (preview.png, the whole window at 2x, the rest dimmed)
# 1  the same without the viewer
# 3  a shell tab on studio (plots) after `python3 plot.py runs/w46`, which printed two charts
# 4  the right-click menu with them (drawn as a floating block: see layout.py)
# 5  the viewer with ndcg.png, opened as that menu item opens it
#
# Every picture is herdr-showcase's shoot.sh: it waits until nobody has touched the keyboard or
# mouse for a minute, and brings the stage's window forward for a second or two.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
repo_root=$(cd "$here/../.." && pwd -P)
w=$(cd "${1:?usage: shots.sh <stage folder>}" && pwd -P)
kit=${SHOWCASE_KIT:-$HOME/workspace/herdr/herdr-showcase}
# Found before the stage's PATH takes over: a python3 with Pillow, and ffmpeg.
py=
for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 || :)"; do
  [ -x "$p" ] && "$p" -c 'import PIL' 2>/dev/null && { py=$p; break; }
done
[ -n "$py" ] || { echo "needs python3 with Pillow" >&2; exit 2; }
FFMPEG=$(command -v ffmpeg || :)
export FFMPEG
[ -n "$FFMPEG" ] || { echo "needs ffmpeg, for the GIF" >&2; exit 2; }
[ -f "$kit/shoot.sh" ] || { echo "needs herdr-showcase at $kit (SHOWCASE_KIT picks another)" >&2; exit 2; }
# shellcheck disable=SC1091
. "$w/env.sh"
S="$w/studio"
frames="$w/frames"
layout="$HERDR_APP_HOME/layouts/$SC_LAYOUT.json"
mkdir -p "$frames" "$repo_root/docs/media"
# The host-name guard: the stage's copy of the mod must ask showcase.sh's stand-in, never
# /bin/hostname, before any picture is taken.
js="$HERDR_APP_HOME/mods/remote-open/host.js"
if grep -q '"/bin/hostname"' "$js" || ! grep -q hostname-standin "$js"; then
  echo "shots.sh: the stage's remote-open still asks /bin/hostname; build the stage with showcase.sh" >&2
  exit 1
fi

shoot() { f=$1; shift; sh "$kit/shoot.sh" "$w" "$frames/$f.png" "$@" >/dev/null; }
do_() { herdr-app "do" "$@" >/dev/null; }
status() { herdr-app status | "$py" -c "import json, sys; print(json.load(sys.stdin).get('$1') or '')"; }
studio_terminals() { hc ls --json | "$py" -c 'import json, sys; print("\n".join(t["address"] for t in json.load(sys.stdin)["terminals"] if t["address"].startswith("studio/")))'; }

# 2, then 1. In the main picture everything but the viewer is dimmed, as `shoot.sh --dim` dims:
# the viewer's size follows the window, whose height changes a little from stage to stage, so
# dim.py finds its rectangle in the picture first.
shoot 2-viewer
echo "viewer at $("$py" "$here/dim.py" "$frames/2-viewer.png" "$frames/2-viewer.png") (x,y,w,h)"
cp "$frames/2-viewer.png" "$repo_root/preview.png"
sh "$here/open.sh" "$w" --close
shoot 1-agent

# 3, 4, 5: a shell on studio, in the search space, that printed two charts.
before=$(studio_terminals)
do_ tab.new --name plots --folder "$S/code/search"
sleep 1.5
shell=$(studio_terminals | grep -vxF "$before" | head -1)
[ -n "$shell" ] || { echo "no new terminal on studio" >&2; exit 1; }
hc send "$shell" 'clear; python3 plot.py runs/w46' >/dev/null
sleep 1.5
shoot 3-shell
do_ layout.set --layout "$("$py" "$here/layout.py" "$layout" menu "$(status focused_pane)" "$shell")"
sleep 1.5
shoot 4-menu
do_ layout.set --layout "$("$py" "$here/layout.py" "$layout" nomenu)"
sleep 1
sh "$here/open.sh" "$w" "$S/code/search/runs/w46/ndcg.png" "$shell"
shoot 5-viewer
sh "$here/open.sh" "$w" --close

"$py" "$here/compose.py" "$frames" "$repo_root/docs/media/demo.gif"
echo "Made preview.png and docs/media/demo.gif ($(($(wc -c < "$repo_root/docs/media/demo.gif") / 1024)) KB)."
