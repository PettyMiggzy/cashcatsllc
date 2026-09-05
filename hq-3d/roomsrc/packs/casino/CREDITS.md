# Casino models — CC-BY-4.0

These three are the only models in this world that carry an attribution
requirement, and it is a real one: CC-BY-4.0 means the credit travels with the
work. It is given here, in `roomsrc/vip.js` on a plate inside the room, and it
must survive any rework of that room.

They are committed rather than fetched. `fetch_packs.py` pulls the Kenney packs
on demand and that is why those are gitignored; a Sketchfab download needs an
account and a click, so a script cannot replace these. If they are not in the
repository the droplet simply never has them.

| File | Model | Author | Source |
|---|---|---|---|
| `roulette-wheel.glb` | Roulette Wheel | [sipulitrade](https://sketchfab.com/sipulitrader) | [Sketchfab](https://sketchfab.com/3d-models/roulette-wheel-841a9636a82f49d9b66f0add39b0df1a) |
| `chandelier.glb` | Retro Gold Cahndelier | [TUJM](https://sketchfab.com/ggflutter) | [Sketchfab](https://sketchfab.com/3d-models/retro-gold-cahndelier-0c13d2d069d242a2a51e09d272621a97) |

All three are licensed [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).
The licence and author are also embedded in each file's glTF `asset.extras`,
where `shrink_glb.py` leaves them untouched — so the provenance survives even
if this file does not.

## Changes made

Both files are byte-for-byte as downloaded. `shrink_glb.py` was run over them
and left both alone: the roulette wheel has nothing above 1024px, and the
chandelier's five maps are near-flat colour that compress better as PNG at
2048 than as JPEG at 1024, so re-encoding them made the file *bigger*.

## Not used: Animated Playing Cards

[Tycho Magnetic Anomaly](https://sketchfab.com/Tycho_Magnetic_Anomaly)'s
[animated playing cards](https://sketchfab.com/3d-models/animated-playing-cards-read-below-76be59774ffe4576a36c1b6a5399b3fe)
were supplied and are not in the build. They load and render, but the fan is
the *animation*, and this engine only builds an AnimationMixer for a
`SkinnedMesh` node — `glbToNodes` looks for a skinned child, and that file is
sixty ordinary meshes driven by node transforms. The clip can never play here.
Static, it is a closed deck: a dark brick on green felt, for 2.8MB.

A static fanned hand, or a stack of chips, would drop straight into the same
spot on the High Table.
