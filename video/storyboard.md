# Pixel Pets promo, production spec: "Still There"


## Logline

The same small dog is already standing at the bottom of your inbox and a code review. Three clicks and a name in the shelter bring a chicken called Pip, and a second later she is on your budget spreadsheet saying hi, with a panda for company. At 10 pm all three lie down where they stand.

## Tone

Quiet and dry. Lowercase captions say exactly what just happened and never sell. The camera goes where your eye would go. The brand line at the end is the one sentence-case line. The film is cozy without being cutesy, and it follows the same brief as the store tiles: show the moment of opening a page and finding a pet there.

**Creative direction (verbatim):** "punchy motion graphics video. Keep it clean, polished; you are an incredible motion designer."

How the two fit together: the words stay dry and the motion gets punchy.
- **Camera:** every short push is 450 ms (was 600) on a fast-out ease (ease-out-expo, `cubic-bezier(0.16, 1, 0.3, 1)`), so each move snaps onto the action and settles. The night push stays a slow 3.0 s ease-in-out, the film's one slow move, so the ending lands by contrast.
- **Cuts:** hard cuts on an action frame only (a click, a pop-in, a first paint). No crossfades, wipes, whip pans or zoom blur.
- **Captions:** the pill springs in at full opacity (scale 0.9 to 1.0, at most 4 % overshoot, 180 ms; only the words fade), words keep their 70 ms stagger, and the exit is a 120 ms fade.
- **The popup card:** the shelter beat is the one motion-graphic container: the real popup, cropped, hanging from the pinned Pixel Pets icon in the toolbar over a dimmed still of the review page, springing in and morphing between crops (beat 4).
- **Brand line and CTA:** the brand line rises 8 px and fades in over 300 ms. In the CTA the icon pops (0 to 1.06 to 1.0 over 240 ms) and each line rises in 90 ms after the one before; then everything holds still so it reads.
- **Never:** no motion or effect on a page sprite, and no HUD, level tags, confetti, glow, grain, vignette or dim layer. The product's own particles are the only effects on a page.

## Deliverables

| Cut | Frame | Length | Source |
|---|---|---|---|
| 16:9 master | 1920x1080, 25 fps | 27.8 s nominal; 27.8-29.3 s depending on the catch (see "Length rule") | four page takes at 960x436 CSS px under a drawn browser chrome, plus one popup take at 500x960 CSS px, all captured at device pixel ratio 2, shown 1:1 or 2:1 |
| 9:16 | 1080x1920, 25 fps | about 28.0 s | the page takes re-recorded at 540x856 CSS px at pixel ratio 2 in a narrow window with the same chrome; the popup take reused; shown 1:1 or 2:1 |
| README GIF | 960x360, 12.5 fps | about 8.6 s, loops | two 16:9 takes, halved with nearest-neighbour, under 5 MB |
| Thumbnail | 1280x720 PNG | still | a 1:1 cut from the master's 2.0x wave frame, with the name beside Rex |

## Cast

Rex (dog, brown), Bao (panda, black) and Pip (chicken, white). Full sprite credits are in `video/assets/CREDITS.json` and `video/assets/LICENSES.md`.

## Set pages

All four pages are original and fictional. The fifth take films the extension's own popup (section 5 below). Each is served as `https://pixelpets.demo/<id>.html` through `page.route`, and the route spike showed the content script attaching 96 ms after goto on this setup. The recorder writes the take's seed into the page it serves: `<html data-pp-seed="N" data-pp-hour="14">`. The pages carry no brand, logo, real person or copyrighted image.

**Rules for every page:**
- **Fonts:** the pages use three bundled OFL fonts, served through the same route: Inter for interface text, Source Serif 4 for the article and JetBrains Mono for the diff. No page falls back to a system font. Before the first action the recorder checks that each font has a FontFace with status `loaded` (`document.fonts.check()` is true even for an undeclared family, so it is never the test). This matters for layout, because the empty double-click zone and the text-free bands are measured in these fonts.
- **The whole viewport is on screen (wide layout):** the page is a real 960x436 CSS viewport shown 1:1 under the drawn chrome (see "Stage and camera"), so each page's own top bar starts at y 0. Every y below is page CSS px.
- **The crop line at y 166:** every 2.0x hold shows CSS y 166-436. No text box straddles y 166, so no line of text is cut by the top edge of a 2.0x hold.
- **Bottom 150 CSS px (y 286-436):** nothing interactive (no link, button, input, list row, tab strip, status bar, sticky footer, chat bubble, toast, cookie or consent banner) and no text for the pets to stand on. The review page's transparent, empty `div#dbl-zone` is the one exception.
- **Narrow layout (540x856, for the 9:16):** the whole viewport is on screen under the chrome. The 9:16's 2.0x crop begins at y 376, so no text box straddles y 376. The bottom 150 px (y 706-856) follows the same rule as above.

### 1. `inbox` (beats 1-2)
- **What:** the layout of a dark webmail inbox in an unnamed mail app on a weekday morning, with our own invented messages. App background #131417, list card #1e1f22. No logo or wordmark: the app mark is a plain envelope outline and the word "Mail".
- **Layout:** a header at y 0-42 with a menu glyph, the mark, a rounded "Search mail" box and an "AK" initials badge. An icon rail at x 0-64 (Mail, Chat, Calls) and the folders at x 64-224 under a "Compose" button (y 44-78): Inbox 12, Flagged, Later, Sent, Drafts, 28 px each from y 82. The list card spans x 232-952 from y 42 to the viewport bottom: four category tabs sharing one accent at y 42-82, then five 28 px mail rows at y 82-222 (row edges at 110, 138, 166 and 194), each with a checkbox, star, sender, subject, grey preview and time. Priya, Tomás and Mina are unread (bold) and Tomás is starred:
  1. Priya · Re: Re: logo feedback · ok last one, can we try the blue again · 9:41
  2. Build bot · Nightly build passed · 212 checks in 6 min 12 s · 9:30
  3. Tomás · Lunch? (the good noodle place) · 12:30, I'll book for four · 9:12
  4. Calendar · Design review moved to 10:00 · Room 3B, bring the prototype · 8:55
  5. Mina · Q3 budget, v7 final (2) · sorry, one more change to row 4 · 8:40
- **Below y 236:** list background only. The v1 end note is gone: this layout has no place for it.
- **Removed since v2:** the "Design review in 1 min. You're presenting." strip, which only set up the cut hide beat.

### 2. `review` (beat 3)
- **What:** the layout of a pull request's "Files changed" view in an unnamed code host, "Reset chart zoom on double-click #212", dark from the first frame (`data-theme="dark"` and an inline `<html>` background). Background #0f1216, panels #161b22. No logo, mascot, avatars or real usernames ("ak" is invented).
- **Layout:** a compact PR header at y 0-36 (an Open pill, the title, "ak wants to merge 2 commits into main from reset-on-dblclick"), tabs at y 36-68 with a "Submit review" button, and a file tree on the left at y 74-232 (22 px items, an item edge at y 166). `src/chart/index.ts` is collapsed and Viewed at y 72-100; `src/chart/interactions.ts` is open below it, header at y 104-130, as a split diff in 18 px JetBrains Mono rows at y 130-220 (a row edge at y 166). To fit a half-column the code is shortened to `chart.on(...)`:
  ```
  41   export function bindChartEvents(chart) {
  42     chart.on("wheel", zoomAt);
  43 -   chart.on("click", resetZoom);
  44 +   chart.on("dblclick", resetZoom);
  45 +   // single click selects a bar now
  46     chart.on("mousemove", showTooltip);
  47   }
  ```
- **Double-click target (default):** `div#dbl-zone`, an empty, transparent, `user-select:none` box at x 700-900, y 276-336 over the empty page background. `document.elementFromPoint` must return it, and no pet box may contain the point. The ball always drops from the top of the page at the click's x, so the click's height does not matter.
- **Alternate:** double-click the word `dblclick` on the added line (`span#dbl`). A viewer who reads the diff gets the joke, but every viewer sees that selecting a word throws a ball.
- **Below y 220:** nothing but page background.

### 3. `sheet` (beat 5)
- **What:** the "Q3 budget, v7 final (2)" file from Mina's mail, open in an unnamed spreadsheet app. Light theme, restyled (layout only).
- **Layout:** a title row at y 0-36 with the file name and three plain menu words (File, Edit, View), no star. A toolbar of glyphs drawn as divs at y 36-60; a formula bar at y 60-84 showing `fx =SUM(C2:C5)`. Sheet tabs (Summary, Q3, Receipts) sit at the top, y 84-106, because real apps put them at the bottom, where the pets stand. Column headers A-F at y 106-126 and row numbers at x 0-40. Six 20 px rows at y 126-246 (a row edge at y 166): Item / Owner / Q3 / Notes; Coffee beans / Tomás / 240 / the good ones; Plant care / Mina / 36 / ferns only; Printer ink / Priya / 180 / why; Team lunch / Tomás / 310 / noodles; Total / / 766, with C6 selected under a green outline.
- **Below y 246:** empty rows with faint grid lines and nothing else: no text, sheet tabs, status bar or scroll bars.

### 4. `article` (beats 6-8)
- **What:** a long read on an unnamed reading site, "A short history of the night light", in the site's own dark reading theme (`data-theme="dark"` and an inline background in the HTML from the first frame). The theme never changes during the take, and no dim layer touches the recording.
- **Layout (restyled, layout only):** background #1B1D23. A top bar at y 0-28 shows "Reading list" and an "Aa" glyph as plain text. The title is Source Serif 4, 28 px, #EDE6D6, at x 100, y 36-70. The byline "by R. Okafor, 9 min read" sits at y 76-94. Two paragraphs of one line each, 17 px on a 24 px line, #D8D4C8, run at x 100-900: the first at y 104-128, the second at y 138-162.
  - "Before electricity, a night light was a candle in a jar, and someone had to stay up to watch it."
  - "Later ones plugged into the wall and glowed just enough to find a door, and not enough to read by."
- **Cut since v2:** the third paragraph and the "· · ·" end mark. The third paragraph was a second thesis line sitting under the brand line.
- **Empty zones the overlays need:** top right x 800-944, y 0-96 for the clock. Everything below y 166 is plain background, so a 2.0x hold shows only the dark page above the pets, and the brand line and CTA sit there.

### 5. `popup` (beat 4, the shelter)
- **What:** the real, shipped popup (`src/popup/popup.html`), opened in the same persistent context as a page at `chrome-extension://<id>/popup/popup.html`, the id read from the service worker URL. It is 500x960 CSS px at pixel ratio 2, in its light theme (at 500x760 the expanded form scrolls to 936 px and Add Pet falls below the fold, measured on the shipped popup). It is not a set page and is not routed. The recording copy of `dist` changes only `content.js`, so this is exactly what a user sees.
- **Seed:** roster Rex and Bao, 9 treats, light theme, and `homeAnchorAt` 9 days ago, which gives 4 homes (`min(7, 1 + floor(days / 3))`, `src/settings.ts:16-17, 62-70`). Two pets need a third home free before the capacity gate (`canAddPet`, `src/popup/capacity-gate.ts`) lets Add Pet work.
- **Why 500 px wide:** the type grid lists species in `COLORS` order (`src/popup/colors.ts:4-19`): chicken, crab, dog, fox, miffy, monkey, panda, snail, totoro, turtle, cockatiel, rat, snake, horse. The body is border-box with 20 px padding (`popup.css:1-5, 79-85`), the form adds 16 px (`popup.css:380-388`), and the grid is `repeat(auto-fill, minmax(64px, 1fr))` with a 6 px gap (`popup.css:442-446`). At 500 px the grid is 428 px wide and has 6 columns of about 66 px:

  | | col 1 | col 2 | col 3 | col 4 | col 5 | col 6 |
  |---|---|---|---|---|---|---|
  | row 1 | **chicken** | crab | dog (akita thumbnail) | fox | miffy | monkey |
  | row 2 | **panda** | snail | totoro | turtle | cockatiel | rat |
  | row 3 | snake | horse | | | | |

  This is the only width where the chicken and the panda share column 1 with nothing but the crab and the snail beside them. At 420 px (5 columns) the monkey sits under the chicken; at 560 px and wider the totoro or the cockatiel sits under the chicken or the crab.
- **Never in frame:** the Totoro, Miffy, fox, cockatiel, monkey, horse and dog cells. The dog cell shows the akita, because `COLORS.dog[0]` is `akita`. Rex's own row in the pet list shows the brown dog, which is cast.
- **Three crops:** each one is computed per frame from DOMRects the recorder logs, never hard-coded.
  - **A, list:** full width, from the top of the pet list − 8 to the bottom of the Visit Shelter button + 4. It shows the Rex and Bao rows and the button. The form starts 8 px below the button and expands downward, outside the crop.
  - **B, pick:** from the form's left edge to the crab cell's right edge + 3 (column 3 starts 6 px later), and from the Name field's top − 8 to the panda cell's bottom + 3 (row 3 starts 6 px lower). It shows "Name" with "Pip" being typed, "Type", and the chicken, crab, panda and snail cells. The Name field is cut at its right edge.
  - **C, add:** full width, from the Color label's top − 4 to Add Pet's bottom + 8. It shows the chicken's brown and white swatches and the Add Pet button. The last grid row ends 12 px above the Color label.
- **The proof:** every frame the edit shows from this take is exactly one crop. The card's frame may animate, but its content is never panned or widened. Each crop must miss every forbidden cell's logged DOMRect on every frame, or the render fails. The take is discarded if the grid is not 6 columns in the order above, or if the page can scroll.
- **Layout-shift trap:** `addPet()` (`src/popup/popup.ts:227-265`) re-renders the pet list one row taller before it collapses the form, which pushes the grid down into crop C for up to about 250 ms. So crop C ends 160 ms after the Add Pet mousedown (the recording shows the press about 56 ms after the log, so it is on screen for 2-3 frames), and the mouseup (the click that runs `addPet`) is sent 240 ms after it. The next shot shows the result, and the recorder proves it: within 1 s `pixel-pets-v1` holds Rex, Bao and a white chicken named Pip.
- **Banner:** opened as a page, the popup's active-tab probe finds no content script on its own tab, shows "Pets can't run on this page" at the top and disables the ball button. Both sit above crop A.
- **Font:** `popup.html:7-9` loads Nunito from Google Fonts. The recorder either routes those two hosts to a bundled Nunito (OFL) or waits for `document.fonts.check('13px Nunito')`.
- **Recorded once:** the popup does not depend on the page viewport, so the 9:16 reuses this take.

## Production ground rules

- **Capture (changed):** Playwright launches the recording copy of the unpacked build headless, with `--force-device-scale-factor=2` and `deviceScaleFactor: 2` at a 960x436 CSS viewport. Chrome's screencast (CDP `Page.startScreencast`, PNG, every frame acked) delivers native 1920x872 frames at about 59 fps, each with its own timestamp. The pipeline assembles them to constant 25 fps with the ffmpeg concat demuxer and per-frame durations. At this density the dog is drawn at 0.91-1.11x of his GIFs instead of 0.46-0.56x, and nothing passes through VP8. Playwright's `recordVideo` is not used. The context is reused so the extension id and service worker stay the same, with one page per shot. Close each page before seeding the next, because a page's debounced position save can overwrite the new seed. The popup take (`s2b_shelter`) is one more page in the same context, at 500x960 CSS px (`page.setViewportSize`), still at pixel ratio 2.
- **Recording copy and shim v3 (changed):** `content.js` in a copy of `dist` is prefixed with the proven shim (seeded mulberry32 `Math.random` plus `Date.prototype.getHours`). The content script runs at `document_idle`, so the shim reads `data-pp-seed` from the routed page's own `<html>` once at boot. It reads `data-pp-hour` on every `getHours` call, defaulting to 14. It then writes `data-pp-shim="v3;seed=N"`, or `data-pp-shim="NO_SEED"` when the attribute is missing. Before the first action, the recorder asserts that `data-pp-shim` names the intended seed, and it discards the take if not. For the night beat it flips the hour at runtime with `page.evaluate(() => document.documentElement.dataset.ppHour = '22')`, which put both pets on the lie sprite 9 ms later in the producer's probe. The v2 shim read the seed from `addInitScript`, which runs before `<html>` exists, so every v2 "seed" was really seed 0. The shipped `dist` is never touched.
- **Choreography:** the pets respond only to seeded storage, raw `page.mouse` events at their live boxes, and the hour attribute. Hover and click happen at the **hover point**, 5 px inside the box's upper-right corner, re-aimed from the live box until the swipe sprite is observed. At that point the drawn arrow covers none of Rex's art pixels, facing either way.
- **Seeds:** each shot, and each 9:16 re-record, runs its own headless seed search against its accept rules in video/shots.json. A take that misses its rule is discarded, never patched and never re-clicked. The sim pass rates below come from the producer's port of the real state machine, which matched the browser to within 1-3 frames on six seeds. Treat them as guidance, not as a result.
- **Cuts:** every cut, caption, camera move and sound is anchored to a logged event plus an offset. The times in the beat table are nominal.
- **Logged events (epoch ms):** `clap` (start and end of each page's capture); `first_paint`; `pets_ready`; `shim` (the attribute's value); `src` changes per pet; `greet_start` and `greet_end`; `ball_on`, `ball_floor`, `ball_off` and `heart_on` with x and y, from a per-frame canvas scan of the open shadow root; `hour_set` and `sleep`; dense cursor samples (about 60 Hz); and mouse down, up, click and dblclick with x and y. **New:** the same rAF loop that scans the canvas (about 1.8 ms a scan) also logs every visible pet's box and src, and the ball's position, on every frame. The camera follows walking pets from that track, and the compositor checks margins against it.
- **Catch rule (changed):** `ball_off` and `heart_on` arrive within 60 ms of each other. The catcher is the visible pet whose box centre x is nearest the heart, and the catch counts only if |heart.x − (box.x + 32)| ≤ 40 and heart.y lies between box.top − 48 and box.top. The heart's red-pixel centroid first shows 47-48 px above the box centre, so the rule never measures from the box centre. Nor does it infer a catch from run turning to idle, because `nearBall` flickers.
- **Feed rule (changed):** a warm feed shows its heart within 50 ms. If `heart_on` has not arrived 400 ms after the mouseup, the take is discarded and run again. There is no second click, because a slow first reply plus a re-click would feed twice.
- **Clapperboard:** a 160 ms magenta frame at the start and end of every page capture, trimmed in the edit. Alignment is measured from it, never assumed.
- **Nothing drawn on sprites:** the drawn arrow at the hover point covers no art pixels on Rex, and nothing else overlaps a pet on a page. In the shelter card the cursor tip rests on the chicken's cell when it picks her; the cursor and its rings are clipped to the card. A click that lands inside a pet box gets no ring, since the 🍖 and ❤️ already show it. No grade, vignette, dim layer or fade to black is ever applied. Night comes from the article's own dark theme.

## Stage and camera (changed)

- **Stage:** a drawn Mac window with a dark browser chrome (tab strip 40, toolbar 38 and bookmarks bar 26 CSS px, drawn at 2x: 208 output px) fills stage y 0-208: traffic lights, generic tabs, the address bar showing `pixelpets.demo/<page>.html`, invented bookmarks and our Pixel Pets icon pinned in the toolbar. No logos. Each shot has its own committed chrome PNG (`set/chrome/<page>.png`). Below it the 960x436 page capture sits pixel for pixel at stage y 208-1080 (stage y = 208 + 2 x CSS y). Square corners. There is no floor band: the pets' feet are on the window's bottom edge, which is the frame's bottom edge.
- **Holds:** 1.0x (native pixels) and 2.0x (each native pixel drawn as 2x2) only. Both are pixel-clean with nearest-neighbour. Fractional zoom exists only mid-move.
- **Floor-anchored crops:** at zoom z the crop is 1920/z by 1080/z stage px, and its bottom edge is the frame bottom (stage y 1080), so the pets' feet stay on the frame bottom at every zoom. At 2.0x the crop is 960x540 at stage y 540-1080: page CSS y 166-436, no chrome. Horizontally the crop centres on its focus and clamps to the stage edges.
- **Focus:** `pet:<id>` centres on that pet and follows the per-frame box track with 400 ms smoothing. `between:<a>,<b>` centres between two pets. `page` is the whole stage.
- **The shelter beat is the exception:** it shows no live page. The chrome stays on screen and the card hangs from the pinned icon, over a still of the last review frame at 1.0x with its page area dimmed (multiply 0.45) (section 5 and beat 4).
- **Checks that fail the render:** any shown popup frame that is not exactly one declared crop, or a crop that meets a forbidden shelter cell; a crop edge within 16 stage px (8 CSS px) of a visible pet box, unless that edge is the page edge; any caption, name tag, clock, brand line or CTA within 80 output px of a pet box, or inside the particle column (the box's x range widened by 24 CSS px, extended 80 CSS px up) of a pet that can emit particles in that span, from a hover, feed or catch until its particles fade (sleeping pets emit none, so the night and CTA overlays may sit above them); and, in the fetch push, the ball leaving the crop between `ball_in_frame` and the catch. For that last one there is a fallback: hold 1.0x and hard-cut to 2.0x on the catch frame, as v2 did.

## Typography and cursor

| Use | Font (local, OFL) | Spec on the 1080p master |
|---|---|---|
| Captions | VT323 (`video/assets/fonts/VT323-Regular.ttf`) | 72 px, lowercase, #484848 on a cream #FFE3B0 pill with a 3 px olive #A4B859 border, 6 px radius, 12/22 px padding. At most 30 characters. Only one caption is on screen at a time, and the name tag counts as a caption. The clock, the brand line and the CTA are separate layers. **Position (changed):** in the band above the pet strip, beside the acting pet, with the pill at least 80 px from the sprite box and from its particle column (the box's x range widened by 24 CSS px, extended 80 CSS px up). When the pill does not fit beside, as at most 2.0x holds, it sits above the particle column with the same gap. Captions never default to a frame corner. Words pop in with a 70 ms stagger (opacity plus a 6 px rise over 120 ms) and leave with a 150 ms fade. No typewriter sounds. |
| Name tag (beat 1) | Press Start 2P (`video/assets/fonts/PressStart2P-Regular.ttf`) plus the store icon | The store icon (`assets/icons/icon-128.png`, 16x16 pixel art drawn at 8x, so 64 px and 128 px are exact multiples) at 64 px, then "Pixel Pets" in Press Start 2P 40 px (30 px x-height, above the 28.8 px of the 72 px VT323 captions), on the caption pill. It is shown alone, in the caption slot. The icon is the product's front-facing dog face, not a frame from any pet sprite. |
| Clock (beat 5) | VT323 | 60 px, cream #FFE3B0, no pill, top right below the chrome (output x 1600-1888, y 232-376), from the in point to `sleep` + 2200 ms. |
| Brand line (beat 6) | VT323 | 84 px, sentence case, cream, no pill, left-aligned at x 160, bottom edge at least 80 px above the pets. |
| CTA (beat 7) | Press Start 2P and VT323 | The store icon at 128 px (1:1) beside "Pixel Pets" in Press Start 2P 56 px cream. Below it, VT323 64 px cream "add to Chrome. it's free.", then VT323 52 px sage rgb(210,226,138) "collects no data · 14 kinds of pet". Last, two credit lines in VT323 28 px sage: "sprites: dog by NVPH Studio (CC BY-ND 4.0); panda by Jessie Ferris" / "and chicken by Gulnur Baimukhambetova (both MIT), via vscode-pets", each about 940 px wide. The icon helps a searcher pick this listing over the unrelated "pixel-pets" by JVCOB (2,000 users). |

**Cursor:** a black arrow with a 2 px white outline, 22 CSS px tall. It lives in page space, so it scales with the camera (44 px at 1.0x, 88 px at 2.0x), and it eases along the logged path. A click on the page draws one ring (250 ms, up to 18 CSS px radius), stroked #484848 with a 1 px cream inner stroke, which reads on both light and dark pages. A double-click draws two rings 90 ms apart. A click inside a pet box draws no ring.

## Music and SFX

Every file below is under `video/assets`. The extension is silent, and every sound here is added in the edit.

**Music bed:** "Funny and Cute Town Theme" by ISAo (`video/assets/music/funny_and_cute_town_theme.ogg`, OGA-BY 3.0). The credit is required in the YouTube description and in `video/assets/LICENSES.md`: "Funny and Cute Town Theme" by ISAo, SOUND AIRYLUVS (https://airyluvs.com/), OGA-BY 3.0.
- **Frame 0 to the first wave:** the bed plays quietly, at about −30 LUFS short-term, so an embed that starts playing is audibly a video from the first frame.
- **The first 👋 (`src:rex:swipe`):** the bed comes up to about −22 LUFS over 1.2 s.
- **Catch alignment:** the review take's in point may shift up to 200 ms so the catch lands on a beat.
- **Sleep:** the music stops with a 250 ms fade on the light switch, and the brand line and CTA play over room tone.
- **Master:** about −16 LUFS integrated, −1 dBTP, AAC 192 kbps, 48 kHz stereo.

**SFX:** one sound per event, and never layered beyond the pairs listed. Nothing plays for walking, running, the camera, lying down or the later pop-ins. Peaks sit around −12 dBFS; the Kenney files peak near −1 dBFS, so drop them about 11 dB.

| Cue | File | Fires on |
|---|---|---|
| page opens | `sfx/kenney_interface/Audio/tick_004.ogg` | `first_paint` of the inbox, review and sheet, the popup card's in point, and again as the CTA appears (the film opens and closes on the same tick) |
| popup clicks | `sfx/kenney_interface/Audio/click_001.ogg` | `shelter_click`, `name_click`, `type_selected`, `color_selected` |
| adopt | `sfx/kenney_interface/Audio/pluck_001.ogg`, about −24 dBFS | `add_mousedown` |
| first pop-in | `sfx/kenney_interface/Audio/pluck_001.ogg`, about −24 dBFS | Rex's pop-in on the inbox (`pets_ready`) only |
| 👋 wave | `sfx/picks/04_wave_blip_toggle_001.ogg` | `src:rex:swipe` |
| click | `sfx/kenney_interface/Audio/click_001.ogg` | the mouseup on Rex |
| heart chime (the signature, used for both hearts) | `sfx/generated/blip_feed_chime.wav` | `heart_on` after the feed, and 60 ms after the catch |
| double-click | `sfx/kenney_interface/Audio/click_001.ogg` twice, 90 ms apart | `mouse:dblclick` |
| ball drop | `sfx/picks/01_ball_throw_drop_003.ogg` | `ball_in_frame`, the first frame the ball is inside the crop (at 1.0x the `ball_on` frame, since the whole viewport is on screen) |
| floor bounce | `sfx/picks/01b_ball_bounce_impactSoft_medium_000.ogg`, 3 dB quieter each time | each `ball_floor` before the catch |
| catch | `sfx/picks/02_catch_pop_bong_001.ogg`, then the heart chime 60 ms later | `catch` |
| greet | `sfx/picks/04_wave_blip_toggle_001.ogg` twice, the second at playback rate 1.12, 80 ms later | `greet_start` |
| clock | `sfx/kenney_interface/Audio/tick_001.ogg` | the clock showing :58 and :59 |
| lights out | `sfx/kenney_interface/Audio/switch_002.ogg` (alternate `sfx/picks/05_night_tone_minimize_006.ogg`) | `sleep`, the first frame with every visible pet on the lie sprite |

## Beat table, 16:9 master

Nominal times at 25 fps, computed from the action scripts with the sim's median catch (1.12 s after the double-click). Real in and out points come from the anchors.

| # | t0-t1 (s) | On-screen text | Pets | Page | Camera | Audio | Anchors |
|---|---|---|---|---|---|---|---|
| 1 | 0.00-3.61 | "there's a dog in my inbox." (`pets_ready`+240 to +2040), then the name tag alone (+2140 to `src:rex:swipe`) | Rex pops in at x 700 at 0.16 s and idles. His first move is a walk to the left, 2.0-2.6 s after `pets_ready` (a hard accept rule). | inbox, first painted frame, no pet yet | 1.0x on the whole window. From `src:rex:walk`, a 450 ms push to 2.0x on Rex, then it follows his walk. | quiet bed from frame 0; tick on first paint; soft pluck on the pop-in | In: `pets_ready` − 160 ms (4 frames of empty inbox). The cursor departs at `pets_ready` + 2600. |
| 2 | 3.61-7.21 | "hover: he waves." (`src:rex:swipe` to `heart_on` − 100), then "click: a treat." (`heart_on` to +1700) | The cursor drops onto the hover point: swipe plus 👋, and the state machine freezes. After a 1.6 s hover, the click: 🍖 and ❤️ rise. The cursor leaves within 100 ms, so the eat state shows the idle sprite under the particles. | inbox | hold 2.0x on Rex | bed up on 👋; wave blip; click; heart chime | Out: `heart_on` + 1900. |
| 3 | 7.21-11.13 | "double-click: a ball." (`mouse:dblclick` to `catch`), then "good boy." (`catch` to +1600) | Rex (x 520) runs to the ball, waits under it on the idle sprite, and catches it: ❤️, the ball vanishes, then idle. Bao is in the roster but hidden. | review, dark theme; the double-click lands in the empty zone at (800, 306) | 1.0x through the double-click. From `ball_on` + 400 until the first floor contact or the catch, a push to 2.0x centred on the catch point, keeping the ball in frame. Hold 2.0x. | tick; double-click; drop on `ball_in_frame`; a bounce per floor contact before the catch; pop plus heart chime | In: `first_paint` (dark from the first frame). The double-click lands at `pets_ready` + 650. Out: `catch` + 2000. |
| 4 | 11.13-14.02 | "adopt: pick one. name her." from `popup_ready` + 280 to `add_mousedown` + 160, beside the card in 16:9 and below it in 9:16, in its fixed caption rect | Rex and Bao in the pet list; the chicken, crab, panda and snail cells in the shelter | **popup** (section 5): three crops of one take in a card hanging from the pinned toolbar icon, over the dimmed review still with the chrome on screen. **A** (0.70 s): the cursor clicks Visit Shelter at `popup_ready` + 600. **B** (1.50 s): it glides to the Name field and clicks 24 px inside its left edge (inside crop B), types "Pip" (100 ms a key) and clicks the chicken, which gets the selected ring. **C** (0.69 s): it clicks the white swatch, then presses Add Pet. | The card pops in over 200 ms (scale 0.94, 24 px low, at full opacity). Between crops its frame morphs over 160 ms while the content hard-cuts to the next crop and scales uniformly to fit inside it, centred on the popup's own cream (never stretched, never a mask over a wider region). The card's top edge sits 8 px below the toolbar (y 164) and its left edge at the icon's centre x, clamped 40 px inside the frame's right edge and to the frame bottom, on even pixels (16:9: A and C at x 880, B at (1250, 146)). In 16:9 the caption sits to its left, in a fixed rect at x 160-720, y 380-700 (crop B is 934 px tall at 2x, so a caption below it cannot fit). A and C are shown at 1x native, B at 2x. | tick on the card; a click on each control; a soft pluck (about −24 dBFS) on the Add Pet press; the bed continues | In: `popup_ready` + 200. A out: `shelter_click` + 300. B out: `type_selected` + 500. Out: `add_mousedown` + 160, a hard cut to the sheet: the pressed Add Pet is on screen for 2-3 frames, and the mouseup follows at + 240. |
| 5 | 14.02-17.12 | "pip says hi." (`pets_ready` + 150 to +1350), then "and now there are three." (+1450 to +2850) | Rex (x 340) and Pip (x 399), 59 px apart, pop in and greet on the first frame: both play swipe for 1 s, standing still. Bao (x 460) pops in 61 px from Pip and does not greet. All three stay on idle until the out point. | sheet | 1.0x on the whole sheet, then from `pets_ready` + 400 a 450 ms push to 2.0x centred between Rex and Bao, which frames all three. Hold. | tick; the greet's two blips | In: `first_paint` (no white pre-paint frames). Out: `pets_ready` + 2950. |
| 6 | 17.12-21.38 | Clock "21:59:58" from the in point, ":59" at `pets_ready` + 700, "22:00:00" on the sleep frame. "lights out at 10. up at 6." (`sleep` + 200 to +2200) | Rex (x 560), Pip (x 480) and Bao (x 400) pop in awake, 80 px apart, so nobody greets. When the hour flips, all three switch to lie on the next frame and stay down. | article in its own dark theme | 1.0x hold. From `sleep` + 400, a slow 3.0 s push to 2.0x between Rex and Bao. At 2.0x only the dark background shows above the pets. | tick, tick, switch; the music stops on the switch | In: `first_paint`. Trigger: set the hour at `pets_ready` + 1700, inside the 2 s spawn window, while all three are still idle. |
| 7 | 21.38-23.38 | "They're not much, but they're yours." from `sleep` + 2400, and it stays up | all three asleep | same live page | the push ends at `sleep` + 3400; hold 2.0x | room tone | Anchor: `sleep` + 2400. |
| 8 | 23.38-27.78 | Under the brand line from `sleep` + 4400: icon and "Pixel Pets", "add to Chrome. it's free.", "collects no data · 14 kinds of pet", and the two credit lines | all three asleep | same live page, untouched. No end card and no fade. | hold 2.0x | tick as the CTA appears, then silence | Hard end at `sleep` + 8800. The CTA is up 4.4 s (was 5.0). |

Beat ids keep their old names so the eval and the beads need no renames. `b1b_not_helping` ("he's not helping.") is cut; the name tag takes its slot. The table's row numbers are for display only. The new beats are `b3c_shelter`, `b3d_pick` and `b3e_add` (shot `s2b_shelter`). The greet is still `b4a_hi` and `b4b_too`, and the night is still `b5_lights_out`, `b6_brand_line` and `b7_cta`.

**Length rule:** nominal 27.8 s (695 frames): beats 1-3 run 11.13 s (b1b's 1.20 s is cut and the hook hold is 2600 ms), then the adoption 2.89 s, the greet 3.10 s, the night 4.26 s, the brand line 2.00 s and the CTA 4.40 s. The 436 px page shortens the ball's fall, so the catch timing is re-measured with the new seeds; a catch on the second landing adds up to 1.5 s, so expect 27.8-29.3 s. The accepted window is 27.3-30.0 s (9:16 27.3-30.5 s). If the anchored cut runs under 27.3 s, extend the final hold by up to 1.0 s. If it runs over 30.0 s, re-run the review take with the next passing seed that catches within 1.3 s.

What the viewer has at each point:
- **Second 3:** a real pixel dog on a real-looking inbox in a browser window, a dry line, the name, and a push-in as he wanders off. No pitch yet.
- **Second 10:** the wave, the treat, the name, and a ball already falling on a second page.
- **Second 15:** a chicken adopted in three clicks and a name.
- **Second 18:** the new chicken saying hi to the same dog on a third page, with a panda beside them.
- **The end:** a dark page, three sleeping pets, the line, and "add to Chrome. it's free." beside the store icon, held 4.4 s.

## 9:16 cut (1080x1920, about 28.0 s)

- **Re-record, never crop.** The same four page shots run at 540x856 CSS px at pixel ratio 2, in a narrow window with the same chrome: the window fills the whole frame, the chrome (`set/chrome/<page>-narrow.png`) at canvas y 0-208 and the native 1080x1712 frames 1:1 at canvas y 208-1920. No cream band. The popup take is the one exception: it does not depend on the page viewport, so the 9:16 reuses it, with the card hanging from the pinned icon by the same rule (top edge at y 164; A and C at x 40, B at x 410; A and C at 1x native, B at 2x), and the caption on two lines ("adopt: pick one." / "name her.") in a fixed rect at x 60-900, y 1224-1460, below the tallest card.
- **Safe zones:** the pets stand on the frame bottom, at canvas y 1792-1920. Captions and overlays stay below the chrome (y 208) and left of canvas x 900, and the right 120 px (canvas x 960 and up) stays clear of pets. **Every 9:16 take keeps its shot's 16:9 accept rules and adds its own: each pet box's right edge stays at or under CSS x 444 (canvas 888) for the whole take, and no pet bounces off a wall before the out point.** Each runs its own seed search.
- **Camera:** holds at 1.0x and 2.0x only, with the crop's bottom on the canvas bottom (y 1920) at every zoom. A 2.0x crop is canvas y 960-1920: narrow-layout CSS y 376-856. The moves match the master: a push to 2.0x on Rex's walk, 2.0x through the hover and treat, the fetch push toward the catch point (same ball-in-frame check and fallback), a push between the pair in the greet, and the night push.
- **Captions:** VT323 80 px, at most 18 characters a line and two lines, on the same pill, inside the page frame. They follow the master's rule (beside the acting pet, else above its particle column), stay left of canvas x 900, and never sit on the chrome.
- **Name tag:** the icon at 64 px and "Pixel Pets" in Press Start 2P 36 px, about 490 px wide with padding, shown alone from the moment the first caption leaves until the wave. v2's "Pixel Pets for Chrome" overflowed the 360 px tag box.
- **Positions and seeds (sim pass rates over 2000 seeds):**
  - inbox: Rex at 380. He walks left, so his right edge never passes 444. 12%.
  - review: Rex at 120, Bao hidden. The narrow layout's empty zone is centred at (300, 500) (v1 point, re-derived for the 856 px page). The catch must come within 2800 ms, because the taller page gives a longer fall, and the ball must be at x 380 or less at the catch. The v1 rate was 44%; every seed is re-searched for the new viewports.
  - sheet: Rex at 200 and Pip at 259, greeting at boot, with Bao at 320. The pass rate with three pets is not simulated yet (two pets: 29%).
  - article: Rex at 250, Pip at 180 and Bao at 110. Any seed.
- **CTA:** the icon at 128 px beside "Pixel Pets" (Press Start 2P 44 px), then "free. link in bio." (VT323 72 px), "for Chrome on your laptop" (VT323 56 px), "collects no data" (VT323 48 px, sage), and the credit on three lines in VT323 28 px sage: "sprites: dog by NVPH Studio (CC BY-ND 4.0)" / "panda by Jessie Ferris, chicken by" / "Gulnur Baimukhambetova (MIT), via vscode-pets". All of it sits inside the page frame, left of x 900 and below the chrome. Phone viewers cannot install an extension on the phone, so the lines tell them where to look and what to use it on. The bio link must be set before posting.
- **Brand line:** "They're not much, / but they're yours." in VT323 80 px, cream.
- **Audio:** the same music and SFX map, retimed from the new logs.

## README GIF (960x360, about 8.6 s, loops, under 5 MB)

- **Content:** two scenes with no zoom. The frames are the 16:9 captures halved with nearest-neighbour, so every sprite pixel keeps a colour from its source GIF. The cursor is drawn, and captions are baked in VT323 at 32 px on the cream pill, top left of the band.
  - **Scene A (inbox):** from `cursor_depart` − 800 ms to `heart_on` + 1500 ms, about 4.9 s, with "hover: he waves." and "click: a treat."
  - **Scene B (review):** from `pets_ready` to `catch` + 2000 ms, about 3.8 s, with "double-click: a ball." and "good boy." Only Rex is on the page, and the dark theme keeps the ball visible.
- **Crop band:** CSS y 76-436 on both takes.
- **Encode:** 12.5 fps (8 cs per frame, exact), one 256-colour palette per scene (`palettegen stats_mode=diff` plus every rostered pet's exact sprite colours reserved; one palette over the light and dark scenes starved the dark one), `paletteuse=dither=none`, `loop=0`, no audio.
- **Colour check:** every opaque Rex pixel must be within 8 RGB units of a colour in his source GIF frame. Otherwise the encode fails.
- **Loop:** a hard cut from Rex sitting after the catch back to the inbox before the cursor arrives.
- **Credit under the GIF, in the README:** "Dog sprites: NVPH Studio (CC BY-ND 4.0), via vscode-pets by Anthony Shaw. Full credits below."

## Thumbnail and poster frames

- **YouTube thumbnail:** a 1280x720 PNG cut 1:1 from the master at `src:rex:swipe` + 600 ms, the 2.0x hover hold with the swipe pose and 👋, with captions switched off. The store icon and "Pixel Pets" (Press Start 2P) sit beside Rex, at least 80 px from his box and never on him. The alternate is the 2.0x catch frame at `catch` + 100 ms, with the ❤️. Uploading a custom thumbnail needs a verified YouTube account.
- **X:** pick the same frame as the poster in X's media editor if it offers one. If not, render the X file from `pets_ready`, dropping the 4 empty-inbox frames, so the first frame already has Rex in it.
