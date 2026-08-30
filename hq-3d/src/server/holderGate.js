/*
 * Holder gate.
 *
 * 100,000 $CASHCATSLLC to enter the world at all, 10,000,000 for The Vault.
 *
 * The check has to happen on the server, at join, against the chain. A hidden
 * door is not a gate — anyone can walk through a door the server already let
 * them past, and anyone can edit a client. So the flow is:
 *
 *   1. GET  /api/gate/nonce   -> a single-use nonce with a short TTL
 *   2. the holder signs that nonce with their wallet (EIP-191 personal_sign)
 *   3. POST /api/gate/verify  -> we recover the signer, confirm it matches the
 *      claimed address, read balanceOf on chain, and mint a short-lived JWT
 *      "pass" carrying the address and tier
 *   4. the pass is handed to the websocket as a query param and checked in
 *      ServerNetwork.onConnection before the player is ever spawned
 *
 * Signing proves the wallet is theirs. Without step 2 anyone could paste a
 * whale's address and walk in.
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { recoverMessageAddress } from 'viem'

const DEC = 10n ** 18n

// Off unless explicitly enabled, so a misconfigured deploy fails open to a
// world you can enter rather than one nobody can.
export const GATE_ENABLED = process.env.GATE_ENABLED === '1'

const TOKEN = (process.env.GATE_TOKEN || '0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc').toLowerCase()
const RPC = process.env.GATE_RPC || 'https://rpc.mainnet.chain.robinhood.com'
const ENTRY = BigInt(process.env.GATE_ENTRY || '100000') * DEC
const VIP = BigInt(process.env.GATE_VIP || '10000000') * DEC

const SECRET = process.env.JWT_SECRET
const NONCE_TTL = 5 * 60 * 1000
const PASS_TTL = '12h'

const nonces = new Map() // nonce -> expiry

function sweep() {
  const now = Date.now()
  for (const [n, exp] of nonces) {
    if (exp < now) nonces.delete(n)
  }
}

export function issueNonce() {
  sweep()
  const nonce = crypto.randomBytes(24).toString('hex')
  nonces.set(nonce, Date.now() + NONCE_TTL)
  return {
    nonce,
    // what the wallet will actually display, so the holder can read it
    message: `CashCats HQ\n\nSign in to prove this wallet is yours.\nThis does not authorise any transaction.\n\nNonce: ${nonce}`,
    expiresIn: NONCE_TTL / 1000,
  }
}

export async function balanceOf(address) {
  const data = '0x70a08231' + address.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: TOKEN, data }, 'latest'] }),
  })
  if (!res.ok) throw new Error(`rpc ${res.status}`)
  const json = await res.json()
  if (!json?.result || json.error) throw new Error(json?.error?.message || 'rpc returned no result')
  return BigInt(json.result)
}

export function tierFor(balance) {
  if (balance >= VIP) return 'vip'
  if (balance >= ENTRY) return 'holder'
  return 'none'
}

/**
 * Verify a signature over one of our nonces and mint a pass.
 * Returns { ok, pass, tier, balance } or { ok: false, reason }.
 */
export async function verifyAndIssuePass({ address, signature, nonce }) {
  if (!SECRET) return { ok: false, reason: 'server_misconfigured' }
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return { ok: false, reason: 'bad_address' }
  }
  if (typeof signature !== 'string' || typeof nonce !== 'string') {
    return { ok: false, reason: 'bad_request' }
  }

  sweep()
  const exp = nonces.get(nonce)
  if (!exp) return { ok: false, reason: 'nonce_unknown_or_expired' }
  nonces.delete(nonce) // single use, whatever happens next

  const message = `CashCats HQ\n\nSign in to prove this wallet is yours.\nThis does not authorise any transaction.\n\nNonce: ${nonce}`
  let recovered
  try {
    recovered = await recoverMessageAddress({ message, signature })
  } catch (err) {
    return { ok: false, reason: 'bad_signature' }
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, reason: 'signature_mismatch' }
  }

  let balance
  try {
    balance = await balanceOf(address)
  } catch (err) {
    console.error('[gate] balance lookup failed:', err.message)
    return { ok: false, reason: 'chain_unreachable' }
  }

  const tier = tierFor(balance)
  if (tier === 'none') {
    return { ok: false, reason: 'below_threshold', balance: balance.toString(), need: ENTRY.toString() }
  }

  const pass = jwt.sign(
    { address: address.toLowerCase(), tier, balance: balance.toString() },
    SECRET,
    { expiresIn: PASS_TTL }
  )
  return { ok: true, pass, tier, balance: balance.toString() }
}

/** Verify a pass presented on the websocket. Returns the claims or null. */
export function readPass(pass) {
  if (!SECRET || typeof pass !== 'string' || !pass) return null
  try {
    const claims = jwt.verify(pass, SECRET)
    if (claims?.tier !== 'holder' && claims?.tier !== 'vip') return null
    return claims
  } catch (err) {
    return null
  }
}

export const thresholds = { entry: ENTRY, vip: VIP }
