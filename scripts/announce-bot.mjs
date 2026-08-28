#!/usr/bin/env node
/* ============================================================
   CashCats announce bot — run on your server (needs: npm i ethers)

   NOTE: this job is now built into cashcats-bot.mjs (set CHAT_ID there and
   it announces + serves commands + AI chat from one process). Use this
   standalone file only if you want announcements running separately from
   the main bot — don't run both against the same CHAT_ID or posts double up.

   Watches Robinhood Chain and posts to Telegram when:
     • an AIRDROP happens   — the CashCatsAirdrop contract emits Distributed()
     • a DIVIDEND lands      — $CASHCATSLLC is bought into the rewards wallet
                               (the swap's 1% fee), above MIN_DIVIDEND

   Setup:
     export BOT_TOKEN=123456:AA...        # your Telegram bot token
     export CHAT_ID=-1001234567890        # the group/channel to post in
     # optional: export MIN_DIVIDEND=50000   RPC=...   POLL_MS=45000
     node scripts/announce-bot.mjs

   Finding CHAT_ID: add the bot to your group, send any message there, then run
   this once WITHOUT CHAT_ID set — it prints the recent chat IDs it can see.
   Runs forever; keep it alive with pm2/systemd like your other bots.
   ============================================================ */
import { ethers } from "ethers";
import fs from "node:fs";

const RPC        = process.env.RPC || "https://rpc.mainnet.chain.robinhood.com";
const BOT_TOKEN  = process.env.BOT_TOKEN;
const CHAT_ID    = process.env.CHAT_ID || "-1003943929799"; // @CashCatsLLCCommunity (override with env)
const POLL_MS    = Number(process.env.POLL_MS || 45000);
const MIN_DIV    = BigInt(Math.round(Number(process.env.MIN_DIVIDEND || 50000))) * 10n ** 18n;

const AIRDROP    = "0xeb317Df4f06fa6DdFB7800C43E11f317715Eeb9E"; // CashCatsAirdrop
const REWARDS    = "0xed86b5eb83476f7b710e8037f5a84d8624288db7"; // dividend / rewards wallet
const TOKEN      = "0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc"; // $CASHCATSLLC
const EXPLORER   = "https://robinhoodchain.blockscout.com";
const STATE_FILE = "announce-state.json";

const DISTRIBUTED = ethers.id("Distributed(uint256,uint256)");
const TRANSFER    = ethers.id("Transfer(address,address,uint256)");
const padTopic    = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const fmt = (wei) => Number(ethers.formatUnits(wei, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 });

if (!BOT_TOKEN) { console.error("Set BOT_TOKEN"); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC, 4663);

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}
async function announce(text) {
  if (!CHAT_ID) { console.log("[no CHAT_ID] would post:\n" + text + "\n"); return; }
  const j = await tg("sendMessage", { chat_id: CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true });
  if (!j.ok) console.error("telegram error:", j.description);
}

// If CHAT_ID isn't set, help the operator discover it, then exit.
async function printChatIds() {
  const j = await tg("getUpdates", {});
  const seen = new Set();
  for (const u of (j.result || [])) {
    const c = (u.message || u.channel_post || {}).chat;
    if (c && !seen.has(c.id)) { seen.add(c.id); console.log(`CHAT_ID=${c.id}  (${c.title || c.type})`); }
  }
  if (!seen.size) console.log("No chats seen yet — add the bot to your group and send a message there, then re-run.");
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return null; } }
function saveState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) {} }

async function tick(state) {
  const latest = await provider.getBlockNumber();
  if (latest <= state.block) return state;
  const from = state.block + 1, to = latest;

  // 1) airdrops
  const airLogs = await provider.getLogs({ address: AIRDROP, topics: [DISTRIBUTED], fromBlock: from, toBlock: to }).catch(() => []);
  for (const l of airLogs) {
    const [amount, count] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], l.data);
    await announce(
      `🐱💸 <b>Airdrop sent!</b>\n<b>${fmt(amount)}</b> $CASHCATSLLC just went out to <b>${count}</b> Cash Cat holders.\n<a href="${EXPLORER}/tx/${l.transactionHash}">view tx</a>`
    );
  }

  // 2) dividend buys landing in the rewards wallet (Transfer of $CASHCATSLLC -> REWARDS)
  const divLogs = await provider.getLogs({ address: TOKEN, topics: [TRANSFER, null, padTopic(REWARDS)], fromBlock: from, toBlock: to }).catch(() => []);
  for (const l of divLogs) {
    const amount = BigInt(l.data);
    if (amount < MIN_DIV) continue;
    const from_ = "0x" + l.topics[1].slice(26);
    if (from_.toLowerCase() === AIRDROP.toLowerCase()) continue; // ignore the airdrop's own routing if any
    const pool = await new ethers.Contract(TOKEN, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(REWARDS);
    await announce(
      `🔥 <b>Dividend collected</b>\n<b>${fmt(amount)}</b> $CASHCATSLLC bought for holders.\nRewards pool now holds <b>${fmt(pool)}</b>, waiting to be airdropped.\n<a href="${EXPLORER}/tx/${l.transactionHash}">view tx</a>`
    );
  }

  const ns = { block: to };
  saveState(ns);
  return ns;
}

(async () => {
  if (!CHAT_ID) { await printChatIds(); return; }
  let state = loadState();
  if (!state) { state = { block: await provider.getBlockNumber() }; saveState(state); }
  console.log(`announce-bot live. watching from block ${state.block}. airdrop=${AIRDROP} rewards=${REWARDS}`);
  for (;;) {
    try { state = await tick(state); } catch (e) { console.error("tick error:", e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
