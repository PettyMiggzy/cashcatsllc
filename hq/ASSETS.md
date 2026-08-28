# Assets — read this before adding any image here

This repo is **public**. The code in this fork is MIT (see `LICENSE`, © 2021
Kuan-Hsuan Shen, original project https://github.com/kevinshen56714/SkyOffice)
and MIT is fine to redistribute. SkyOffice's *original* art was not — it was a
separately-licensed pack whose terms said no redistribution — so none of it was
ever copied into this repo.

## Character sprites — resolved, committed

`client/public/assets/character/{white,tan,brown,black}.png` and the matching
login portraits in `client/src/images/login/` are **free and committed**:
[LPC Cats and Dogs](https://opengameart.org/content/lpc-cats-and-dogs) by
**bluecarrot16**, used here under **CC-BY 3.0** (one of several license
options the piece is offered under — attribution required, redistribution
explicitly allowed, unlike the packs below). Credit: bluecarrot16,
https://opengameart.org/content/lpc-cats-and-dogs. Each color has 3-frame
walk cycles for down/up/side (side is mirrored in code for left vs. right);
there are no sit poses, so sitting reuses the idle frame — cats stand on
chairs rather than sit in them, for now.

A branded set matching the PFP studio's traits (pinstripe, chain, visor) is
a real v2 want, not a launch blocker — same logic as the site's PFP art.

## Still pending purchase — NOT committed

- `client/public/assets/tileset/` — world tileset
- `client/public/assets/items/` — computer / whiteboard / vending machine / chair icons

| Goes in | Buy | Cost |
|---|---|---|
| `client/public/assets/tileset/` | [LimeZu Modern Interiors](https://limezu.itch.io/moderninteriors) — pay-what-you-want, $5 gets the bundle | $1.50–5 |
| `client/public/assets/items/` | comes with the LimeZu pack above, or source separately | — |

Buy these on **your own account**. Drop the files at the paths above — on the
droplet at deploy time, or locally for dev — never `git add` them; `.gitignore`
blocks the image extensions under these two paths specifically so it can't
happen by accident.

## Why not just keep the fork private instead?

Every other CashCats property lives in the public `cashcatsllc` repo, and this
world reuses that repo's git history/workflow rather than standing up a second
one — so the constraint is "no licensed art in git," not "no public repo."
