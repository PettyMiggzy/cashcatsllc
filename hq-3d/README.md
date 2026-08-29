# CashCats HQ — 3D

A holder-gated 3D walkable world for the `$CASHCATSLLC` community — forked
from [Hyperfy](https://github.com/hyperfy-xyz/hyperfy) (GPL-3.0-only),
pinned at commit `5d20037` (v0.16.0). Do not merge upstream mid-build —
Hyperfy is alpha and its APIs move; treat any upgrade as its own task
after launch.

Status: **phase 01** — vanilla fork imported, not yet reskinned. Deploy
this as-is and confirm it runs (desktop + a real phone) before anything
else changes — that's the rollback point.

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
2. **The rig is the real risk, not the code.** Hyperfy avatars are VRM
   only, and VRM is a humanoid spec (21 required bones) — there's no
   quadruped path. A four-legged cat means skinning it to a humanoid
   skeleton laid out horizontally (front paws on the arm bones), the
   "feral rig" trick VRChat quadrupeds use. Prototype this **before**
   building any world — if it reads as a person on all fours instead of
   a cat, the fallback is standing the cat up (native VRM + free Mixamo
   animations, no rig tricks needed).
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

Rig + gaits, world building, room wiring (swap terminal / chart / rewards
wall / meme vault), holder gate, mobile perf pass, branding, deploy. Each
lands as its own commit, same pattern as `hq/`.
