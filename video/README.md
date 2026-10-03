# video/

The promo-video pipeline for Pixel Pets. It films the real extension in a
headless Chromium on four made-up set pages and in its real popup, edits the
footage in Remotion, and writes the finished files to `out/`. It is its own
npm project, so Playwright and Remotion never enter the extension's
`npm ci` at the repo root.

## What the film looks like

Each page is filmed in a real 960x436 CSS viewport at device pixel ratio 2
(1920x872). The edit stacks a drawn Mac window and dark browser chrome,
208 px tall, on top of it, with the Pixel Pets icon pinned in the toolbar.
The pets stand on the frame's bottom edge at every zoom. The 9:16 cut is
the same window made narrow: the chrome over a 540x856 CSS viewport, filling
1080x1920. The adoption card hangs from the pinned icon over a dimmed still
of the last review frame. The music is "Funny and Cute Town Theme" by ISAo
(credit below).

## Prerequisites

- Node 24 or newer (`node -v`). The pipeline stops at once on an older Node.
- `ffmpeg` and `ffprobe` on `PATH`, built with libfreetype (for `drawtext`).
- About 5 GB of free disk during a run. Lossless takes are large; each one
  is filmed in the system temp directory and deleted as soon as it is
  rejected or assembled.
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
| 4 gif | Halves the GIF frames to 960x360 and encodes each scene with its own 256-colour palette and no dither, then runs the colour gate (below). The GIF shows the page only, CSS y 76-436 of the capture, with no browser chrome. |
| 5 thumbnail | Cuts an unscaled 1280x720 crop around Rex from the still and draws the icon and "Pixel Pets" at least 80 px from him. The X poster is the uncropped still. |
| 6 describe | Fills `description.template.txt` with a credit (from `assets/CREDITS.json`) for every species in the recorded rosters and for the four species cells the popup card shows (chicken, crab, panda, snail), and with the music track the timeline used. |
| 7 contact-sheet | One tile per second of the master, for a person to skim. Not a gate. |
| 8 qa | The pipeline's own checks: sizes, lengths, codecs, loudness, the render manifest, the recorder's events and the GIF's provenance. |
| 9 prune | Keeps the two newest `build/` runs (never the one just rendered) and empties `.cache/takes/`. |

`npm run video -- --run build/<run>` skips stage 1 and re-renders an existing
recording. Every stage also runs on its own, for example
`npx tsx scripts/gif.mjs --run build/<run>`.

Only stage 9 deletes old recordings. If you record on your own
(`npm run record`, which runs `record/record.mjs`), each run adds a new
`build/<timestamp>/` and nothing removes the old ones, so run
`npx tsx scripts/prune.mjs` afterwards to keep only the two newest.

The drawn browser chrome above each page (`set/chrome/<page>.png` and
`<page>-narrow.png`) is committed. After editing `set/chrome/chrome.html` or
`chrome.css`, regenerate the PNGs with `npx tsx scripts/chrome-png.mjs`; it
fails if the pinned Pixel Pets icon moves from where `shots.json` puts it.

### How long it takes

The recording dominates. Each page shot repeats until a seed passes all of
its accept rules: up to 60 takes of about 8 s per shot and aspect ratio, so
four page shots in two aspect ratios can take most of an hour on a bad day.
The four renders take a few minutes each.

## What lands where

| Path | What |
|---|---|
| `out/pixel-pets-16x9.mp4` | The 1920x1080 master, 27.3-30.0 s, h264 + AAC |
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
2. Listen to the music bed, "Funny and Cute Town Theme" by ISAo
   (`assets/music/funny_and_cute_town_theme.ogg`, OGA-BY 3.0). Its credit is
   required: "Funny and Cute Town Theme" by ISAo, SOUND AIRYLUVS
   (https://airyluvs.com/), OGA-BY 3.0, in the description and in
   `assets/LICENSES.md`.
3. Confirm the sprite licences before publishing: the dog, panda and
   chicken on camera, and the crab and snail whose cells the popup card
   shows. `assets/CREDITS.json` lists each artist, licence and source.
4. Credit the sprite artists in the repo README.
5. Bundle Nunito in the popup, so opening it makes no font request and
   "collects no data" in the call to action holds.
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
