# Pixel Pets

Tiny pixel companions that live in your browser. They walk, sleep, chase balls, greet each other, react to your cursor, and hang out on every page you visit.

<p>
  <img width="350" alt="Popup with pets" src="https://github.com/user-attachments/assets/e881f627-af54-4b0f-a694-6b890623b766" />
  <img width="350" alt="Popup with form" src="https://github.com/user-attachments/assets/4751ce06-46ad-43cb-8a3e-b1535c6271ab" />
</p>

<img width="700" alt="Pets on a webpage" src="https://github.com/user-attachments/assets/57ce7d23-6f53-405f-bf77-8506a7a640e3" />
<img width="700" height="400" alt="image" src="https://github.com/user-attachments/assets/715f5198-b4cb-4eb2-97a3-cabdde314cf9" />


## Currently housing

14 species, 31 color variants.

| Pet | Colors |
|-----|--------|
| Chicken | brown, white |
| Cockatiel | brown, gray |
| Crab | red |
| Dog | akita, black, brown, red, white |
| Fox | red, white |
| Horse | black, brown, white, magical, warrior, paint_beige, paint_black, paint_brown, socks_beige, socks_black, socks_brown |
| Miffy | white |
| Monkey | gray |
| Panda | black, brown |
| Rat | brown, gray, white |
| Snail | brown |
| Snake | green |
| Totoro | gray |
| Turtle | green, orange |

## Install

1. Clone this repo
2. `npm install && node build.mjs`
3. Open `chrome://extensions`, enable Developer mode
4. Click "Load unpacked" and select the `dist/` folder
5. Your first pet (Rex the brown dog) appears automatically on the first page you visit

## Controls

| Action | How |
|--------|-----|
| Open shelter | Click **Visit Shelter** in the popup — the add-pet form expands; chevron rotates to signal state |
| Add a pet | Pick a species from the sprite grid, then a color swatch, then **Add Pet** |
| Reorder pets | Drag a pet card up or down in the list — order persists to storage and syncs across tabs |
| Throw a ball | Double-click any page, or use the 🎾 button in the popup header |
| Feed a pet | Click on a pet — consumes one 🍖 treat, drops a 🍖 + ❤️, and the pet plays its eat animation |
| Wave at a pet | Hover the cursor over a pet — it freezes, plays its swipe gif, and a 👋 floats up |
| Hide one pet | 👁 button on a pet card; the pet vanishes from the page but stays in the roster (🙈 when hidden) |
| Hide all pets | 👁 button in the popup header — global toggle, separate from per-pet hide |
| Toggle dark mode | 🌙 / ☀ button in the popup header — persists across sessions |
| Remove a pet | Hit the **×** on their card — a 5-second toast lets you undo before the removal is committed |

## Interactions in detail

- **Ball chase** — every pet within 600px of the ball runs toward it at chase speed. The first pet to physically contact the ball catches it, gets a single ❤️, and holds it (with-ball gif). Every other chaser stops and returns to idle.
- **Hover wave** — `mouseenter` on a pet freezes its FSM and swaps its sprite to the swipe gif; a 👋 emoji floats up once per enter (capped). `mouseleave` resumes movement.
- **Pet-to-pet greet** — when two pets with a swipe animation walk within 60px of each other (and both are idle / walking, not chasing or sleeping), both play their swipe gif for a second. Each pair has a 30-second cooldown so the greeting feels intentional, not constant.
- **Treats inventory** — each feed costs one treat. Cap is 10; you regenerate +1 every 10 minutes via on-demand math (no background timer needed). The popup shows the current count and a countdown to the next treat. At zero, feed clicks are rejected.
- **Sleep cycle** — between **22:00 and 06:00** local time, idle / walking pets are forced into the sleep state and use the `lie` gif (or `idle` fallback for species without a lie animation). Chase / eat / idleWithBall states are exempt so gameplay isn't interrupted. Pets wake at dawn.
- **Special pages** — Chrome blocks content scripts on `chrome://`, `view-source:`, the Web Store, and a few other special pages. The popup probes the active tab and shows a banner + disables the throw-ball button when pets can't run there.
- **Per-tab rendering, cross-tab state** — each tab renders its own pets layer above the page. Roster changes (add / remove / hide / reorder) and treat counts sync across all open tabs via `chrome.storage.onChanged`; pet positions stay independent per tab.

## Tech

- TypeScript + Vite, built to a Manifest V3 Chrome extension
- Content script renders pets into a Shadow-DOM overlay so page CSS can't touch them
- Game loop runs on `requestAnimationFrame` with a finite-state machine per pet (`sitIdle` / `walkLeft` / `walkRight` / `sleep` / `chase` / `idleWithBall` / `eat`) plus ephemeral flags for hover, greeting, and night-forced sleep
- Roster persisted via `chrome.storage.local` under `pixel-pets-v1`; settings (theme, treats, treat timestamp) under `pixel-pets-settings-v1`; per-tab positions under `pixel-pets-positions-v1`
- Service worker is the single writer for treat decrements (in-memory mutex) so concurrent feeds across tabs never lose updates
- Vitest harness — **223 tests across 18 files** covering FSM transitions, particle math, treat recharge, sleep-cycle clock injection, cross-tab reconcile, greet pair selection, drag reorder, toast undo, dark-mode persistence, and the visual type / color pickers

## Asset attribution

Sprite gifs for **chicken, cockatiel, crab, dog, fox, horse, monkey, panda, rat, snail, snake, totoro, turtle** (including all idle / walk / run / swipe / with_ball / lie variants) are from [tonybaloney/vscode-pets](https://github.com/tonybaloney/vscode-pets), licensed under **CC BY-ND 4.0**. Used verbatim — no modifications — with attribution.

Miffy sprites are original.

## License

MIT — see [LICENSE](LICENSE). Asset license (CC BY-ND 4.0) governs the vscode-pets gifs separately; see [Asset attribution](#asset-attribution).

---

*They're not much, but they're yours.*
