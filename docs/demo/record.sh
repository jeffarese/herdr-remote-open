#!/bin/sh
# Takes the README's pictures again: builds a showcase stage with this folder's hook, takes the
# pictures, makes the GIF, and takes the stage down, also when something fails.
#
#   sh docs/demo/record.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
kit=${SHOWCASE_KIT:-$HOME/workspace/herdr/herdr-showcase}
export SHOWCASE_KIT="$kit"
w=$(SHOWCASE_HOOK="$here/showcase.sh" sh "$kit/stage.sh")
trap 'sh "$kit/stage.sh" --down "$w"' EXIT
sh "$here/shots.sh" "$w"
