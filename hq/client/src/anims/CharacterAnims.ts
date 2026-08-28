import Phaser from 'phaser'

// Each cat texture is a 32x32, 3-frame-per-row sheet: row 0 = down, row 1 =
// up, row 2 = side. There's no separate left/right art or sit pose — left
// vs. right reuses the side frames mirrored via setFlipX() in
// MyPlayer.ts/OtherPlayer.ts, and sit_* reuses the idle frame (map has no
// sitting pose to show; cats stand at chairs rather than sit, for now).
const ROW = { down: 0, up: 1, side: 2 }
const CATS = ['white', 'tan', 'brown', 'black']

export const createCharacterAnims = (anims: Phaser.Animations.AnimationManager) => {
  const animsFrameRate = 8

  for (const cat of CATS) {
    const run = (key: string, row: number) =>
      anims.create({
        key: `${cat}_run_${key}`,
        frames: anims.generateFrameNumbers(cat, { start: row * 3, end: row * 3 + 2 }),
        repeat: -1,
        frameRate: animsFrameRate,
      })
    const still = (key: string, row: number, frame = 1) =>
      anims.create({
        key: `${cat}_${key}`,
        frames: anims.generateFrameNumbers(cat, { start: row * 3 + frame, end: row * 3 + frame }),
        repeat: -1,
        frameRate: animsFrameRate,
      })

    run('down', ROW.down)
    run('up', ROW.up)
    run('right', ROW.side)
    run('left', ROW.side)

    still('idle_down', ROW.down)
    still('idle_up', ROW.up)
    still('idle_right', ROW.side)
    still('idle_left', ROW.side)

    // no sit pose in the art — reuse the idle frame for each direction
    still('sit_down', ROW.down)
    still('sit_up', ROW.up)
    still('sit_right', ROW.side)
    still('sit_left', ROW.side)
  }
}
