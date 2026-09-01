/*
 * The wallet connect + sign page, served at /gate.
 *
 * Kept as a standalone page rather than folded into the React client on
 * purpose: it runs before the world loads, it is the only place a wallet is
 * ever touched, and keeping it separate means the world bundle carries no
 * wallet code at all.
 *
 * It never asks for a transaction, only a signature over a server nonce.
 */
export function gatePage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>CashCats HQ — entry</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    background: #0e1f18; color: #e8f2ec; padding: 24px;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    width: min(520px, 100%); background: #12241c; border: 2px solid #a9812a;
    border-radius: 16px; padding: 32px;
  }
  h1 { margin: 0; font-size: 28px; color: #e8c25a; letter-spacing: .3px; }
  .sub { margin: 6px 0 0; color: #8fa39a; font-size: 14px; }
  .rule { margin: 24px 0; border: 0; border-top: 1px solid #24382e; }
  .tier { display: flex; justify-content: space-between; padding: 7px 0; font-size: 14px; }
  .tier span:last-child { color: #e8c25a; font-weight: 600; }
  button {
    width: 100%; margin-top: 22px; padding: 14px 18px; font-size: 16px; font-weight: 600;
    color: #0e1f18; background: #e8c25a; border: 0; border-radius: 10px; cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: default; }
  .msg { margin-top: 18px; font-size: 14px; min-height: 22px; }
  .err { color: #e08a6a; }
  .ok  { color: #2ecc71; }
  .foot { margin-top: 22px; color: #5f7168; font-size: 12.5px; }
  code { color: #8fa39a; }
</style>
</head>
<body>
  <div class="card">
    <h1>CashCats HQ</h1>
    <p class="sub">Holder-gated. Your balance is checked on the server.</p>
    <hr class="rule" />
    <div class="tier"><span>Enter the world</span><span>100,000 $CASHCATSLLC</span></div>
    <div class="tier"><span>The Vault</span><span>10,000,000 $CASHCATSLLC</span></div>
    <button id="go">Connect wallet</button>
    <div class="msg" id="msg"></div>
    <p class="foot">
      You will be asked to <strong>sign a message</strong>, never to approve a
      transaction. The signature only proves the wallet is yours — without it
      anyone could type in a whale's address.
    </p>
  </div>
<script>
const btn = document.getElementById('go')
const msg = document.getElementById('msg')
const say = (t, cls) => { msg.textContent = t; msg.className = 'msg ' + (cls || '') }

btn.onclick = async () => {
  if (!window.ethereum) {
    return say('No wallet found in this browser. Open this page in a wallet browser or install one.', 'err')
  }
  btn.disabled = true
  try {
    say('Waiting for the wallet…')
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })

    say('Fetching a nonce…')
    const n = await (await fetch('/api/gate/nonce')).json()
    if (!n.enabled) throw new Error('The gate is switched off on this server.')

    say('Check your wallet and sign the message…')
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [n.message, address],
    })

    say('Checking your balance on chain…')
    const res = await fetch('/api/gate/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature, nonce: n.nonce }),
    })
    const out = await res.json()

    if (!out.ok) {
      if (out.reason === 'below_threshold') {
        const held = (BigInt(out.balance) / (10n ** 18n)).toLocaleString('en-US')
        const need = (BigInt(out.need) / (10n ** 18n)).toLocaleString('en-US')
        throw new Error('You hold ' + held + ' $CASHCATSLLC. Entry needs ' + need + '.')
      }
      throw new Error(out.reason.replace(/_/g, ' '))
    }

    // Written through JSON.stringify because that is how it is read back:
    // ClientNetwork does storage.get('cashcatsPass'), and core/storage.js
    // JSON.parses whatever it finds. A bare JWT is not valid JSON, so the
    // parse threw, the pass was discarded, and a holder who had just passed
    // the balance check arrived in the world as a non-holder. With the gate
    // off everyone gets into the Vault; with it on, nobody did.
    localStorage.setItem('cashcatsPass', JSON.stringify(out.pass))
    const held = (BigInt(out.balance) / (10n ** 18n)).toLocaleString('en-US')
    say('In. ' + held + ' $CASHCATSLLC, tier ' + out.tier + '. Loading the world…', 'ok')
    setTimeout(() => { location.href = '/' }, 900)
  } catch (err) {
    say(err.message || String(err), 'err')
    btn.disabled = false
  }
}
</script>
</body>
</html>`
}
