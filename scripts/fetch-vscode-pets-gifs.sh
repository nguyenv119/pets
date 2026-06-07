#!/usr/bin/env bash
set -euo pipefail
BASE="https://raw.githubusercontent.com/tonybaloney/vscode-pets/main/media"

# Download a single suffix (swipe) for a list of colors.
fetch() {
  local pet="$1"; shift
  mkdir -p "assets/$pet"
  for color in "$@"; do
    curl -fsSL "$BASE/$pet/${color}_swipe_8fps.gif" -o "assets/$pet/${color}_swipe_8fps.gif"
  done
}

# Download multiple suffixes for multiple colors.
# Usage: fetch_multi <pet> <colors...> -- <suffixes...>
fetch_multi() {
  local pet="$1"; shift
  local -a colors=()
  local -a suffixes=()
  local parsing_colors=true

  for arg in "$@"; do
    if [[ "$arg" == "--" ]]; then
      parsing_colors=false
    elif $parsing_colors; then
      colors+=("$arg")
    else
      suffixes+=("$arg")
    fi
  done

  mkdir -p "assets/$pet"
  for color in "${colors[@]}"; do
    for suffix in "${suffixes[@]}"; do
      curl -fsSL "$BASE/$pet/${color}_${suffix}_8fps.gif" -o "assets/$pet/${color}_${suffix}_8fps.gif"
    done
  done
}

# Original animals — swipe only
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

# New animals — idle, walk, run, swipe, with_ball
STANDARD_SUFFIXES=(idle walk run swipe with_ball)

fetch_multi cockatiel brown gray -- "${STANDARD_SUFFIXES[@]}"
fetch_multi rat        brown gray white -- "${STANDARD_SUFFIXES[@]}"
fetch_multi snake      green -- "${STANDARD_SUFFIXES[@]}"

# Horse — idle, walk, run, swipe, with_ball, stand
HORSE_SUFFIXES=(idle walk run swipe with_ball stand)
fetch_multi horse \
  black brown white magical warrior \
  paint_beige paint_black paint_brown \
  socks_beige socks_black socks_brown \
  -- "${HORSE_SUFFIXES[@]}"

echo "Downloaded new animal gifs."
