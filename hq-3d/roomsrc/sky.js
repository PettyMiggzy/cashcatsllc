/*
 * World of CashCats — the sky
 *
 * This app owns the lighting rig for the entire world, and it is the only
 * thing that does. It was six lines buried on line 44 of campus.js, in the
 * middle of the plaza geometry, which is a bad place for it now that weather
 * is coming.
 *
 * THE ONE THING TO KNOW BEFORE BUILDING WEATHER HERE
 *
 * Hyperfy has no light nodes. None. There is no sun object, no point light,
 * no directional light you can dim. Every surface in every room — the plaza,
 * the Vault's marble, the inside of the Filing Office — is lit entirely by
 * `scene.environment`, which is the HDRI set below. `sunDirection`,
 * `sunIntensity` and `sunColor` here do not create a light; they steer the
 * sky shader and the shadow direction.
 *
 * So "overcast" is not a grey filter and "night" is not turning the sun off.
 * Each weather state is a different HDRI plus its matching fog and sun tuning,
 * and swapping the HDRI relights every interior at the same time. That is the
 * whole system, and it is genuinely cheap: every knob below is settable at
 * runtime on the same node.
 *
 * Fetching more skies costs nothing — roomsrc/fetch_sky.py pulls CC0 HDRIs
 * from Poly Haven by name, and STATES below is where they get named. Adding
 * one is a row in that table and a file, not a change to any room.
 *
 * The server picks the state and tells the clients, so everyone is standing
 * under the same weather. A client that decides its own is a client where two
 * players describe different worlds to each other.
 */

const isServer = world.isServer

/* Each state is a complete lighting rig. `hdr` and `bg` name props — see
 * TEXTURES in texprops.py — so a new sky is a file plus a row here. */
const STATES = {
  clear: {
    bg: 'skyBg', hdr: 'skyHdr',
    // 1.6 clipped every pale surface in the world to white — the quarry face,
    // the nature-kit stone, the trees. This is a pure-sky HDRI with no ground
    // bounce, so it is already flat and bright before the sun is added.
    sun: [-0.4, -0.8, -0.5], intensity: 1.15, sunColor: '#ffeecb',
    fogNear: 60, fogFar: 380, fogColor: '#cfd8d0',
  },
}
const DEFAULT = 'clear'

const sky = app.create('sky')
app.add(sky)

function apply(name) {
  const s = STATES[name] || STATES[DEFAULT]
  if (props[s.bg])  sky.bg  = props[s.bg].url
  if (props[s.hdr]) sky.hdr = props[s.hdr].url
  sky.sunDirection = new Vector3(s.sun[0], s.sun[1], s.sun[2])
  sky.sunIntensity = s.intensity
  sky.sunColor = s.sunColor
  sky.fogNear = s.fogNear
  sky.fogFar = s.fogFar
  sky.fogColor = s.fogColor
}

apply(DEFAULT)

if (isServer) {
  // world.get/set is the server's persisted store, so whatever weather is
  // running survives a restart rather than snapping back to clear.
  const KEY = 'ccl.weather'
  let state = world.get(KEY) || DEFAULT
  if (!STATES[state]) state = DEFAULT
  apply(state)
  // A late joiner has missed every broadcast, so it asks.
  app.on('sky?', (d, pid) => app.sendTo(pid, 'sky', { s: state }))
  // Whatever drives weather calls this. Nothing does yet, on purpose.
  app.on('sky!', d => {
    const next = d && d.s
    if (!STATES[next] || next === state) return
    state = next
    world.set(KEY, state)
    apply(state)
    app.send('sky', { s: state })
  })
} else {
  app.on('sky', d => apply(d && d.s))
  app.send('sky?', {})
}
