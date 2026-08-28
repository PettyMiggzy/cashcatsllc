#!/usr/bin/env node
/* ============================================================
   Snapshot the top-N holders of the original Cash Cat token and print the
   constructor arguments for CashCatsAirdrop.sol.

   Pulls holders from the Blockscout explorer (which already indexes all 93k+
   holders), skips contracts (LP pool, routers, etc.) and a small exclude list,
   and outputs the top-N EOAs plus their balances as pro-rata weights.

     node scripts/snapshot-cashcat-top30.mjs            # top 30, pro-rata weights
     node scripts/snapshot-cashcat-top30.mjs --top 30 --equal   # equal weights

   Writes cashcat-top30.json and prints ready-to-paste Solidity arrays.
   Re-run right before you deploy so the snapshot is fresh.
   ============================================================ */

const CASHCAT = "0x020bfC650A365f8BB26819deAAbF3E21291018b4"; // original Cash Cat (holders source)
const EXPLORER = "https://robinhoodchain.blockscout.com";

// Never airdrop to these (burn, pool/LP, routers, your own wallets). Contracts
// are also auto-skipped via the explorer's is_contract flag.
const EXCLUDE = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0x8366a39cc670b4001a1121b8f6a443a643e40951", // V4 PoolManager (LP)
  "0x8876789976decbfcbbbe364623c63652db8c0904", // UniversalRouter
  "0xed86b5eb83476f7b710e8037f5a84d8624288db7", // team / rewards wallet
].map((a) => a.toLowerCase()));

const argv = process.argv.slice(2);
const TOP = Number((argv.indexOf("--top") >= 0 && argv[argv.indexOf("--top") + 1]) || 30);
const EQUAL = argv.includes("--equal");

(async () => {
  let url = `${EXPLORER}/api/v2/tokens/${CASHCAT}/holders`;
  const holders = [];
  let pages = 0;
  while (url && pages < 6 && holders.length < TOP + 20) {
    const j = await (await fetch(url)).json();
    pages++;
    for (const it of j.items || []) {
      const a = it.address.hash;
      if (it.address.is_contract) continue;
      if (EXCLUDE.has(a.toLowerCase())) continue;
      holders.push({ addr: a, bal: BigInt(it.value) });
    }
    const np = j.next_page_params;
    url = np ? `${EXPLORER}/api/v2/tokens/${CASHCAT}/holders?` + new URLSearchParams(np).toString() : null;
  }

  const top = holders.slice(0, TOP);
  if (top.length < TOP) console.error(`warning: only found ${top.length} eligible holders`);

  const addrs = top.map((h) => h.addr);
  const weights = top.map((h) => (EQUAL ? 1n : h.bal));

  // human table
  console.log(`\nTop ${top.length} Cash Cat holders (${EQUAL ? "equal weights" : "pro-rata by balance"}):\n`);
  top.forEach((h, i) =>
    console.log(String(i + 1).padStart(2), h.addr, (Number(h.bal) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(16)));

  // ready-to-paste Solidity constructor args
  console.log("\n--- constructor arg: address[] recipients ---");
  console.log("[" + addrs.map((a) => `\n  ${a}`).join(",") + "\n]");
  console.log("\n--- constructor arg: uint256[] weights ---");
  console.log("[" + weights.map((w) => `\n  ${w.toString()}`).join(",") + "\n]");

  const fs = await import("node:fs");
  fs.writeFileSync("cashcat-top30.json", JSON.stringify({
    token_to_distribute: "0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc",
    holders_source: CASHCAT,
    mode: EQUAL ? "equal" : "prorata",
    count: top.length,
    recipients: addrs,
    weights: weights.map((w) => w.toString()),
  }, null, 2));
  console.log("\nwritten to cashcat-top30.json");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
