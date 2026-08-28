#!/usr/bin/env node
/* ============================================================
   CashCats — funny trait generator (AI art, run on your box)

   Generates a set of meme accessory overlays, cuts out the black background to
   transparent PNGs, drops them in pfp/traits/extras/, and adds an "Extras"
   layer to pfp/traits.json so they show up in the generator immediately.

     npm i pngjs
     export VENICE_API_KEY=...        # your inference key (kept in env, never committed)
     node scripts/gen-cattraits.mjs                 # generate all
     node scripts/gen-cattraits.mjs laser_eyes crown   # just some

   Provider is called server-side only; never name it in public marketing —
   call it "$CASHCATS AI" like the other projects.
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const KEY = process.env.VENICE_API_KEY || process.env.VENICE_KEY;
if (!KEY) { console.error("Missing VENICE_API_KEY. Run: VENICE_API_KEY=... node scripts/gen-cattraits.mjs"); process.exit(1); }

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "pfp", "traits", "extras");
fs.mkdirSync(OUT, { recursive: true });

const ISO = "isolated single object, no cat, no animal, no character, no scene, centered, crisp clean edges, sticker / video-game power-up icon style, flat even lighting, on a pure solid black background";
const NEG = "cat, animal, face, character, person, background scene, gradient, watermark, text, logo, multiple objects, blur, drop shadow on background";

// file names double as the trait "name" (title-cased). Positioned where they'd sit on a centered cat.
const ITEMS = [
  { id: "laser_eyes",  prompt: `two glowing neon-red laser beams shooting sideways at eye level, ${ISO}` },
  { id: "deal_shades", prompt: `black pixelated 8-bit "deal with it" sunglasses at eye level, ${ISO}` },
  { id: "gold_crown",  prompt: `a shiny gold king's crown with red jewels, near the top of the frame, ${ISO}` },
  { id: "cowboy_hat",  prompt: `a brown leather cowboy hat, near the top of the frame, ${ISO}` },
  { id: "tinfoil_hat", prompt: `a shiny crumpled tin-foil cone hat, near the top of the frame, ${ISO}` },
  { id: "halo",        prompt: `a glowing golden angel halo ring, floating near the top of the frame, ${ISO}` },
  { id: "devil_horns", prompt: `small glossy red devil horns, near the top of the frame, ${ISO}` },
  { id: "gold_chain",  prompt: `a chunky gold Cuban-link chain necklace, in the lower third of the frame, ${ISO}` },
  { id: "blunt",       prompt: `a single lit blunt with a wisp of smoke, in the lower-center of the frame, ${ISO}` },
  { id: "money_rain",  prompt: `hundred dollar bills raining down, spread across the whole square frame, ${ISO}` },
  { id: "top_hat",     prompt: `a black formal top hat, near the top of the frame, ${ISO}` },
  { id: "party_hat",   prompt: `a striped cone party hat, near the top of the frame, ${ISO}` },
];

async function venice(prompt) {
  const res = await fetch("https://api.venice.ai/api/v1/image/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "venice-sd35", prompt, negative_prompt: NEG,
      width: 1024, height: 1024, format: "png",
      return_binary: false, hide_watermark: true, safe_mode: false, cfg_scale: 7,
    }),
  });
  if (!res.ok) throw new Error(`venice ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (!j.images || !j.images[0]) throw new Error("no image returned");
  return Buffer.from(j.images[0], "base64");
}

// Flood-fill from the 4 corners over near-black pixels -> transparent. Keeps dark
// parts INSIDE the object (only the connected background is removed).
function cutout(buf, thresh = 42) {
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;
  const isBg = (i) => data[i] < thresh && data[i + 1] < thresh && data[i + 2] < thresh;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h && !seen[y * w + x]) stack.push(x, y); };
  push(0, 0); push(w - 1, 0); push(0, h - 1); push(w - 1, h - 1);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(), p = y * w + x;
    if (seen[p]) continue; seen[p] = 1;
    const i = p * 4;
    if (!isBg(i)) continue;
    data[i + 3] = 0;               // make background transparent
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return PNG.sync.write(png);
}

const title = (id) => id.split("_").map((s) => s[0].toUpperCase() + s.slice(1)).join(" ");

(async () => {
  const only = process.argv.slice(2);
  const list = only.length ? ITEMS.filter((a) => only.includes(a.id)) : ITEMS;
  console.log(`\nCashCats trait gen — ${list.length} item(s)\n`);
  const made = [];
  for (const it of list) {
    process.stdout.write(`  → ${it.id} … `);
    try {
      const raw = await venice(it.prompt);
      const cut = cutout(raw);
      fs.writeFileSync(path.join(OUT, it.id + ".png"), cut);
      made.push(it.id);
      console.log(`ok (${(cut.length / 1024).toFixed(0)}kb)`);
    } catch (e) { console.log("FAIL", e.message); }
  }
  if (!made.length) { console.log("\nnothing generated."); return; }

  // wire an "Extras" layer into the manifest (optional, drawn on top)
  const mfPath = path.join(ROOT, "pfp", "traits.json");
  const mf = JSON.parse(fs.readFileSync(mfPath, "utf8"));
  const traits = ITEMS.filter((i) => made.includes(i.id))
    .map((i) => ({ file: i.id + ".png", name: title(i.id), weight: 100, origin: "cashcats-ai" }));
  mf.layers = mf.layers.filter((l) => l.key !== "extras");
  mf.layers.push({ key: "extras", label: "Extras", optional: true, noneWeight: 260, traits });
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
  console.log(`\nDone. ${made.length} item(s) → pfp/traits/extras/ and added the Extras layer.`);
  console.log("Commit the new PNGs + traits.json, push, and they're live.");
})();
