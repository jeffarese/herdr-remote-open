#!/bin/sh
# Install the remote-open mod into the Herdr app, update it, or take it out.
#
#   ./install.sh                     copy mods/remote-open in and add it to your own layouts
#   ./install.sh --machines a b      also set herdr-open up on those machines (--all: every
#                                    connected one); see scripts/machines.sh
#   ./install.sh --remove            take it out of your layouts and delete the mod (machines:
#                                    scripts/machines.sh remove --all)
#
# The app's home is ~/.config/herdr-app, or $HERDR_APP_HOME. Needs python3.
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
dest="$home/mods/remote-open"
app=$(command -v herdr-app 2>/dev/null || echo "$HOME/.local/bin/herdr-app")

[ -d "$home/mods" ] || { echo "No Herdr app home at $home. Start the Herdr app once first." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "The installer needs python3." >&2; exit 1; }
[ -f "$here/mods/remote-open/main.js" ] || { echo "Run install.sh from a checkout of herdr-remote-open." >&2; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  python3 "$here/scripts/install.py" layouts remove
  rm -rf "$dest"
  echo "Removed the remote-open mod. Forwards it started keep running until they end or you stop them:"
  echo "  ls $home/data/remote-open/cm"
  exit 0
fi

if [ -x "$app" ]; then "$app" check "$here/mods/remote-open"; fi
mkdir -p "$dest"
cp "$here"/mods/remote-open/*.js "$here"/mods/remote-open/mod.json "$here"/mods/remote-open/*.svg "$dest/"
python3 "$here/scripts/install.py" layouts add
echo "Installed remote-open."

if [ "${1:-}" = "--machines" ]; then
  shift
  sh "$here/scripts/machines.sh" install "$@"
fi
