# -*- coding: utf-8 -*-
"""Render the design document from forage_model.py, so no number is retyped."""
import json, html, io
import forage_model as m

d = json.load(open('data.json'))
TIER_VAR = {'Common': 'sage', 'Uncommon': 'mint', 'Rare': 'azure', 'Ultra Rare': 'gold'}
esc = html.escape
def n(x): return '{:,}'.format(int(round(x)))

# ---- species, grouped by tier
species_html = []
for t in m.TIERS:
    rows = [s for s in d['species'] if s['tier'] == t]
    tv = TIER_VAR[t]
    tier = d['tiers'][t]
    gate = ('<span class="gate">Gold Shovel only</span>' if t == 'Ultra Rare' else '')
    items = '\n'.join(
        '<tr><th scope="row"><span class="sp">%s</span><em class="lat">%s</em></th>'
        '<td class="kind">%s</td><td class="hab">%s</td>'
        '<td class="num">%d</td><td class="num">%d</td></tr>'
        % (esc(r['name']), esc(r['latin']), esc(r['kind']), esc(r['where']), r['price'], r['grow'])
        for r in rows)
    species_html.append(f'''
<section class="band" style="--tier:var(--{tv})">
  <header class="bandhead">
    <h3>{esc(t)}</h3>
    <dl class="stats">
      <div><dt>Energy / pick</dt><dd>{tier['energy']}</dd></div>
      <div><dt>Forage XP</dt><dd>{tier['xp']}</dd></div>
      <div><dt>Harvest XP</dt><dd>{tier['hxp']}</dd></div>
      <div><dt>Brew XP</dt><dd>{tier['bxp']}</dd></div>
    </dl>
    {gate}
  </header>
  <div class="scroll">
  <table class="guide">
    <thead><tr><th scope="col">Species</th><th scope="col">Kind</th>
      <th scope="col">Where it grows</th><th scope="col">Sells</th><th scope="col">Grows in</th></tr></thead>
    <tbody>{items}</tbody>
  </table>
  </div>
</section>''')

# ---- recipes
rec_html = []
for t in m.TIERS:
    rs = [r for r in d['recipes'] if r['tier'] == t]
    if not rs: continue
    tv = TIER_VAR[t]
    buy = rs[0]['buy']
    cost = ('Recipe costs %s CashCoin' % n(d['recipeCost'][t])) if buy else 'No recipe needed'
    cards = '\n'.join(
        '<article class="rec"><h4>%s</h4><p class="ing">%s</p></article>'
        % (esc(r['name']), esc(' · '.join(r['ing']))) for r in rs)
    rec_html.append(f'''
<section class="band" style="--tier:var(--{tv})">
  <header class="bandhead">
    <h3>{esc(t)} brews</h3>
    <dl class="stats">
      <div><dt>Ingredients each</dt><dd>{d['tiers'][t]['ing']}</dd></div>
      <div><dt>Energy / brew</dt><dd>{d['tiers'][t]['brewE']}</dd></div>
      <div><dt>Sells for</dt><dd>{n(d['tiers'][t]['potion'])}</dd></div>
    </dl>
    <span class="gate {'buy' if buy else 'free'}">{cost}</span>
  </header>
  <div class="recs">{cards}</div>
</section>''')

# ---- level table: 1-10, then every 5
lv_rows = []
for r in d['levels']:
    if r['lv'] <= 10 or r['lv'] % 5 == 0:
        mark = ' class="mile"' if r['lv'] in (25, 50, 75, 100) else ''
        lv_rows.append('<tr%s><td class="num">%d</td><td class="num">%s</td><td class="num">%s</td></tr>'
                       % (mark, r['lv'], n(r['step']), n(r['cum'])))
lv_html = '\n'.join(lv_rows)

week_rows = '\n'.join(
    '<tr><td class="num">%d</td><td class="num">%d</td><td class="num">%d</td>'
    '<td class="num">%d</td><td class="num coin">%s</td></tr>' % (r['d'], r['f'], r['h'], r['b'], n(r['c']))
    for r in d['week'])
long_rows = '\n'.join(
    '<tr><td class="num">%d</td><td class="num">%d</td><td class="num">%d</td>'
    '<td class="num">%d</td><td class="num coin">%s</td></tr>' % (r['w'], r['f'], r['h'], r['b'], n(r['c']))
    for r in d['long'])
shovel_rows = '\n'.join(
    '<tr><th scope="row">%s</th><td class="num">&times;%.2f</td><td>%s</td></tr>'
    % (k, v, 'Ultra Rare unlocked' if k == 'Gold Shovel' else 'Common, Uncommon, Rare')
    for k, v in d['shovels'].items())

io.open('forage_doc_body.html', 'w', encoding='utf-8').write(
    ''.join(species_html) + '\n<!--SPLIT-->\n' + ''.join(rec_html) +
    '\n<!--SPLIT-->\n' + lv_html + '\n<!--SPLIT-->\n' + week_rows +
    '\n<!--SPLIT-->\n' + long_rows + '\n<!--SPLIT-->\n' + shovel_rows)
print('body fragments written')
