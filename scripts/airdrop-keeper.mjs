#!/usr/bin/env node
/* ============================================================
   CashCats airdrop KEEPER — run on your server (needs: npm i ethers)

   Watches the CashCatsAirdrop contract and automatically calls distribute()
   as soon as its $CASHCATSLLC balance crosses MIN_PENDING. So: whoever funds
   the contract, the payout to the 30 holders fires on its own within one poll.

   ERC-20 transfers can't trigger contract code, so on-chain auto-distribute is
   impossible — this keeper is the standard way to automate it.

   Setup:
     export PRIVATE_KEY=0x...          # KEEPER wallet — only needs a little ETH for gas.
                                        # distribute() is permissionless, so this wallet
                                        # needs NO ownership. Use a DEDICATED low-value
                                        # wallet, not your main/owner key.
     # optional: export MIN_PENDING=50000   POLL_MS=30000   RPC=...
     node scripts/airdrop-keeper.mjs

   Keep it alive with pm2/systemd. The announce bot (announce-bot.mjs) will post
   the "Airdrop sent" message when this fires.
   ============================================================ */
import { ethers } from "ethers";

const RPC     = process.env.RPC || "https://rpc.mainnet.chain.robinhood.com";
const PK      = process.env.PRIVATE_KEY;
const POLL_MS = Number(process.env.POLL_MS || 30000);
const MIN     = BigInt(Math.round(Number(process.env.MIN_PENDING || 50000))) * 10n ** 18n;

const AIRDROP = "0xeb317Df4f06fa6DdFB7800C43E11f317715Eeb9E";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const ABI = [
  "function pending() view returns (uint256)",
  "function distribute()",
  "function recipientCount() view returns (uint256)",
];

if (!PK) { console.error("Set PRIVATE_KEY (keeper wallet, gas only)."); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC, 4663);
const wallet = new ethers.Wallet(PK, provider);
const airdrop = new ethers.Contract(AIRDROP, ABI, wallet);
const fmt = (w) => Number(ethers.formatUnits(w, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 });

let busy = false; // don't overlap distribute() calls

async function tick() {
  if (busy) return;
  const pending = await airdrop.pending();
  if (pending < MIN) return;

  busy = true;
  try {
    // make sure the keeper can pay for gas
    const gasBal = await provider.getBalance(wallet.address);
    if (gasBal === 0n) { console.error("keeper has 0 ETH for gas — fund", wallet.address); return; }

    console.log(`pending ${fmt(pending)} >= min — distributing…`);
    const tx = await airdrop.distribute();
    console.log("distribute tx:", tx.hash, `${EXPLORER}/tx/${tx.hash}`);
    const rc = await tx.wait();
    console.log(rc.status === 1 ? `✓ airdropped ${fmt(pending)} $CASHCATSLLC` : "✗ distribute reverted");
  } catch (e) {
    // a race (balance drained by another caller) just reverts — safe to ignore and retry next tick
    console.error("distribute error:", e.shortMessage || e.message);
  } finally {
    busy = false;
  }
}

(async () => {
  const n = await airdrop.recipientCount();
  console.log(`airdrop-keeper live. contract=${AIRDROP} recipients=${n} min=${fmt(MIN)} keeper=${wallet.address}`);
  console.log(`keeper ETH: ${ethers.formatEther(await provider.getBalance(wallet.address))} — keep this topped up for gas.`);
  for (;;) {
    try { await tick(); } catch (e) { console.error("tick error:", e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
