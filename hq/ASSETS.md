# Assets — read this before adding any image here

This repo is **public**. The code in this fork is MIT (see `LICENSE`, © 2021
Kuan-Hsuan Shen, original project https://github.com/kevinshen56714/SkyOffice)
and MIT is fine to redistribute. The *art* SkyOffice shipped is not — it's a
separately-licensed asset pack, and its terms say **no redistribution**. So the
original tileset/character/item images were never copied into this repo, and
`.gitignore` blocks the image extensions under these paths so nobody adds them
by accident later:

- `client/public/assets/tileset/` — world tileset
- `client/public/assets/character/` — cat walk-cycle sprite sheets
- `client/public/assets/items/` — computer / whiteboard / vending machine / chair icons
- `client/src/images/` — logo + character-picker portraits

## What to buy, and where the files go

| Goes in | Buy | Cost |
|---|---|---|
| `client/public/assets/tileset/` | [LimeZu Modern Interiors](https://limezu.itch.io/moderninteriors) — pay-what-you-want, $5 gets the bundle | $1.50–5 |
| `client/public/assets/character/` | [5 Animated Pixel Cats](https://silasgamedev.itch.io/animated-pixel-cats-5-unique-32x32-sprites-with-4-direction-walk-cycles) (commercial use included) — pick this one first | $1.11 |
| — optional, for recoloring later | [OboroPixel Cat Character Pack](https://oboropixel.itch.io/character-animations) — ships Aseprite sources, commercial OK, **no redistribution** | $4.50 |

Buy these on **your own account**. Drop the files at the paths above — on the
droplet at deploy time, or locally for dev — never `git add` them. Same rule
applies to the OboroPixel pack if you use it: its licence explicitly forbids
redistributing the raw files, so it goes on the server's disk, not in git.

Two small code changes come with the 32×32 cat pack (stock SkyOffice character
sheets are 32×48): `frameWidth`/`frameHeight` in `client/src/scenes/Bootstrap.ts`,
and the collision body in `client/src/characters/Player.ts` (`collisionScale`
near the constructor). Handled in the phase-03 commit, not yet.

## Why not just keep the fork private instead?

Every other CashCats property lives in the public `cashcatsllc` repo, and this
world reuses that repo's git history/workflow rather than standing up a second
one — so the constraint is "no licensed art in git," not "no public repo."
