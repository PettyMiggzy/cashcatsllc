# World of CashCats

A holder-gated 3D walkable world for the `$CASHCATSLLC` community on
**Robinhood Chain** — forked
from [Hyperfy](https://github.com/hyperfy-xyz/hyperfy) (GPL-3.0-only),
pinned at commit `5d20037` (v0.16.0). Do not merge upstream mid-build —
Hyperfy is alpha and its APIs move; treat any upgrade as its own task
after launch.

Status: **the world is built** — a campus of four rooms joined by a plaza,
with the holder gate enforced on the server. Phase 01's vanilla-fork deploy
is still the rollback point if anything below needs undoing.

```
        The Vault  [0,0,32]     10,000,000 holders, behind the gate
              |  gate at z 24.5
        ---- the plaza ----     spawn at [0,0,17]
      /             |            \
 Homestead      Filing Office     Workshop
 [-22,0,0]        [0,0,0]        [21,0,0]
```

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
attribution required, but noted here for provenance, and CC0 is what
makes the repaint below allowed.

**It is repainted into the Cash Cat.** `roomsrc/recolor_avatar.py` rewrites
the albedo so the fur matches the real cream cat on cashcatllc.help, the
vest becomes CashCats green, and the huge cyan eye discs become amber.
Geometry, rig, UVs and the other two textures are untouched — the script
splices a single replacement PNG back into the GLB and shifts the later
bufferView offsets, so all 14 stock locomotion clips still work.

Three things about that script are worth knowing before editing it:

- Fur is separated from the leather **by hue**, not saturation — fur sits
  at hue ~0 and the leather at ~30. The model's dark facial marking is
  hue ~0 at saturation ~0.5, so a saturation-based mask leaves it black
  while the rest of the head goes cream.
- The fur mask is a **soft weight**, not a binary one. A hard cutoff bands
  visibly through the gradient around that marking.
- The head island is atlas `x 0-560, y 1360-2048`, confirmed by packing a
  colour-grid atlas and rendering it to see which cell landed on the
  muzzle. It gets a stronger value lift than the body, or the cat reads
  grey-faced.

### Bringing in a character from anywhere

`roomsrc/glb2vrm.py` is the last mile of the character pipeline. Every AI
character service worth using — Tripo, Meshy, Mixamo before them — hands you
a rigged GLB or FBX with a conventional skeleton. None of them emit the VRM
humanoid extension, and that extension is the only thing Hyperfy reads in
order to retarget its fourteen stock clips.

```
python3 roomsrc/glb2vrm.py in.glb out.vrm --name "Pop Cat"
python3 roomsrc/glb2vrm.py in.glb out.vrm --faces=-z    # already VRM-facing
```

Bone names are matched against the conventions those tools actually emit —
Mixamo (`Hips`, `LeftUpLeg`, `LeftArm`), VRoid (`J_Bip_L_UpperArm`), Unreal
(`upperarm_l`) and plain snake/camel case — so nothing normally needs
renaming. Anything it cannot place is listed rather than guessed at, and it
refuses a mesh with no skin instead of writing a broken avatar.

Verified by stripping the VRM extension off the working avatar to make a
plain rigged glb, then converting it back: 22 bones mapped, and the result
loads, poses arms down and walks. **One open caveat** — the round-tripped
file reports a height of 1.22m where the original reports 1.68m, so the
scale needs pinning down before this is trusted in production.

`--faces` matters more than it looks: VRM 0.0 models face −Z and most rigged
exports face +Z, so the default adds a 180° root rotation. Skip it and left
and right mirror, which makes Hyperfy's hard-coded arms-down pose lift both
arms into the air instead.

### Generating a rig from scratch

`roomsrc/mkavatar.py` builds a complete rigged VRM with no external service:
a skinned mesh on a 26-bone VRM humanoid skeleton, weighted by
nearest-bone-segment, written straight to GLB.

```
python3 roomsrc/mkavatar.py roomsrc/cashcat_avatar.vrm
```

It works — it loads, skins, walks, and drives all fourteen stock clips. Two
things are worth writing down because neither is guessable:

- **VRM 0.0 avatars face −Z, so the character's left is −X.** Authoring it
  facing +Z mirrors left and right, and `createVRMFactory` poses the arms
  down at load with a hard-coded `leftUpperArm.rotation.z = +75°`. Mirrored,
  that same rotation lifts *both* arms into the air and no clip ever
  corrects it. The fix is a 180° Y rotation of the mesh and skeleton, plus
  reversing triangle winding.
- **The world's avatar is content-addressed** through `settings.avatar`, so
  overwriting `avatar.vrm` changes nothing until `install_brand.py` re-hashes
  it. Easy to spend a while testing a file the world is not loading.

**It is not what ships.** The generated body is a smooth featureless figure —
no face, no clothing — and the repainted WeirdCat below is plainly better. The
generator is kept because it is the working half of the problem: if the shapes
improve, or someone supplies proper cat meshes, the rigging and export are
solved.

It is still a repaint of someone else's mesh, not our own cat: the
proportions are a bipedal cartoon cat, not the real photo. A purpose-built
VRM is real v2 work. At 6.0MB it also remains above Hyperfy's "Perfect
avatar" budget (5MB) — worth a texture pass before this reaches phones.

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
python3 roomsrc/install_homestead.py  # The Homestead      -> [-22,0,0]
python3 roomsrc/install_vault.py      # The Vault          -> [0,0,32]
python3 roomsrc/install_campus.py     # plaza, signs, gate, and the spawn
python3 roomsrc/install_brand.py      # world title, share image, avatar
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

**The cast**: Cash Cat, Long Cat, Serious Cat, Apple Cat and Pop Cat. The
cat is who you are, the class is what you do, and both are picked rather
than rolled. Each cat carries one signature trait that genuinely changes
the numbers — Cash Cat pays double every fifth shift, Long Cat wears gear
6 per shift instead of 8, Serious Cat repairs for 20% less, Apple Cat
dismantles for half again as much, Pop Cat upgrades for one part less. All
deterministic, so the no-RNG rule survives contact with the roster.

They stand on the plaza as **sculpted meshes**, built by
`roomsrc/mkcats.py` and shipped as `roomsrc/cats.glb`:

```
python3 roomsrc/mkcats.py roomsrc/cats.glb
```

Each cat is described as a set of ellipsoid signed-distance fields — body,
head, muzzle, ears, legs, tail — combined with an exponential smooth
minimum and pulled out as one surface with marching cubes. The result is a
single continuous body rather than a pile of visible spheres, which is what
assembling primitives always looks like. `app.get('cat_pop')` reaches the
node, so the campus places all five along the plaza and the workshop
positions them on one plinth and toggles which is active.

Three things that decide whether it reads as a cat:

- **The union constant is the whole game.** Larger k is a *tighter* union.
  Summing exponentials across many overlapping parts inflates the surface
  the way metaballs do, so a soft k melts the head into the shoulders and
  swallows the legs entirely. 26 keeps the parts legible while still fusing
  them; 11 produced a featureless blob.
- **Metaballs size deceptively.** The first attempt used a Wyvill falloff,
  where a lone blob's iso-surface sits at only ~0.45 of its stated radius.
  Everything came out spindly and the tail broke into beads. An SDF means a
  radius means what it says.
- **`step` is the quality/weight dial.** 0.023 gives ~195k triangles across
  the five and a 4.7MB glb. 0.016 is marginally crisper for twice the
  weight, which is the wrong trade for something usually seen from several
  metres away in a browser.

Venice has no part in this: 338 models across text, image, video, music,
embedding, tts, upscale, inpaint and asr, and not one mesh generator. The
geometry is generated locally with numpy and scikit-image.

Their generated portraits (prompts in `roomsrc/cast/prompts/`) are still
used on the roster board, where a picture is the right thing. **The player
avatar is still the one repainted cat** — choosing Long Cat changes your
stats, your portrait and the statue, not your body. Five rigged VRMs is
real modelling work.

**Classes**: each cat is a Warrior, Archer, Elemental or Assassin, picked
at a board and never rolled. Class sets the base HP/ATK/SPD spread and
decides which stat Equipment Rating feeds; Cosmetic Rating, being
account-wide, spreads across all three. Three skills per class unlock at
levels 1 / 4 / 8, so the level gate that caps the ratings also paces the
abilities. Every skill effect is deterministic — "every 3rd hit", "below
25% HP" — so the no-RNG rule holds in combat, not just at the workbench.

**The Homestead** (`roomsrc/homestead.js`) — the housing and farming loop,
now built rather than stubbed. Buy a plot (three sizes, priced up front),
raise a house on it, and work the farm. Beds set the harvest, produce mills
into timber, and both the house and the farm wear out every harvest exactly
like equipment does. Spare produce buys the temporary stat boosts the dev
described.

One thing that needed adding: the yard sells timber for tokens. Without it
the loop deadlocks — harvesting needs a house, the house needs timber, and
timber only comes from produce. It doubles as another sink, which is the
direction the dev wanted anyway.

**The Vault** (`roomsrc/vault.js`) — the 10,000,000 room, in black and gold,
and deliberately the only space with nothing to grind in it. It states what
the tier does and does not carry: a seat at the table and early access, but
no stat advantage, because holding is not playing.

### One thing to flag before this ships

Under the spec as written, Cosmetic Rating gives stat boosts and comes
*only* from tokens spent or NFTs held. A player who spends nothing has a
Cosmetic Rating of zero, and the level cap does not change that — it caps
the top, it does not give free players a floor. That is buy-for-power in
PvE, which may be entirely fine; it becomes a real problem the moment
there is PvP or a competitive leaderboard. Worth a decision, not a
silent assumption. The room is built to spec regardless.

Every room is built entirely from `prim`/`ui`/`image` nodes — no GLB, no
purchased tileset, nothing licensed to keep out of the repo.

## Materials

The first pass was flat-coloured boxes and looked like programmer art. The
surfaces are now textured with materials generated through Venice
(`roomsrc/tex/`, prompts kept alongside in `tex/prompts/`), plus a
golden-hour sky panorama.

Three things about that are not obvious:

- **`prim` has no texture repeat.** A texture stretches across UV 0..1 of
  each face, so one 1k tile over a 64m plaza is absurd. The tiling is baked
  into the images by `roomsrc/tile.py`, which also mirrors each source into
  a 2x2 block so it repeats without a seam. Mirroring costs some symmetry —
  fine for stone and plaster, wrong for anything with lettering.
- **The sky is what lights the world.** With no light nodes, everything is
  lit from `scene.environment`, which needs a real `.hdr` and not a PNG.
  `roomsrc/mkhdr.py` converts the LDR panorama to Radiance RGBE, de-gamma'd
  to linear with the highlights pushed above 1.0 so the sky behaves like a
  light source. Swapping the cold default sky for a warm one did more for
  how the place looks than any single texture.
- **`prim` sizes are per-shape, not x/y/z.** `sphere` is `[radius]`,
  `cylinder` is `[radiusTop, radiusBtm, height]`, `cone` is
  `[radius, height]`. Writing a cylinder as `[0.13, 4.0, 0.13]` expecting
  x/y/z gives a four-metre-radius disc, which is exactly what the gate
  railings were until this was caught.

### Two engine gotchas worth remembering

- **There are no light nodes.** Lighting comes only from the sky, so a
  sealed room renders pitch black. Both rooms use an open beam roof plus
  emissive strip lights.
- **`ui` text does not honour `\n`** — it soft-wraps and collapses
  embedded newlines — and the app sandbox has no `Intl`, so
  `toLocaleString` returns unseparated digits. Multi-line copy is one
  node per line, and numbers go through a hand-rolled `commas()`.

## The holder gate

100,000 `$CASHCATSLLC` to enter, 10,000,000 for The Vault, and the check
happens **on the server, at join, against the chain**. A hidden door is not
a gate: anyone can walk through a door the server already let them past,
and anyone can edit a client.

```
GET  /api/gate/nonce    single-use nonce, 5 minute TTL
     holder signs it with their wallet (EIP-191 personal_sign)
POST /api/gate/verify   recover the signer, confirm it matches the claimed
                        address, read balanceOf, mint a 12h JWT pass
     ws /ws?pass=...    checked in ServerNetwork.onConnection, before a
                        player entity exists at all
```

The signature step is the point. Without it anyone could type in a whale's
address and walk in. `/gate` serves a standalone wallet page — deliberately
not part of the React client, so the world bundle carries no wallet code
and a wallet is only ever touched on one screen. It asks for a signature,
never a transaction.

The Vault is a room in the same world, so `ServerVaultGuard` watches its
volume server-side and teleports anyone below the vip tier back out. Client
positions can be lied about, but lying only moves you somewhere the server
then reads and corrects.

Verified against the obvious attacks — spoofing another address, forging a
signature, replaying a spent nonce, and presenting a made-up pass on the
websocket are each refused.

**The gate is off unless `GATE_ENABLED=1`**, so a misconfigured deploy fails
open to a world people can enter rather than one nobody can. Turn it on in
production, and do not leave `JWT_SECRET` at its default — it signs the
passes.

## Not yet done

Deploy, and a mobile perf pass (the avatar is 6.0MB, over Hyperfy's 5MB
budget — see "The avatar"). `ADMIN_CODE` is set locally in `.env`; it must
be set on the droplet too, because blank means every visitor is an admin.
