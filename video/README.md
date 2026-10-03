# video/

The promo-video pipeline for Pixel Pets. It films the real extension in a
headless Chromium on four made-up set pages and in its real popup, edits the
footage in Remotion, and writes the finished files to `out/`. It is its own
npm project, so Playwright and Remotion never enter the extension's
`npm ci` at the repo root.

## Prerequisites

- Node 24 or newer (`node -v`). The pipeline stops at once on an older Node.
- `ffmpeg` and `ffprobe` on `PATH`, built with libfreetype (for `drawtext`).
- About 5 GB of free disk during a run. Lossless takes are large, and
  rejected takes collect in `.cache/takes/` until the last stage clears them.
- No other Chromium recording or Remotion render running on the machine.
  Every browser launch and render takes the lock in `lib/lock.mjs` and waits
  for the holder, because a busy CPU shifts the pets' timing outside the
  recorder's 150-600 ms accept windows.

## The one command

```bash
cd video && npm ci && npm run video
```

`npm run video` runs `scripts/pipeline.mjs`. It stops at the first stage that
fails and names it. Every line of output also goes to `out/pipeline.log`.

| Stage | What it does |
|---|---|
| 0 prepare | Checks Node; runs `npm ci` at the repo root if `../node_modules` is missing (the extension build needs typescript and esbuild); installs Playwright's Chromium and Remotion's headless shell. Each step is a no-op when already done. |
| 1 record | `record/record.mjs` films every shot in `shots.json` at 16:9, re-records the page shots at 9:16, and films the popup adoption once, into `build/<timestamp>/`. |
| 2 render | `scripts/render.mjs --run build/<timestamp>` four times: the 16:9 master, the 9:16 cut, the README GIF frames, and the still at Rex's wave (`src:rex:swipe+600`, no captions). Each render records its run and the sha256 of every recording it read in `out/render-manifest.json`. |
| 3 loudness | Two-pass EBU R128 normalisation of both cuts to -16 LUFS, -1 dBTP, LRA 11. The video stream is copied untouched. |
| 4 gif | Halves the GIF frames to 960x360 and encodes them with a 256-colour palette and no dither, then runs the colour gate (below). |
| 5 thumbnail | Cuts an unscaled 1280x720 crop around Rex from the still and draws the icon and "Pixel Pets" at least 80 px from him. The X poster is the uncropped still. |
| 6 describe | Fills `description.template.txt` with a credit for every species on screen (from `assets/CREDITS.json`) and the music track the timeline used. |
| 7 contact-sheet | One tile per second of the master, for a person to skim. Not a gate. |
| 8 qa | The pipeline's own checks: sizes, lengths, codecs, loudness, the render manifest, the recorder's events and the GIF's provenance. |
| 9 prune | Keeps the two newest `build/` runs (never the one just rendered) and empties `.cache/takes/`. |

`npm run video -- --run build/<run>` skips stage 1 and re-renders an existing
recording. Every stage also runs on its own, for example
`npx tsx scripts/gif.mjs --run build/<run>`.

### How long it takes

The recording dominates. Each page shot repeats until a seed passes all of
its accept rules: up to 60 takes of about 8 s per shot and aspect ratio, so
four page shots in two aspect ratios can take most of an hour on a bad day.
The four renders take a few minutes each.

## What lands where

| Path | What |
|---|---|
| `out/pixel-pets-16x9.mp4` | The 1920x1080 master, 28.3-31.0 s, h264 + AAC |
| `out/pixel-pets-9x16.mp4` | The 1080x1920 cut for Shorts, Reels and TikTok |
| `out/pixel-pets.gif` | The README GIF, 960x360, about 8.6 s, under 5 MB |
| `out/thumbnail.png`, `out/x-poster.png` | The YouTube thumbnail and the X poster frame |
| `out/description.txt` | The YouTube description, credits filled in |
| `out/contact-sheet.png` | One frame per second of the master |
| `out/timeline.json`, `out/timeline-9x16.json` | What each cut shows, beat by beat |
| `out/render-manifest.json` | Which run and which recordings each render read |
| `out/pipeline.log` | The whole run's output |
| `build/<run>/` | The recordings: `<shot>/demo.mp4` and `events.json`, with the 9:16 page shots under `v916/` |

`out/`, `build/` and `.cache/` are gitignored.

## The GIF colour gate

A sprite colour that shifts on its way from the screen into the GIF is easy
to miss by eye. The shift comes from an untagged encode that Remotion
decodes off-colour, or from a palette short on colours. So on every GIF
frame where nothing covers him (the drawn cursor, the extension's 🍖 and ❤️
particles, a caption, another pet), the gate places Rex's source sprite
frame at his tracked box the way the extension draws him, and fails the
stage if any opaque Rex pixel is more than 8 RGB units from a colour in that
frame. It needs at least 20 judged frames, so a GIF where nothing can be
judged fails too.

`scripts/gif-gate-control.mjs --proof <frames-lossless-rgb.mkv>` proves the
gate through Remotion. It encodes the same lossless proof frames with the
recorder's BT.709 recipe, which must pass, and without colour tags, which
must fail. On 233 judged frames the tagged encode's worst Rex pixel was 1
unit off and the untagged one's was 11. The control writes into `out/`, so
run it before a pipeline run, not during one.

Halving uses `flags=neighbor+full_chroma_inp+full_chroma_int`. Plain
`flags=neighbor` scales RGB through subsampled chroma, which blends a 1 px
column at every colour edge: a black outline beside tan fur came out
`#b08d74`, 28 units from any sprite colour.

## Before publishing (people, not the pipeline)

The pipeline proves the film has the approved beats. It cannot hear or judge
taste, and nobody has listened to the audio yet.

1. Watch and listen to both cuts. Look through `out/contact-sheet.png`.
2. Pick the music by ear. The edit uses "Cat caffe"; "forgotten path" is the
   other bed in `assets/music/`. The description credits whichever one
   `out/timeline.json` names.
3. Decide on the sprite licences. The dog sprites are NVPH Studio's, CC
   BY-ND 4.0, with the wave and lying poses made in vscode-pets: accept that
   reading or ask NVPH Studio. The panda (Jessie Ferris) and the chicken
   (Gulnur Baimukhambetova) are MIT via vscode-pets, and so are the crab
   (Marc Duiker) and the snail (Kennet Shin), whose cells the shelter card
   shows at about 128 px: accept the MIT reading or ask the artists.
4. Credit each sprite artist in the repo README (pets-ctn).
5. Bundle Nunito in the popup (pets-gvd). Until then, opening the popup
   requests Google Fonts, and "collects no data" in the call to action is
   harder to defend.
6. Upload the master to YouTube with `out/thumbnail.png` and
   `out/description.txt`, and paste the link into the Chrome Web Store
   dashboard's promo-video field.
7. Post the 9:16 cut once the profile's bio links point at the store listing.

## Freeze rule

These files are the shared contract between the beads that built this
directory. Later work only adds files; a needed change to any of them is its
own follow-up:

- `package.json`
- `shots.json`
- `src/schema.ts`
- `src/anchors.ts`
- `src/species.node.ts`
- `lib/browser.mjs`

`CHECK_THRESHOLDS` in `src/remotion/checks.ts` is frozen too. A real take
that trips a framing check is fixed with a new take, never by relaxing a
threshold.
