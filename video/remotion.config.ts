// remotion.config.ts: Remotion Studio / CLI settings only (epic pets-o3p,
// bead pets-o3p.4). The render path (scripts/render.mjs) goes through the
// Node API, which never reads this file, and passes the same options to
// renderMedia / renderStill itself. Keep the two in step.

import { Config } from '@remotion/cli/config';

Config.setEntryPoint('src/remotion/index.ts');
// Media is staged here by render.mjs (OffthreadVideo cannot read outside the public dir).
Config.setPublicDir('.cache/public');
Config.setVideoImageFormat('png');
Config.setCrf(16);
// Measured on the 16 GB Mac (bead "Proven facts"): angle renders 2x faster than the default, 5x with motion blur.
Config.setChromiumOpenGlRenderer('angle');
Config.setConcurrency(2);
