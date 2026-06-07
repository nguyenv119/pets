#!/usr/bin/env bash
set -euo pipefail
BASE="https://raw.githubusercontent.com/tonybaloney/vscode-pets/main/media"

fetch() {
  local pet="$1"; shift
  mkdir -p "assets/$pet"
  for color in "$@"; do
    curl -fsSL "$BASE/$pet/${color}_swipe_8fps.gif" -o "assets/$pet/${color}_swipe_8fps.gif"
  done
}

fetch chicken brown white
fetch crab    red
fetch dog     akita black brown red white
fetch fox     red white
fetch monkey  gray
fetch panda   black brown
fetch snail   brown
fetch totoro  gray
fetch turtle  green orange

echo "Downloaded swipe gifs."
