# CashCats Buy & Burn — reference contracts (⚠ NOT for deployment as-is)

> **STOP — do not deploy these as written.** They will revert on every call.
>
> CASHCATSLLC (`0x53a557a2a46083A3E9cD26ff4cdc4CC81DA809cc`) is confirmed
> **Uniswap v4 only** — a native-ETH pool (fee 0, tickSpacing 200, hook
> `0x75A54357D9C78a2Db19004a5FDc76c50F9242AEC`). There is **no v2 or v3 pair**.
> These contracts route through a **Uniswap v2** router
> (`swapExactETHForTokensSupportingFeeOnTransferTokens`, path `[WETH, TOKEN]`),
> so `buyAndBurn()` and `buyWithFee(CASHCATSLLC, …)` revert 100% of the time —
> the v2 pair they trade against does not exist.

## The burn is already live — in the swap, not here

The site's **CashCats Swap** (`/swap/`) does the buy-and-burn **client-side, in
the same transaction as your buy**, with no treasury and no deployed contract:

```
Buy ETH → CASHCATSLLC on /swap/  (Uniswap v4 UniversalRouter)
   ├─ 99%  → you (your tokens)
   └─  1%  → re-buys CASHCATSLLC → 0x…dEaD   (burned, same tx)
```

That path is validated on-chain by eth_call simulation. So **no contract needs
to be deployed for the burn to work today.** These files remain only as a
reference for a *future* fully-on-chain / keeper-driven burn engine.

## If you ever want an autonomous on-chain burn engine

It must be rewritten for Uniswap **v4** before it can function:

1. Replace the `IV2Router` interface + `[WETH, TOKEN]` path with
   `UniversalRouter.execute(bytes commands, bytes[] inputs, uint256 deadline)`
   using a `V4_SWAP` command and the exact `PoolKey`:
   `currency0 = address(0)` (native ETH), `currency1 = TOKEN`, `fee = 0`,
   `tickSpacing = 200`, `hooks = 0x75A54357D9C78a2Db19004a5FDc76c50F9242AEC`.
   Account for the hook's behavior.
2. **Slippage:** do NOT ship a permissionless `buyAndBurn(amountOutMin)` with a
   caller-supplied floor — `buyAndBurn(0)` is a free MEV sandwich on the whole
   balance. Use a keeper that computes `minOut` off-chain, or a TWAP floor, and
   cap ETH swapped per call.
3. **Remove/gate the owner drain vectors:** `rescueETH` (drains all fees) and
   `setSink` (redirects all fees) make the "burn" funds rug-pullable. Timelock
   or renounce after setup; add zero-address checks.
4. Use two-step ownership (`Ownable2Step`) and a `ReentrancyGuard`.

Tell me and I'll write the v4 version. Until then, the swap-layer burn above is
the working mechanism — ship that, not these.
