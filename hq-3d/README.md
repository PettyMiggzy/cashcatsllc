# CashCats HQ — 3D

A holder-gated 3D walkable world for the `$CASHCATSLLC` community — forked
from [Hyperfy](https://github.com/hyperfy-xyz/hyperfy) (GPL-3.0-only),
pinned at commit `5d20037` (v0.16.0). Do not merge upstream mid-build —
Hyperfy is alpha and its APIs move; treat any upgrade as its own task
after launch.

Status: **phase 04 done** — two rooms are built and walkable: the Filing
Office (staffed, branded, live on-chain rewards readout) and the Workshop
(a playable demo of the game economy). Phase 01's vanilla-fork deploy is
still the rollback point if anything below needs undoing.

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

## The rooms

Both rooms live in `roomsrc/` as plain app scripts and are pushed into
`world/db.sqlite` by their install scripts. `world/` is gitignored, so
the DB is disposable — the scripts are the source of truth. Re-run an
install script and restart the server to apply a change; the running
server caches blueprints at boot and will not pick up an edit on its own.

```
python3 roomsrc/install.py            # The Filing Office  -> [0,0,0]
python3 roomsrc/install_workshop.py   # The Workshop       -> [21,0,0]
```

**The Filing Office** (`roomsrc/filing_office.js`) — reception desk,
filing cabinets, the real `cashcatllc.help` cat on the wall, the contract
address on a plaque, an Article II memo board, a Swap Terminal that opens
the buy link, and a Rewards Wall that reads the rewards balance live with
an `eth_call` `balanceOf` every 60s. Three staff standees are the real
Cash Cat edited into filing clerks (`npc_*.png`).

**The Workshop** (`roomsrc/workshop.js`) — the playable economy, built to
the dev's spec and deliberately provable on screen. Six boards, seven
actions, no hidden state:

- **No RNG anywhere.** `upgradeCost(t) = 3t` parts, fixed and printed
  before you commit; upgrades never fail. Spare loot drops on a counter
  (every third shift), not a roll.
- **No paid odds.** Nothing purchasable touches a probability, because
  there are none.
- **Equipment and buildings wear out — cosmetics never do.** 8 durability
  per shift; repair scales with tier.
- **Four NFT tiers**: Common / Copper / Silver / Gold, every price and
  rating listed on the rack before purchase. Holdings *stack* — Cosmetic
  Rating comes from the number of NFTs held, so owning all four is worth
  all four.
- **Cosmetic Rating is account-wide** (every cat you own gets it, equipped
  or not) and comes only from NFTs held or `$CASHCATSLLC` spent.
  **Equipment Rating is per-cat.** Both are shown on the public PLAYER
  INFO board, and both are **capped by the cat's level** — the board says
  so out loud when you are over the cap ("210 held, level 3 allows 45").
- **Level requirement to wear gear**, so a tier you can afford is not
  automatically a tier you can equip.
- **Nothing is wasted**: spare loot dismantles into scrap, and 5 scrap
  combine into 1 part, so low-grade material always has a route upward.
- **One-way sink.** The burn ledger states plainly that the game has no
  token faucet and never pays `$CASHCATSLLC` out.

A sixth board stubs the housing/farming system rather than faking it —
land, houses, farms yielding resources for boosts, materials and trades,
with buildings wearing out like equipment.

### One thing to flag before this ships

Under the spec as written, Cosmetic Rating gives stat boosts and comes
*only* from tokens spent or NFTs held. A player who spends nothing has a
Cosmetic Rating of zero, and the level cap does not change that — it caps
the top, it does not give free players a floor. That is buy-for-power in
PvE, which may be entirely fine; it becomes a real problem the moment
there is PvP or a competitive leaderboard. Worth a decision, not a
silent assumption. The room is built to spec regardless.

Both rooms are built entirely from `prim`/`ui`/`image` nodes — no GLB, no
purchased tileset, nothing licensed to keep out of the repo.

### Two engine gotchas worth remembering

- **There are no light nodes.** Lighting comes only from the sky, so a
  sealed room renders pitch black. Both rooms use an open beam roof plus
  emissive strip lights.
- **`ui` text does not honour `\n`** — it soft-wraps and collapses
  embedded newlines — and the app sandbox has no `Intl`, so
  `toLocaleString` returns unseparated digits. Multi-line copy is one
  node per line, and numbers go through a hand-rolled `commas()`.

## Not yet done

Holder gate (100k = entry, 10M = VIP — must be enforced server-side on
room join, not just hidden in the client UI), mobile perf pass (avatar is
6.4MB, over budget — see "The avatar"), branding the shell, deploy, and
`ADMIN_CODE`. Each lands as its own commit, same pattern as `hq/`.
