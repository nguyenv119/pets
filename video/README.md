# video/

Promo-video pipeline for Pixel Pets (epic pets-o3p). A self-contained npm
project: `cd video && npm ci` installs its own dependencies (Playwright,
Remotion) separately from the extension's `npm ci` at the repo root.

This is a stub. pets-o3p.5 completes this README with the full pipeline
walkthrough.

## Freeze rule

From this bead's commit on, the following files are the shared contract
between pets-o3p.2, .3, .4 and .5. Every later bead only ADDS files; none of
them may edit these:

- `package.json`
- `shots.json`
- `src/schema.ts`
- `src/anchors.ts`
- `src/species.node.ts`
- `lib/browser.mjs`

A needed change to any of these becomes a follow-up bead, never an edit
inside another bead's work, whether the chain is stacked or run in parallel.
