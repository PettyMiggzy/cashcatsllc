#!/usr/bin/env node
/* ============================================================
   CashCats Telegram bot — run on your server (needs: npm i ethers)

     export BOT_TOKEN=123456:AA...
     node scripts/cashcats-bot.mjs        # long-polls, keep alive with pm2/systemd

   Commands: /start /pfp /swap /price /rewards /airdrop /ca /privacy /help
   - PFP opens as a Mini App (image tool — allowed).
   - Swap opens in the user's browser via a normal link (NOT a Mini App):
     Telegram's ToS restricts in-app crypto to TON only, and our swap is a
     non-TON EVM swap, so we deliberately link out to stay compliant.
   ============================================================ */
import { ethers } from "ethers";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error("Set BOT_TOKEN"); process.exit(1); }

const SITE   = "https://www.cashcatllc.help";
const CA      = "0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc";
const POOL    = "0x48ab386e7919b6a47ece9377e19a07cc27090fc85a1c4f41d1d28eb36f95c18b";
const REWARDS = "0xed86b5eb83476f7b710e8037f5a84d8624288db7";
const AIRDROP = "0xeb317Df4f06fa6DdFB7800C43E11f317715Eeb9E";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const provider = new ethers.JsonRpcProvider(RPC, 4663);

const api = (m, body) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const send = (chat_id, text, extra = {}) =>
  api("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

// ---- live data ----
async function price() {
  try {
    const j = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CA}`)).json();
    const p = (j.pairs || []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!p) return null;
    return { price: p.priceUsd, ch: p.priceChange?.h24, mc: p.marketCap || p.fdv, vol: p.volume?.h24, url: p.url };
  } catch { return null; }
}
async function balOf(addr) {
  const c = new ethers.Contract(CA, ["function balanceOf(address) view returns (uint256)"], provider);
  return Number(ethers.formatUnits(await c.balanceOf(addr), 18));
}
async function airdropState() {
  const c = new ethers.Contract(AIRDROP, [
    "function pending() view returns (uint256)",
    "function totalDistributed() view returns (uint256)",
    "function recipientCount() view returns (uint256)",
  ], provider);
  const [p, d, n] = await Promise.all([c.pending(), c.totalDistributed(), c.recipientCount()]);
  return { pending: Number(ethers.formatUnits(p, 18)), dist: Number(ethers.formatUnits(d, 18)), n: Number(n) };
}

// ---- keyboards ----
const mainKb = (isPrivate) => ({
  inline_keyboard: [
    isPrivate
      ? [{ text: "Make a PFP", web_app: { url: `${SITE}/pfp` } }]
      : [{ text: "Make a PFP", url: `${SITE}/pfp` }],
    [{ text: "Open Swap", url: `${SITE}/swap` }, { text: "Chart", url: `https://dexscreener.com/robinhood/${POOL}` }],
    [{ text: "How to Buy", url: `${SITE}/#buy` }, { text: "Memes", url: `${SITE}/memes.html` }],
  ],
});

// ---- command handlers ----
async function onText(msg) {
  const chat = msg.chat.id;
  const isPrivate = msg.chat.type === "private";
  const cmd = (msg.text || "").trim().split(/\s+/)[0].replace(/@.*$/, "").toLowerCase();

  if (cmd === "/start" || cmd === "/help") {
    return send(chat,
      "<b>CashCats LLC</b> — the original name, now a token on Robinhood Chain.\n\n" +
      "• <b>Make a PFP</b> — the cash-cat studio\n" +
      "• <b>Swap</b> — buy/sell any token; 1% of every buy is a dividend to holders\n" +
      "• /price · /rewards · /airdrop · /ca\n\n" +
      "Tap below to get started.", { reply_markup: mainKb(isPrivate) });
  }
  if (cmd === "/pfp") {
    return send(chat, "Build your cash-cat PFP — pick a base, stack traits, send it to the chat.",
      { reply_markup: { inline_keyboard: [[isPrivate ? { text: "Open PFP Studio", web_app: { url: `${SITE}/pfp` } } : { text: "Open PFP Studio", url: `${SITE}/pfp` }]] } });
  }
  if (cmd === "/swap") {
    return send(chat, "Trade any token on Robinhood Chain. Opens in your browser — connect your wallet there.",
      { reply_markup: { inline_keyboard: [[{ text: "Open CashCats Swap", url: `${SITE}/swap` }]] } });
  }
  if (cmd === "/ca") {
    return send(chat, `$CASHCATSLLC contract:\n<code>${CA}</code>\n\nAlways verify against ${SITE}`,
      { reply_markup: { inline_keyboard: [[{ text: "Explorer", url: `${EXPLORER}/token/${CA}` }]] } });
  }
  if (cmd === "/privacy") {
    return send(chat, `Privacy policy: ${SITE}/privacy`);
  }
  if (cmd === "/price") {
    const p = await price();
    if (!p) return send(chat, "Couldn't fetch the price right now — try again shortly.");
    const arrow = (p.ch >= 0 ? "▲ +" : "▼ ") + Number(p.ch).toFixed(1) + "%";
    return send(chat,
      `<b>$CASHCATSLLC</b>\nPrice: <b>$${Number(p.price).toPrecision(3)}</b>  (${arrow} 24h)\n` +
      `Market cap: $${fmt(p.mc)}\n24h volume: $${fmt(p.vol)}`,
      { reply_markup: { inline_keyboard: [[{ text: "Chart", url: p.url || `https://dexscreener.com/robinhood/${POOL}` }, { text: "Buy", url: `${SITE}/swap` }]] } });
  }
  if (cmd === "/rewards" || cmd === "/burn" || cmd === "/dividend") {
    try {
      const pool = await balOf(REWARDS);
      return send(chat,
        `<b>Holder rewards pool</b>\n<b>${fmt(pool)}</b> $CASHCATSLLC waiting to be airdropped to holders.\n` +
        `Funded by the 1% fee on every buy.`,
        { reply_markup: { inline_keyboard: [[{ text: "Rewards wallet", url: `${EXPLORER}/address/${REWARDS}` }]] } });
    } catch { return send(chat, "Couldn't read the rewards pool right now."); }
  }
  if (cmd === "/airdrop") {
    try {
      const s = await airdropState();
      return send(chat,
        `<b>Cash Cat holder airdrop</b>\nRecipients: <b>${s.n}</b> top Cash Cat holders\n` +
        `Waiting to distribute: <b>${fmt(s.pending)}</b> $CASHCATSLLC\n` +
        `Distributed so far: <b>${fmt(s.dist)}</b>`,
        { reply_markup: { inline_keyboard: [[{ text: "Airdrop contract", url: `${EXPLORER}/address/${AIRDROP}` }]] } });
    } catch { return send(chat, "Couldn't read the airdrop contract right now."); }
  }
}

// ---- startup: menu button + command list ----
async function setup() {
  await api("setChatMenuButton", { menu_button: { type: "web_app", text: "PFP Studio", web_app: { url: `${SITE}/pfp` } } });
  await api("setMyCommands", { commands: [
    { command: "start", description: "Home / menu" },
    { command: "pfp", description: "Open the PFP studio" },
    { command: "swap", description: "Open the CashCats Swap" },
    { command: "price", description: "$CASHCATSLLC price" },
    { command: "rewards", description: "Holder rewards pool" },
    { command: "airdrop", description: "Cash Cat holder airdrop status" },
    { command: "ca", description: "Contract address" },
    { command: "privacy", description: "Privacy policy" },
  ] });
}

// ---- long-poll loop ----
(async () => {
  await api("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
  await setup();
  const me = await api("getMe", {});
  console.log("cashcats-bot live as @" + (me.result?.username || "?"));
  let offset = 0;
  for (;;) {
    try {
      const r = await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] });
      for (const u of (r.result || [])) {
        offset = u.update_id + 1;
        if (u.message && u.message.text) onText(u.message).catch((e) => console.error("handler:", e.message));
      }
    } catch (e) { console.error("poll:", e.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
})();
