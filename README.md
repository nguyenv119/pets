# Pixel Pets

Tiny pixel companions that live in your browser. They walk, sleep, chase balls, greet each other, react to your cursor, and hang out on every page you visit.
https://chromewebstore.google.com/detail/pixel-pets/mgamneidfkkigbniedjohbglcmecjffg?hl=en&authuser=0


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

- **Ball chase** — every pet nearby runs toward it. The first pet to physically contact the ball catches it
- **Hover wave** — `mouseenter` on a pet freezes waves at you!
- **Pet-to-pet greet** — when two pets walk nearby each other (30s cooldown) they wave
- **Treats inventory** — each feed costs one treat. Cap is 10; you regenerate +1 every 10 minutes!
- **Sleep cycle** — between **22:00 and 06:00** local time, idle / walking pets are forced into the sleep state
- **Special pages** — Chrome blocks content scripts on `chrome://`, `view-source:`. Popup notifies you
- **Per-tab rendering, cross-tab state** — each tab renders its own pets layer above the page.

## Asset attribution

Sprite gifs for **chicken, cockatiel, crab, dog, fox, horse, monkey, panda, rat, snail, snake, totoro, turtle** (including all idle / walk / run / swipe / with_ball / lie variants) are from [tonybaloney/vscode-pets](https://github.com/tonybaloney/vscode-pets), licensed under **CC BY-ND 4.0**. Used verbatim — no modifications — with attribution.

Miffy sprites are original.

## License

MIT — see [LICENSE](LICENSE). Asset license (CC BY-ND 4.0) governs the vscode-pets gifs separately; see [Asset attribution](#asset-attribution).

---

*They're not much, but they're yours.*
