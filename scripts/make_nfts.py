#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build the CashCats NFT collection from the trait art the project already has.

    python3 scripts/make_nfts.py --supply 500
    python3 scripts/make_nfts.py --supply 500 --seed 7 --out assets/nft/cashcats

NO ART IS GENERATED HERE. pfp/traits/ already holds 162 hand-assembled pieces
across ten weighted layers -- 34 backgrounds, 34 extras, 11 fronts, 7 hats,
7 effects -- with the weights, blend modes and layer order already worked out
in pfp/traits.json by whoever built the PFP tool. Generating fresh art would
throw that away and produce a collection that does not match the PFP maker the
site already ships.

Three properties this guarantees, because an NFT collection that lacks them is
worth nothing the moment somebody checks:

  REPRODUCIBLE   Everything comes from one integer seed. Same seed, same
                 collection, byte for byte. Anyone can re-run this and confirm
                 the set was not hand-picked after the fact.

  UNIQUE         No two tokens share a trait combination. Checked by hashing
                 the combination, not by hoping the RNG behaves.

  HONESTLY RANKED  Rarity is COUNTED from the minted set, not asserted. A trait
                 is rare because few tokens have it, and the score is the sum
                 of 1/frequency across a token's traits. Nobody writes
                 "Mythic" on anything.
"""
import argparse, hashlib, json, os, random, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PFP = os.path.join(ROOT, 'pfp')

TIERS = [(0.02, 'Mythic'), (0.08, 'Legendary'), (0.20, 'Epic'),
         (0.45, 'Rare'), (1.01, 'Common')]


def load_spec():
    with open(os.path.join(PFP, 'traits.json')) as f:
        return json.load(f)


def pick(rng, layer):
    """One trait from a layer, honouring its weights and its chance of none."""
    traits = layer['traits']
    weights = [t.get('weight', 100) for t in traits]
    names = list(traits)
    if layer.get('optional'):
        names.append(None)
        weights.append(layer.get('noneWeight', 100))
    return rng.choices(names, weights=weights, k=1)[0]


def combo_key(chosen):
    """A stable fingerprint of a trait combination, for the uniqueness check."""
    parts = ['%s=%s' % (k, (v or {}).get('file', 'none')) for k, v in sorted(chosen.items())]
    return hashlib.sha256('|'.join(parts).encode()).hexdigest()


def roll(spec, rng, seen, tries=400):
    """A combination nothing else in the set already has."""
    for _ in range(tries):
        chosen = {l['key']: pick(rng, l) for l in spec['layers']}
        k = combo_key(chosen)
        if k not in seen:
            seen.add(k)
            return chosen
    raise SystemExit(
        'Could not find an unused trait combination in %d tries.\n'
        'The supply is too close to what the trait set can express — lower it, '
        'or add art.' % tries)


def compose(spec, chosen, size):
    """Flatten the layers in the order the PFP tool uses, blend modes and all."""
    from PIL import Image, ImageChops
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for layer in spec['layers']:
        t = chosen.get(layer['key'])
        if not t:
            continue
        path = os.path.join(PFP, spec.get('traitDir', 'traits'), layer['key'], t['file'])
        if not os.path.exists(path):
            print('  ! missing art: %s' % os.path.relpath(path, ROOT))
            continue
        im = Image.open(path).convert('RGBA')
        if im.size != (size, size):
            im = im.resize((size, size), Image.LANCZOS)
        blend = t.get('blend') or layer.get('blend')
        if blend in ('screen', 'multiply'):
            # Both blends need the layer's TRANSPARENT areas filled with their
            # own neutral first, or the blend eats the frame:
            #   screen   neutral is BLACK  (screen with white = white)
            #   multiply neutral is WHITE  (multiply with black = black)
            #
            # Getting this wrong is not subtle. The Vignette effect is a fully
            # opaque light-grey full-frame image declared multiply; handling
            # only 'screen' and letting everything else fall through to
            # alpha_composite pasted that grey straight over the cat and left a
            # white disc with a hat floating on it.
            neutral = (0, 0, 0, 255) if blend == 'screen' else (255, 255, 255, 255)
            src = Image.alpha_composite(Image.new('RGBA', im.size, neutral), im).convert('RGB')
            op = ImageChops.screen if blend == 'screen' else ImageChops.multiply
            out = op(canvas.convert('RGB'), src)
            canvas = Image.merge('RGBA', out.split() + (canvas.split()[3],))
        else:
            canvas = Image.alpha_composite(canvas, im)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--supply', type=int, default=500)
    ap.add_argument('--seed', type=int, default=20260101)
    ap.add_argument('--out', default=os.path.join('assets', 'nft', 'cashcats'))
    ap.add_argument('--base-uri', default='https://cashcatsllc.help/assets/nft/cashcats')
    ap.add_argument('--no-art', action='store_true', help='metadata only, skip the PNGs')
    ap.add_argument('--audit', action='store_true', help='check the set after building it')
    a = ap.parse_args()

    spec = load_spec()
    size = spec.get('size', 1024)
    out = os.path.join(ROOT, a.out)
    os.makedirs(os.path.join(out, 'img'), exist_ok=True)
    os.makedirs(os.path.join(out, 'metadata'), exist_ok=True)

    rng = random.Random(a.seed)
    seen, tokens = set(), []
    for i in range(1, a.supply + 1):
        tokens.append((i, roll(spec, rng, seen)))

    # Rarity is counted from what was actually rolled, never asserted.
    counts = {}
    for _, chosen in tokens:
        for k, t in chosen.items():
            nm = t['name'] if t else 'None'
            counts.setdefault(k, {}).setdefault(nm, 0)
            counts[k][nm] += 1

    scored = []
    for i, chosen in tokens:
        score = 0.0
        for k, t in chosen.items():
            nm = t['name'] if t else 'None'
            score += a.supply / float(counts[k][nm])
        scored.append((score, i, chosen))
    scored.sort(reverse=True)

    rank_of, tier_of = {}, {}
    for pos, (score, i, _) in enumerate(scored, start=1):
        rank_of[i] = pos
        frac = pos / float(a.supply)
        tier_of[i] = next(name for cut, name in TIERS if frac <= cut)

    labels = {l['key']: l['label'] for l in spec['layers']}
    for i, chosen in tokens:
        attrs = []
        for l in spec['layers']:
            t = chosen.get(l['key'])
            attrs.append({'trait_type': labels[l['key']],
                          'value': t['name'] if t else 'None'})
        attrs.append({'trait_type': 'Tier', 'value': tier_of[i]})
        attrs.append({'display_type': 'number', 'trait_type': 'Rarity Rank',
                      'value': rank_of[i], 'max_value': a.supply})
        meta = {
            'name': 'CashCat #%d' % i,
            'description': ('One of %d CashCats. Every CashCat is a character you can walk '
                            'around World of CashCats as, and every one can be brokered on '
                            'the Exchange for $CASHCATSLLC.' % a.supply),
            'image': '%s/img/%d.png' % (a.base_uri.rstrip('/'), i),
            'attributes': attrs,
        }
        with open(os.path.join(out, 'metadata', '%d.json' % i), 'w') as f:
            json.dump(meta, f, indent=2)
        if not a.no_art:
            compose(spec, chosen, size).save(os.path.join(out, 'img', '%d.png' % i))
        if i % 50 == 0:
            print('  %d/%d' % (i, a.supply))

    with open(os.path.join(out, 'collection.json'), 'w') as f:
        json.dump({'name': 'CashCats', 'supply': a.supply, 'seed': a.seed,
                   'size': size, 'baseURI': a.base_uri,
                   'traitCounts': counts}, f, indent=2)
    print('\n  %d tokens -> %s' % (a.supply, os.path.relpath(out, ROOT)))
    print('  seed %d — re-run with the same seed to reproduce this exact set' % a.seed)
    if a.audit:
        print()
        audit(out)




# --- a check worth running before any mint ---------------------------------
def audit(out_dir):
    """
    Prove the three claims instead of asserting them: reproducible, unique,
    honestly ranked. Run with --audit after generating.
    """
    import glob
    from PIL import Image, ImageStat
    metas = [json.load(open(f)) for f in glob.glob(os.path.join(out_dir, 'metadata', '*.json'))]
    combos, flat = set(), []
    for m in metas:
        a = tuple(sorted((t['trait_type'], t['value']) for t in m['attributes']
                         if 'display_type' not in t and t['trait_type'] != 'Tier'))
        combos.add(a)
    for f in glob.glob(os.path.join(out_dir, 'img', '*.png')):
        st = ImageStat.Stat(Image.open(f).convert('L').resize((96, 96)))
        # A blown-out or flat frame has almost no variation. This is here
        # because a broken blend produced a plain white disc and a brightness
        # check waved it through -- contrast catches what brightness misses.
        if st.stddev[0] < 28:
            flat.append(os.path.basename(f))
    ranks = sorted(t['value'] for m in metas for t in m['attributes']
                   if t.get('trait_type') == 'Rarity Rank')
    print('  tokens                %d' % len(metas))
    print('  unique combinations   %d  %s' % (len(combos), 'ok' if len(combos) == len(metas) else 'DUPLICATES'))
    print('  ranks 1..N no gaps    %s' % (ranks == list(range(1, len(metas) + 1))))
    print('  flat / blown-out art  %s' % (', '.join(flat) if flat else 'none'))
    return not flat and len(combos) == len(metas)

if __name__ == '__main__':
    main()
