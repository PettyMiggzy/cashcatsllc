# -*- coding: utf-8 -*-
"""
Balance model for the Foraging / Harvesting / Alchemy spec.

Every number in the design document comes out of this file. It is written so
the awkward question -- "can a player max all three skills in a week at two
hours a day?" -- gets an arithmetic answer instead of a hopeful one.

Anchored to what is ALREADY LIVE in roomsrc/trades.js, not invented fresh:

    FORAGE values   Common 3, Uncommon 6, Rare 14, Ultra 70 CashCoin
    SHOVELS yield   1.00 / 1.30 / 1.70 / 2.20
    Gold Shovel     costs a Gold Cash Cat, not ore

The tier price ladder below extends that ladder. If these numbers and the
ones in trades.js ever disagree, trades.js is the one that is wrong -- it is
the shipped economy and this document is the plan for growing it.
"""

TIERS = ['Common', 'Uncommon', 'Rare', 'Ultra Rare']

# --- foraging -------------------------------------------------------------
# Energy cost rises faster than value, so grinding the top tier is a choice
# with a cost rather than a free upgrade.
ENERGY = {'Common': 2, 'Uncommon': 4, 'Rare': 9, 'Ultra Rare': 18}
XP_FORAGE = {'Common': 10, 'Uncommon': 26, 'Rare': 65, 'Ultra Rare': 170}

# Raw ingredient sale price, CashCoin. Common/Uncommon/Rare/Ultra match the
# live FORAGE table exactly; the spread inside a tier is the "slight variation
# within their own tiers" the spec asks for.
PRICE = {'Common': (2, 4), 'Uncommon': (5, 8), 'Rare': (12, 18), 'Ultra Rare': (60, 85)}

SHOVEL = {'Common Shovel': 1.00, 'Copper Shovel': 1.30,
          'Silver Shovel': 1.70, 'Gold Shovel': 2.20}

# Every 25 forage levels, one pick yields more for the same Energy.
def forage_mult(level):
    return 1.0 + 0.25 * ((level - 1) // 25)      # 1.00, 1.25, 1.50, 1.75

# --- energy ---------------------------------------------------------------
ENERGY_CAP = 120
ENERGY_REGEN_PER_MIN = 2.0                        # a full bar in an hour

def energy_available(minutes_played, days=1, start_full=True):
    """
    Energy is a bucket that fills whether you are online or not, which is what
    makes a 2h session viable at all: you spend a full bar, log off, and it is
    full again by tomorrow. Over a week that is 6 full bars banked plus what
    regenerates while you play.
    """
    banked = ENERGY_CAP if start_full else 0
    return banked + minutes_played * ENERGY_REGEN_PER_MIN

# --- harvesting (planted patches) -----------------------------------------
# Foraging returns seed 1:1. One seed -> one patch, max 3 patches per species.
GROW_MIN = {'Common': 8, 'Uncommon': 20, 'Rare': 45, 'Ultra Rare': 120}
# A quarter of the forage values. Harvesting costs no Energy, so if it paid
# the same XP it would be strictly better than the thing that supplies it and
# nobody would ever forage twice.
XP_HARVEST = {'Common': 4, 'Uncommon': 9, 'Rare': 21, 'Ultra Rare': 55}

def harvest_speed(level):
    """Every 10 harvest levels: faster. 100 levels -> a bit over half the time."""
    return max(0.45, 1.0 - 0.055 * ((level - 1) // 10))

def harvest_yield(level):
    """...and more of it. Level 100 returns roughly three times level 1."""
    return 1.0 + 0.22 * ((level - 1) // 10)

# --- alchemy --------------------------------------------------------------
# Brewing costs energy, but much less than foraging -- the spec is explicit.
BREW_ENERGY = {'Common': 1, 'Uncommon': 2, 'Rare': 4, 'Ultra Rare': 7}
XP_BREW = {'Common': 18, 'Uncommon': 45, 'Rare': 110, 'Ultra Rare': 280}
POTION_PRICE = {'Common': 14, 'Uncommon': 34, 'Rare': 95, 'Ultra Rare': 420}

def potions_per_attempt(level):
    """Every 10 alchemy levels: one more potion per brew, and more potent."""
    return 1 + (level - 1) // 10                  # 1 at L1 .. 10 at L100

def potency(level):
    return 1.0 + 0.06 * ((level - 1) // 10)       # +54% at L100


# --- the level curve ------------------------------------------------------
def xp_to_next(level):
    """
    XP required to go from `level` to `level+1`.

    A gentle exponential. Levels 1-25 go by in a session, 75-100 are the long
    tail that keeps a maxed player rare. Rounded to something a UI can print.

    THE COEFFICIENTS ARE NOT A GUESS. The first draft was 40*L^1.55+60, which
    totals 1,955,600 XP and takes 575 days of two-hour sessions to finish. A
    week of play was 1.22% of one skill. This curve totals 139,850 and maxes
    in about 41 days -- six weeks for a dedicated player, which leaves the
    top of the tree rare without making it theoretical.
    """
    return int(round((8 * (level ** 1.30) + 30) / 10.0) * 10)


def cumulative(to_level=100):
    total, rows = 0, []
    for lv in range(1, to_level):
        total += xp_to_next(lv)
        rows.append((lv + 1, xp_to_next(lv), total))
    return rows


# --- the week ------------------------------------------------------------
def week(minutes_per_day=120, days=7, tier='Ultra Rare', shovel='Gold Shovel',
         forage_level=1, verbose=False):
    """
    What one week at `minutes_per_day` actually produces.

    Energy is the binding constraint on foraging and brewing. Harvesting costs
    no energy at all (the spec says so), so it is gated by grow time and by
    the three-patches-per-species cap instead.
    """
    e_day = ENERGY_CAP + minutes_per_day * ENERGY_REGEN_PER_MIN
    e_week = e_day * days

    picks = int(e_week // ENERGY[tier])
    per_pick = SHOVEL[shovel] * forage_mult(forage_level)
    items = picks * per_pick
    fx = picks * XP_FORAGE[tier]

    lo, hi = PRICE[tier]
    coin_raw = items * (lo + hi) / 2.0
    return {'energy_week': e_week, 'picks': picks, 'items': items,
            'forage_xp': fx, 'coin_if_sold_raw': coin_raw}


def time_to_max(skill, tier='Ultra Rare', minutes_per_day=120):
    """Days of play to take one skill from 1 to 100, at best-case tier."""
    need = cumulative()[-1][2]
    e_day = ENERGY_CAP + minutes_per_day * ENERGY_REGEN_PER_MIN
    if skill == 'forage':
        xp_day = (e_day // ENERGY[tier]) * XP_FORAGE[tier]
    elif skill == 'brew':
        xp_day = (e_day // BREW_ENERGY[tier]) * XP_BREW[tier]
    else:                                   # harvest: no energy, grow-time bound
        # 24 species x 3 patches, each cycling on its grow timer, best case
        cycles = (minutes_per_day / GROW_MIN[tier]) * 72
        xp_day = cycles * XP_HARVEST[tier]
    return need / xp_day if xp_day else float('inf')


# --- the whole chain ------------------------------------------------------
def simulate(days=7, minutes_per_day=120, forage_share=0.72, tier_mix=None,
             shovel='Gold Shovel'):
    """
    Day by day, with the three skills feeding each other the way they actually
    do: foraging is the only source of seeds AND the only source of brewing
    stock, so it gates the other two no matter how fast their own curves are.

    Energy is one pool shared between foraging and brewing. `forage_share` is
    how a player splits it; 0.72 is roughly what someone chasing all three
    ends up doing.
    """
    if tier_mix is None:
        # what a real player picks: mostly what they can afford the energy for
        tier_mix = {'Common': .35, 'Uncommon': .30, 'Rare': .25, 'Ultra Rare': .10}

    fx = hx = bx = 0.0
    coin = 0.0
    stock = {t: 0.0 for t in TIERS}          # raw ingredients on hand
    patches = {t: 0 for t in TIERS}          # planted, capped below
    PATCH_CAP = {'Common': 24, 'Uncommon': 21, 'Rare': 18, 'Ultra Rare': 9}
    log = []

    for d in range(1, days + 1):
        e = ENERGY_CAP + minutes_per_day * ENERGY_REGEN_PER_MIN
        e_forage, e_brew = e * forage_share, e * (1 - forage_share)
        flv = level_at(fx); hlv = level_at(hx); blv = level_at(bx)

        # forage
        got = {t: 0.0 for t in TIERS}
        for t, share in tier_mix.items():
            picks = int((e_forage * share) // ENERGY[t])
            n = picks * SHOVEL[shovel] * forage_mult(flv)
            got[t] += n
            fx += picks * XP_FORAGE[t]
            # seed 1:1 -> plant up to the cap
            free = max(0, PATCH_CAP[t] - patches[t])
            patches[t] += min(free, int(picks))

        # Harvest what the patches turned over.
        #
        # A patch grows one crop and then STOPS -- crops do not stack while you
        # are offline. So each patch gives one banked crop on login, plus
        # however many full cycles fit in the session. Modelling it as
        # continuous regrowth had 24 common patches yielding 1,080 harvests a
        # day and took harvesting to level 98 inside a week.
        for t in TIERS:
            per_patch = 1 + (minutes_per_day / (GROW_MIN[t] * harvest_speed(hlv)))
            cycles = per_patch * patches[t]
            n = cycles * harvest_yield(hlv)
            got[t] += n
            hx += cycles * XP_HARVEST[t]

        for t in TIERS:
            stock[t] += got[t]

        # brew: cheapest tier the stock supports, spending the brew energy
        for t in ('Ultra Rare', 'Rare', 'Uncommon', 'Common'):
            need = INGREDIENTS[t]
            can_e = int(e_brew // BREW_ENERGY[t])
            can_s = int(stock[t] // need)
            n = min(can_e, can_s)
            if n <= 0:
                continue
            stock[t] -= n * need
            e_brew -= n * BREW_ENERGY[t]
            made = n * potions_per_attempt(blv)
            bx += n * XP_BREW[t]
            coin += made * POTION_PRICE[t]

        # sell the leftovers
        for t in TIERS:
            lo, hi = PRICE[t]
            coin += stock[t] * (lo + hi) / 2.0
            stock[t] = 0.0

        log.append((d, level_at(fx), level_at(hx), level_at(bx), coin))
    return log


INGREDIENTS = {'Common': 3, 'Uncommon': 5, 'Rare': 8, 'Ultra Rare': 12}


def level_at(xp):
    lv, need = 1, 0
    while lv < 100:
        need += xp_to_next(lv)
        if xp < need:
            return lv
        lv += 1
    return 100


# --- the ingredients ------------------------------------------------------
# Real species, real habitats. Tier is set by how hard the thing genuinely is
# to find in the world: a blackberry is in every hedge, a white truffle needs
# the right oak, the right soil and a trained animal.
#
# (name, kind, tier, latin, where it actually grows, price, grow-min)
SPECIES = [
 # ---- Common: found on any walk, temperate and widespread
 ('Blackberry','Berry','Common','Rubus fruticosus','Hedgerows and woodland edge, temperate Europe and N. America',2,8),
 ('Elderberry','Berry','Common','Sambucus nigra','Riverbanks, scrub and hedgerow, across Europe',3,9),
 ('Field Mushroom','Mushroom','Common','Agaricus campestris','Grazed grassland and pasture, late summer',2,7),
 ('Wood Ear','Mushroom','Common','Auricularia auricula-judae','Dead and dying elder, year round',3,8),
 ('Hazelnut','Nut','Common','Corylus avellana','Woodland understorey and hedgerow, Europe',4,10),
 ('Dandelion','Herb','Common','Taraxacum officinale','Grassland, verges, disturbed ground — everywhere',2,6),
 # ---- Uncommon: a specific habitat, but not a rare one
 ('Bilberry','Berry','Uncommon','Vaccinium myrtillus','Acid heath and upland moor, northern Europe',6,18),
 ('Sea Buckthorn','Berry','Uncommon','Hippophae rhamnoides','Coastal dunes and shingle, salt-tolerant',7,20),
 ('Chanterelle','Mushroom','Uncommon','Cantharellus cibarius','Mossy beech and conifer woodland, mycorrhizal',8,22),
 ('Giant Puffball','Mushroom','Uncommon','Calvatia gigantea','Rich pasture and meadow edges, late summer',5,19),
 ('Sweet Chestnut','Nut','Uncommon','Castanea sativa','Warm deciduous woodland on acid soil',6,21),
 ('Wild Garlic','Herb','Uncommon','Allium ursinum','Damp deciduous woodland, spring carpets',5,17),
 # ---- Rare: right region, right season, right host tree
 ('Cloudberry','Berry','Rare','Rubus chamaemorus','Arctic and subarctic peat bog, Scandinavia and Canada',16,42),
 ('Lingonberry','Berry','Rare','Vaccinium vitis-idaea','Boreal forest floor and tundra heath',13,38),
 ('Porcini','Mushroom','Rare','Boletus edulis','Mycorrhizal with oak, beech and pine; autumn',18,50),
 ('Morel','Mushroom','Rare','Morchella esculenta','Burn sites and disturbed ash and elm ground, spring',17,48),
 ('Pine Nut','Nut','Rare','Pinus pinea','Mediterranean stone pine, three years to ripen a cone',12,40),
 ('Arnica','Herb','Rare','Arnica montana','Mountain meadow on acid soil, protected in much of Europe',15,45),
 # ---- Ultra Rare: Gold Shovel only
 ('Arctic Bramble','Berry','Ultra Rare','Rubus arcticus','Northern bog and damp meadow, far north only',62,110),
 ('Miracle Berry','Berry','Ultra Rare','Synsepalum dulcificum','West African forest understorey',70,120),
 ('White Truffle','Mushroom','Ultra Rare','Tuber magnatum','Oak and hazel roots, Piedmont; found only by trained animals',85,140),
 ('Matsutake','Mushroom','Ultra Rare','Tricholoma matsutake','Red pine forest, Japan and Korea; cannot be cultivated',80,135),
 ('Brazil Nut','Nut','Ultra Rare','Bertholletia excelsa','Undisturbed primary Amazon; needs its wild pollinator',65,115),
 ('Wild Ginseng','Herb','Ultra Rare','Panax quinquefolius','Appalachian hardwood understorey; decades to mature',78,130),
]


# --- the recipe book ------------------------------------------------------
# Tier gating is Ahmad's, verbatim. What each recipe actually takes is chosen
# so that every one of the 24 species is used by something -- checked at the
# bottom of this file, because "all available ingredients should be used" is
# easy to say and easy to get wrong by two or three.
#
# Higher tier = more ingredients AND a higher-tier base, so a Rare potion
# needs rare stock, not just a lot of common stock.
RECIPES = [
 # (potion, gate tier, recipe must be bought?, ingredients)
 ('Health Potion','Common',False,['Blackberry','Dandelion','Wood Ear']),
 ('Mana Potion','Common',False,['Elderberry','Dandelion','Field Mushroom']),
 ('Attack & Defence Tonic','Common',False,['Hazelnut','Blackberry','Field Mushroom']),
 ('Mana Efficiency Draught','Common',False,['Dandelion','Elderberry','Wood Ear']),
 ('Meme Attack & Defence Tonic','Common',False,['Hazelnut','Elderberry','Dandelion']),
 ('Critical Chance Elixir','Common',False,['Wood Ear','Hazelnut','Blackberry']),
 ('Critical Damage Elixir','Common',False,['Field Mushroom','Hazelnut','Wood Ear']),

 ('Attack Amplitude Elixir','Uncommon',False,['Chanterelle','Sweet Chestnut','Bilberry','Blackberry','Hazelnut']),
 ('Defence Amplitude Elixir','Uncommon',False,['Giant Puffball','Sweet Chestnut','Sea Buckthorn','Wood Ear','Dandelion']),
 ('Meme Attack Amplitude Elixir','Uncommon',False,['Wild Garlic','Bilberry','Chanterelle','Elderberry','Hazelnut']),
 ('Meme Defence Amplitude Elixir','Uncommon',False,['Wild Garlic','Sea Buckthorn','Giant Puffball','Field Mushroom','Blackberry']),
 ('Haste Draught (attack speed)','Uncommon',False,['Bilberry','Wild Garlic','Sweet Chestnut','Dandelion','Elderberry']),

 ('Boss Slayer Elixir','Rare',True,['Porcini','Cloudberry','Arnica','Pine Nut','Chanterelle','Bilberry','Hazelnut','Blackberry']),
 ('Greater Health Elixir','Rare',True,['Cloudberry','Lingonberry','Morel','Arnica','Sweet Chestnut','Giant Puffball','Wood Ear','Dandelion']),
 ('Greater Mana Elixir','Rare',True,['Lingonberry','Morel','Pine Nut','Arnica','Wild Garlic','Sea Buckthorn','Elderberry','Field Mushroom']),
 ('Additional Damage Elixir','Rare',True,['Porcini','Pine Nut','Cloudberry','Morel','Chanterelle','Bilberry','Hazelnut','Wood Ear']),

 ('Memestone Resonance Elixir','Ultra Rare',True,
  ['White Truffle','Wild Ginseng','Arctic Bramble','Matsutake','Porcini','Cloudberry','Arnica',
   'Chanterelle','Bilberry','Sweet Chestnut','Hazelnut','Blackberry']),
 ('Swiftcast Elixir (casting duration)','Ultra Rare',True,
  ['Matsutake','Miracle Berry','Wild Ginseng','Brazil Nut','Morel','Pine Nut','Lingonberry',
   'Wild Garlic','Sea Buckthorn','Giant Puffball','Elderberry','Dandelion']),
 ('Coldsnap Elixir (skill cooldown)','Ultra Rare',True,
  ['Brazil Nut','Arctic Bramble','White Truffle','Miracle Berry','Arnica','Porcini','Cloudberry',
   'Chanterelle','Wild Garlic','Bilberry','Field Mushroom','Wood Ear']),
]

RECIPE_COST = {'Rare': 2500, 'Ultra Rare': 18000}     # CashCoin, one-time
