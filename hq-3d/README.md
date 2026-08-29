# CashCats HQ — 3D

A holder-gated 3D walkable world for the `$CASHCATSLLC` community — forked
from [Hyperfy](https://github.com/hyperfy-xyz/hyperfy) (GPL-3.0-only),
pinned at commit `5d20037` (v0.16.0). Do not merge upstream mid-build —
Hyperfy is alpha and its APIs move; treat any upgrade as its own task
after launch.

Status: **phase 02 done (rig spike resolved)** — the default avatar is
now a real cat, verified walking in the running engine. See "The avatar"
below for what shipped and why. Phase 01's vanilla-fork deploy is still
the rollback point if anything below needs undoing.

## Why this over the 2D SkyOffice build

`hq/` (2D, SkyOffice-based) has real working progress — phases 01–03 are
done. This is a deliberate pivot to 3D, not a mistake left behind: `hq/`
stays in git history untouched in case it's ever picked back up, but
active development moves here.

## Stack

- **Everything** — Fastify server + Node client in one process (no
  Vercel/droplet split like the 2D plan). three.js 0.173 + PhysX for
  rendering/physics, `@pixiv/three-vrm` for avatars, better-sqlite3 for
  persistence (world content lives in the `world/` SQLite DB, not in
  this repo — see `.gitignore`).
- Runs as a single long-lived process on the droplet via pm2, same as
  `scripts/cashcats-bot.mjs` in the repo root.

## Before running anything

1. **Node 22.11.0 exactly** — pinned in `package.json` `engines` and
   `.nvmrc`. `better-sqlite3` is a native module; a different Node ABI
   will fail to build or fail at runtime. `nvm use`.
2. **The rig risk is resolved — we took the escape hatch.** True
   quadruped "feral rigging" (skinning a four-legged mesh onto a
   horizontal humanoid skeleton) needs Blender and real 3D-modeling
   skill neither of us has readily available. So instead: a genuine
   bipedal cat-person VRM — cat ears, whiskers, humanoid body — which
   needs **zero custom rigging** because it's already a standard VRM
   humanoid; it inherits all 14 stock locomotion/emote clips for free.
   Verified walking in the actual running engine, not just a screenshot.
3. **Licensing**: the code is GPL-3.0-only. Because this ships a client
   bundle to every visitor's browser, the safe reading is that counts as
   distribution — our fork's source needs to be public. `cashcatsllc` is
   already a public repo, so this isn't a new constraint for us. Our own
   purchased/licensed art (if we ever use any) must NOT be committed —
   load it via `ASSETS_BASE_URL` in `.env`, same discipline as `hq/`'s
   `ASSETS.md`. The default assets shipped by Hyperfy itself
   (`avatar.vrm`, the `mp-*`/`emote-*` clips) carry no separate
   attribution notice anywhere in the upstream repo, so they're covered
   by the same GPL-3.0 as the code — fine to keep as the vanilla
   baseline until they're replaced with our cat.

## The avatar

`src/world/assets/avatar.vrm` is **WeirdCat**, avatar #227 from the
[100Avatars](https://github.com/PolygonalMind/100avatars) R3 series
(Polygonal Mind), sourced via [ToxSam's Open Source Avatars
registry](https://github.com/ToxSam/open-source-avatars). **CC0** — no
attribution required, but noted here for provenance. It replaces
Hyperfy's stock robot avatar; since the world's `avatar` setting is
unset, the code's own fallback chain (`sessionAvatar || avatar ||
asset://avatar.vrm`) already routes every anonymous visitor to it — no
extra config needed.

Not custom art, not colored to match the real CashCats cat — it's a
placeholder that actually works, in the same spirit as the 2D build's
free sprite pack. A branded cat (matching the PFP studio's look, or the
real photo) is real v2 work, same "ship cheap, upgrade once it has
users" logic as everywhere else in this project. At 6.4MB it's also
above Hyperfy's own "Perfect avatar" budget (≤5MB) — worth a texture
pass before this goes to real users on phones.

## Local dev

```
nvm use            # reads .nvmrc → 22.11.0
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. `ADMIN_CODE` is blank by default in
`.env.example` — meaning **everyone who joins is an admin**. Must be set
before any link is public.

## Not yet done

World building, room wiring (swap terminal / chart / rewards wall / meme
vault), holder gate, mobile perf pass (avatar is 6.4MB, over budget —
see "The avatar"), branding, deploy, `ADMIN_CODE`. Each lands as its own
commit, same pattern as `hq/`.
