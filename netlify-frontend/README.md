# BLACKMAMER STUDIO — Netlify frontend V2

This directory contains a standalone frontend at `index.html`. The original live Netlify site is not modified simply by committing these files.

To publish through Netlify Git, use repo `sauqihaq/blackmamer-obfuscate`, branch `main`, **Publish directory** `netlify-frontend`, blank build command, blank base directory.

The frontend uses `https://blackmamer-obfuscate.onrender.com/api/obfuscate`, and supports `RobloxStrong` and `hybrid-v2`. The backend's VM V2 is experimental. Test generated Luau inside Roblox Studio.

Run `node tests/frontend-smoke.js` from the repository root to validate the frontend JavaScript and payload.
