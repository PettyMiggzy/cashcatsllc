# CashCats Swap — Buy & Burn engine

Two small contracts make the site's "every fee burns a cat" claim real. The
$CASHCATSLLC token itself is never touched (tax stays 0/0) — the fee and the
burn live entirely in this swap layer.

```
User → CashCatsFeeRouter.buyWithFee()
          ├─ 1% fee (ETH) ─→ CashCatsBuyBurn   (accumulates)
          └─ 99% ─→ DEX router → user gets their tokens

Anyone → CashCatsBuyBurn.buyAndBurn()
          └─ swaps accumulated ETH → $CASHCATSLLC → 0x…dead (burned forever)
```

## What you need before deploying
1. **Router address** — the Uniswap-V2-style router deployed on Robinhood Chain
   (the one Robin Labs / the CASHCATSLLC pool trades against). The contracts use
   the V2 `swapExactETHForTokensSupportingFeeOnTransferTokens` interface. **If
   Robinhood Chain is Uniswap V4 only (no V2 router), these need to be ported to
   the V4 `UniversalRouter` / `PoolManager` interface — tell me and I'll rewrite
   them.**
2. **Treasury / deployer wallet** with ETH for gas. You keep the keys — I can't
   deploy or hold them from here.
3. `TOKEN` = `0x53a557a2a46083A3E9cD26ff4cdc4CC81DA809cc`.

## Deploy order
1. Deploy **CashCatsBuyBurn**(`router`, `TOKEN`).
2. Deploy **CashCatsFeeRouter**(`router`, `buyBurnAddress`).
3. (optional) `setFeeBps` if you want something other than 1% (hard-capped 3%).

## Wire it to the site
- In `index.html`, the **Open CashCats Swap** button (`#swapBtn`) currently points
  at Robin Labs as a placeholder. Once the router is deployed, swap it for a small
  ethers.js widget that calls `CashCatsFeeRouter.buyWithFee(token, minOut, to)`.
- The **live burn tracker** on the site already reads the real dead-address balance
  via Blockscout, so it will show burns the moment `buyAndBurn()` starts running —
  no extra wiring needed.

## Running the burn
`buyAndBurn()` is permissionless — the community can trigger it, or run a tiny
keeper (cron → `buyAndBurn` when the sink's ETH balance clears a threshold). Say
the word and I'll add a `keeper.js`.

## Before mainnet
Get these reviewed/tested (Foundry/Hardhat fork of Robinhood Chain). They're
intentionally minimal — no token custody, an ETH-only rescue hatch, a 3% fee cap
— but any contract holding value should be audited before real money hits it.
