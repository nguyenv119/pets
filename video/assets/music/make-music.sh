#!/bin/sh
# Regenerates the committed music bed from its (uncommitted) source.
# Usage: make-music.sh <dir holding oga_majitapioka_0.mp3>
#   (the download from https://opengameart.org/content/funny-and-cute-town-theme)
# Writes funny_and_cute_town_theme.ogg beside this script.
set -e
SRC="$1"
if [ -z "$SRC" ]; then
  echo "usage: make-music.sh <source directory>" >&2
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET_LUFS=-20.4 # the v1 bed's integrated loudness; the cut is normalised to -16 LUFS later (scripts/loudness.mjs)
CUT='atrim=0:45,afade=t=out:st=43:d=2'

# "Funny and Cute Town Theme" by ISAo: the first 45 s with a 2 s fade-out,
# gained (one linear volume step) to TARGET_LUFS integrated.
I=$(ffmpeg -nostdin -nostats -i "$SRC/oga_majitapioka_0.mp3" -vn -af "$CUT,ebur128" -f null - 2>&1 | sed -n 's/^ *I: *\(-*[0-9.]*\) LUFS.*/\1/p' | tail -1)
GAIN=$(echo "$TARGET_LUFS - ($I)" | bc -l)
ffmpeg -nostdin -y -i "$SRC/oga_majitapioka_0.mp3" -vn -af "$CUT,volume=${GAIN}dB" -c:a libvorbis -q:a 4 "$HERE/funny_and_cute_town_theme.ogg"
