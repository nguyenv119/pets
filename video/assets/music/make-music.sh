#!/bin/sh
# Regenerates the two committed music beds from their (uncommitted) sources.
# Usage: make-music.sh <dir holding cat_caffe.mp3 and forgotten_path.ogg>
# Writes cat_caffe.ogg and forgotten_path.ogg beside this script.
set -e
SRC="$1"
if [ -z "$SRC" ]; then
  echo "usage: make-music.sh <source directory>" >&2
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"

# "Cat caffe" by TAD, CC0, 133.02 s. The storyboard's default bed: the first
# 45 s with a 2 s fade-out.
ffmpeg -nostdin -y -i "$SRC/cat_caffe.mp3" -vn -af 'atrim=0:45,afade=t=out:st=43:d=2' -c:a libvorbis -q:a 4 "$HERE/cat_caffe.ogg"

# "forgotten path" by johndekale, CC0, 40.31 s. The alternate bed: looped to
# 45 s with a 2 s crossfade at the seam.
ffmpeg -nostdin -y -i "$SRC/forgotten_path.ogg" -i "$SRC/forgotten_path.ogg" -filter_complex '[0][1]acrossfade=d=2,atrim=0:45' -c:a libvorbis -q:a 4 "$HERE/forgotten_path.ogg"
