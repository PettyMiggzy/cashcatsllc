# Cash Cat holder airdrop — `CashCatsAirdrop.sol`

On-chain distributor: **send `$CASHCATSLLC` to the contract, call `distribute()`,
and it splits the whole balance to the top-30 Cash Cat holders in one tx.**
Fund and re-run as many times as you like.

- Token distributed: `$CASHCATSLLC` `0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc`
- Recipients: top-30 holders of the original Cash Cat `0x020bfC650A365f8BB26819deAAbF3E21291018b4`
- Chain: Robinhood Chain (4663)

Unlike the other files in this folder, **this contract is meant to be deployed.**

## 1. Snapshot the recipients

```
node scripts/snapshot-cashcat-top30.mjs            # pro-rata by Cash Cat balance (default)
node scripts/snapshot-cashcat-top30.mjs --equal    # equal split (all weights = 1)
```

It prints the two constructor arrays (`recipients`, `weights`) and writes
`cashcat-top30.json`. It skips contracts (the LP pool, routers) and the team
wallet automatically. Re-run it right before you deploy so it's fresh.

**Pro-rata vs equal:** pro-rata rewards bigger OG holders proportionally — with
the current snapshot the #1 wallet (~83M CASHCAT) receives ~27% of every payout.
If you'd rather every one of the 30 get the same amount, deploy with `--equal`
weights.

## 2. Deploy

### Option A — one-shot script (server box)

`scripts/deploy-airdrop.mjs` has the bytecode + the 30 recipients + weights baked
in (compiled solc 0.8.26, optimizer runs 200, evmVersion paris). On your box:

```
npm i ethers
export PRIVATE_KEY=0x...        # deployer wallet = contract owner; needs Robinhood ETH for gas
node scripts/deploy-airdrop.mjs           # pro-rata weights (default)
node scripts/deploy-airdrop.mjs --equal   # equal split
unset PRIVATE_KEY
```

The key is read from the env var only — never hardcode it or commit it. Prefix
the command with a space to keep it out of shell history. The script prints the
deployed address and the exact constructor args + compiler settings for
verification. (The baked-in snapshot is current as of generation; re-run
`snapshot-cashcat-top30.mjs` and regenerate, or use `setRecipients`, to refresh.)

### Option B — your own toolchain

Deploy `CashCatsAirdrop.sol` with constructor args:

```
token      = 0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc
recipients = [ ...the 30 addresses... ]
weights    = [ ...the 30 weights...   ]
```

Any tool works (Remix in the browser is easiest): compile with Solidity ^0.8.20,
connect a wallet on Robinhood Chain, paste the arrays, deploy. Save the deployed
contract address.

## 3. Fund + distribute

1. Send however much `$CASHCATSLLC` you want to give out **to the contract address**.
2. Call `distribute()` — it pays out the contract's entire balance to the 30
   recipients, pro-rata by weight. The last recipient absorbs any rounding dust,
   so nothing is left stranded.
3. Top it up and call `distribute()` again whenever you want to do another round.

Views: `pending()` = balance waiting to be distributed, `totalDistributed()` =
lifetime total, `allRecipients()` = the current list.

## Admin

- `setRecipients(addrs, weights)` — refresh the top-30 after a new snapshot (owner).
- `rescue(token, to, amount)` — pull tokens back out / recover a wrong token (owner).
- `transferOwnership(next)` then `acceptOwnership()` — **two-step** handoff: the
  current owner nominates, and the new owner must call `acceptOwnership()` to
  finalize (so a typo'd address can't lock you out).

## Audit

Reviewed with two independent adversarial passes plus a clean solc 0.8.26
compile (no warnings). Reentrancy guard on `distribute`/`rescue`, safe-transfer
for non-standard ERC-20 returns, two-step ownership, checked math, and
remainder-to-last (no stranded dust) all verified. Residual notes are by design:
the owner is trusted (can `rescue`/`setRecipients`), and `distribute()` is
permissionless (can only ever pay the preset list). Still get your own review
before funding it with large value.

## Safety notes

- `distribute()` is permissionless but can **only** move the contract's own
  balance to the preset recipients — it can never touch anyone else's funds.
- Verify the `token` address and the recipient list before funding.
- Get the contract reviewed/audited before putting large value through it.
