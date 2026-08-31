"""
Pre-tile the generated textures.

hyperfy's prim applies a texture across UV 0..1 of each face, with no repeat
control, so a single 1k image stretched over a 64m plaza looks absurd. The
tiling therefore has to be baked into the image itself.

Seams are handled by mirroring: [I, flip_h(I)] over [flip_v(I), flip_hv(I)]
is inherently seamless at every edge, so the block can repeat without a
visible join. Mirroring costs some symmetry, which stone and plaster hide
well and which would be obvious on anything with lettering or a strong
direction.
"""
from PIL import Image

SRC = 1024


def mirror_block(im):
    w, h = im.size
    block = Image.new('RGB', (w * 2, h * 2))
    block.paste(im, (0, 0))
    block.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    block.paste(im.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    block.paste(im.transpose(Image.ROTATE_180), (w, h))
    return block


def tiled(src, nx, ny, out, px=1024):
    im = Image.open(src).convert('RGB')
    block = mirror_block(im)                     # covers a 2x2 span
    bx, by = max(1, nx // 2), max(1, ny // 2)
    sheet = Image.new('RGB', (block.width * bx, block.height * by))
    for i in range(bx):
        for j in range(by):
            sheet.paste(block, (i * block.width, j * block.height))
    # keep the aspect of the surface so the tiles stay square once stretched
    ar = nx / ny
    h = px if ar >= 1 else int(px / ar)
    w = int(h * ar)
    sheet = sheet.resize((min(w, 2048), min(h, 2048)), Image.LANCZOS)
    sheet.save(out, quality=90, optimize=True)
    print('%-22s %-12s %s' % (out, '%dx%d tiles' % (nx, ny), sheet.size))


tiled('plaza.png',    8, 8, 't_paving.jpg')
tiled('plaza.png',    4, 4, 't_paving_room.jpg')
tiled('plaster.png',  6, 2, 't_plaster.jpg')
tiled('wainscot.png',12, 1, 't_wainscot.jpg')
tiled('marble.png',   4, 4, 't_marble_floor.jpg')
tiled('marble.png',   6, 2, 't_marble_wall.jpg')
tiled('wood.png',     4, 1, 't_wood.jpg')
tiled('soil.png',     6, 3, 't_soil.jpg')
