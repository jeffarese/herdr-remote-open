#!/bin/sh
# Runs on the other machine (scripts/machines.sh sends it): points BROWSER at herdr-open in
# Herdr terminals, or takes that out again. herdr-open itself is copied there first.
#
#   sh setup.sh install | remove | status
#
# It edits one shell file, between two marker lines, keeping the file as it was in
# <file>.before-herdr-open. It never edits a file that is a link (a dotfiles checkout) or one
# whose markers don't pair up: then it prints the lines to add by hand instead.
#   zsh:  ~/.config/zsh/local.zshenv when ~/.zshenv reads it, else ~/.zshenv
#   bash: ~/.bash_profile when there is one, else ~/.profile
set -eu
dir=$HOME/.local/share/herdr-open/bin
# Also linked from ~/.local/bin when there is one: agents' shells (Claude Code keeps a copy of
# PATH from when it started) don't always run the shell file. Outside Herdr it opens as usual.
link=$HOME/.local/bin/herdr-open
ours_link() { [ -L "$link" ] && [ "$(readlink "$link")" = "$dir/herdr-open" ]; }
begin='# >>> herdr-open (herdr-remote-open) >>>'
end='# <<< herdr-open <<<'

snippet() {
  cat <<'EOF'
# >>> herdr-open (herdr-remote-open) >>>
# In Herdr terminals, pages and files that programs open go to the Mac whose Herdr window you
# are using (herdr-open). Other terminals are unchanged.
if [ -n "${HC_TERMINAL_ID:-}" ] && [ -x "$HOME/.local/share/herdr-open/bin/herdr-open" ]; then
  BROWSER="$HOME/.local/share/herdr-open/bin/herdr-open"
  case ":$PATH:" in *":$HOME/.local/share/herdr-open/bin:"*) ;; *) PATH="$HOME/.local/share/herdr-open/bin:$PATH" ;; esac
  export BROWSER PATH
fi
# <<< herdr-open <<<
EOF
}

rc_file() {
  case ${SHELL##*/} in
    zsh)
      if [ -f "$HOME/.zshenv" ] && grep -q 'local\.zshenv' "$HOME/.zshenv" 2>/dev/null; then
        echo "$HOME/.config/zsh/local.zshenv"
      else
        echo "$HOME/.zshenv"
      fi
      ;;
    bash | sh | dash)
      if [ -e "$HOME/.bash_profile" ]; then echo "$HOME/.bash_profile"; else echo "$HOME/.profile"; fi
      ;;
    *) echo "" ;;
  esac
}

# The file without our block.
without() {
  awk -v b="$begin" -v e="$end" '$0 == b {skip = 1; next} skip && $0 == e {skip = 0; next} !skip' "$1"
}

has_block() { [ -f "$1" ] && grep -qxF "$begin" "$1"; }

# Each begin marker has its end marker, or the block can't be told from the rest of the file.
balanced() {
  [ ! -f "$1" ] || awk -v b="$begin" -v e="$end" '$0 == b {if (open) bad = 1; open = 1} $0 == e {if (!open) bad = 1; open = 0} END {exit bad || open}' "$1"
}

# Writes the file without our block (plus the block again, for install), keeping a copy first.
rewrite() {
  if ! balanced "$1"; then
    echo "$1 has a herdr-open marker line without its pair, so it was left alone. Fix it by hand:" >&2
    snippet >&2
    exit 1
  fi
  cp -p "$1" "$1.before-herdr-open"
  tmp=$(mktemp)
  without "$1" >"$tmp"
  if [ "${2:-}" = add ]; then snippet >>"$tmp"; fi
  cat "$tmp" >"$1"
  rm -f "$tmp"
}

rc=$(rc_file)
case ${1:-} in
  install)
    [ -f "$dir/herdr-open" ] || { echo "herdr-open isn't in $dir yet" >&2; exit 1; }
    chmod 755 "$dir/herdr-open"
    if [ "$(uname -s)" != Darwin ]; then ln -sf herdr-open "$dir/xdg-open"; fi
    if [ -d "$HOME/.local/bin" ] && { [ ! -e "$link" ] && [ ! -L "$link" ] || ours_link; }; then ln -sf "$dir/herdr-open" "$link"; fi
    if [ -z "$rc" ]; then
      echo "Your shell (${SHELL:-unknown}) isn't one this knows. Add this to its startup file:"
      snippet
      exit 0
    fi
    if [ -L "$rc" ]; then
      echo "$rc is a link (a dotfiles checkout?), so it was left alone. Add this to it:"
      snippet
      exit 0
    fi
    mkdir -p "$(dirname "$rc")"
    if [ -f "$rc" ]; then
      rewrite "$rc" add
    else
      snippet >"$rc"
    fi
    echo "BROWSER goes to herdr-open in new Herdr terminals ($rc). Terminals already open keep their old one."
    ;;
  remove)
    if [ -n "$rc" ] && has_block "$rc" && [ ! -L "$rc" ]; then
      rewrite "$rc"
      echo "Took herdr-open out of $rc."
    fi
    if ours_link; then rm -f "$link"; fi
    rm -rf "$HOME/.local/share/herdr-open"
    echo "Removed herdr-open."
    ;;
  status)
    if [ -x "$dir/herdr-open" ]; then echo "herdr-open: $dir/herdr-open"; else echo "herdr-open: not installed"; fi
    if ours_link; then echo "linked: $link"; fi
    if [ -n "$rc" ] && has_block "$rc"; then echo "BROWSER: set in $rc"; else echo "BROWSER: not set${rc:+ (would go in $rc)}"; fi
    ;;
  *)
    echo "usage: sh setup.sh install | remove | status" >&2
    exit 2
    ;;
esac
