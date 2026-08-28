# CashCats HQ

A holder-gated 2D multiplayer walkable world for the `$CASHCATSLLC` community —
forked from [SkyOffice](https://github.com/kevinshen56714/SkyOffice) (MIT).

Status: **phase 01** — vanilla fork imported, not yet reskinned. This is the
rollback point: deploy this as-is and confirm it runs (desktop + a real phone)
before anything else changes.

## Stack

- **Client** — Phaser 3.55 + React 18 + Redux Toolkit + MUI 5, built with Vite.
  Deploys as a static build (same target as the rest of cashcatllc.help).
- **Server** — Colyseus 0.14 (pinned — do not upgrade, see below) + Express.
  Runs as a long-lived process on your DigitalOcean droplet via pm2, same as
  `scripts/cashcats-bot.mjs` and `scripts/announce-bot.mjs` in the repo root.
  Cannot run on Vercel — it's a stateful websocket server, not a request/response
  function.

## Before running anything

1. **Node 18.** These are 2021-era dependencies with native modules; Node 22+
   will likely fail the build. Use `nvm use 18`.
2. **Assets.** Read `ASSETS.md` first — the world's art is not in this repo on
   purpose (licensing), so it won't render until you drop the purchased files
   in place.
3. **Do not upgrade `colyseus` / `colyseus.js` past 0.14.x**, and don't upgrade
   Phaser either. Current upstream Colyseus is 0.16 — three majors ahead, with
   breaking schema/room-lifecycle changes. Treat that as its own future task.

## Changes already made vs. upstream SkyOffice

- `bcrypt` → `bcryptjs` (root `package.json` + `server/rooms/SkyOffice.ts`) —
  native module most likely to break the droplet build; drop-in API swap.
- `package.json` `license` field corrected from `ISC` to `MIT` to match the
  actual `LICENSE` file (upstream had a discrepancy between the two).
- All art assets excluded — see `ASSETS.md`.
- Not yet done: WebRTC/video-chat removal, rebrand, cat sprites, holder gate,
  map rebuild, mobile touch controls. Each lands as its own commit.

## Local dev

```
nvm use 18
yarn install          # root — server deps
cd types && yarn && cd ..
cd server && yarn && cd ..
cd client && yarn install
```

Server: `yarn start` (root) — Colyseus on `:2567`.
Client: `cd client && yarn dev` — Vite on `:5173`, reads `VITE_SERVER_URL`.
