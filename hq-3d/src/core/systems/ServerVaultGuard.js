import { System } from './System'

/**
 * Server Vault Guard
 *
 * The Vault is a room inside the same world, so walking into it is not
 * something the client can be trusted to prevent. This watches the volume on
 * the server and teleports anyone without the vip tier back out to the gate.
 *
 * Positions arrive from the client, so they can be lied about — but lying
 * only ever moves you somewhere the server then reads and corrects. The
 * player's own view is authoritative for movement, not for permission.
 */

// The Vault sits at [0, 0, 32] and is 14 x 12, so the volume is inset by a
// little to catch anyone standing in the doorway.
const MIN_X = -7.6
const MAX_X = 7.6
const MIN_Z = 25.4
const MAX_Z = 38.6

// just outside the gate, looking back at the plaza
const EJECT = { position: [0, 0, 22.5], rotationY: Math.PI }

const CHECK_INTERVAL = 0.4 // seconds; positions only move so fast

export class ServerVaultGuard extends System {
  constructor(world) {
    super(world)
    this.since = 0
  }

  update(delta) {
    this.since += delta
    if (this.since < CHECK_INTERVAL) return
    this.since = 0

    const sockets = this.world.network?.sockets
    if (!sockets) return

    for (const socket of sockets.values()) {
      if (socket.tier === 'vip') continue
      const player = socket.player
      const p = player?.data?.position
      if (!p) continue
      const [x, , z] = p
      if (x < MIN_X || x > MAX_X || z < MIN_Z || z > MAX_Z) continue

      socket.send('playerTeleport', EJECT)
      // move the server's own copy too, so a client that ignores the packet
      // is still outside as far as everyone else is concerned
      player.data.position = EJECT.position.slice()

      /*
       * Escalate, because this check is advisory and cannot be anything else.
       *
       * Movement in this engine is client-authoritative: the position read
       * above is the one the client volunteered, and the server's own copy is
       * overwritten by that client's next position packet milliseconds later.
       * A client that simply declines to report being in the Vault is never
       * seen here at all, and one that ignores the teleport packet is bounced
       * on paper and standing still in practice.
       *
       * What that means is that a determined client cannot be kept out by this
       * alone — so the honest thing is to make persistence expensive rather
       * than pretend otherwise. Three ejections inside one session and the
       * socket goes. Anything that must actually be secret should not be sent
       * to a non-holder in the first place; a positional guard is a fence, not
       * a vault door.
       */
      socket.vaultHits = (socket.vaultHits || 0) + 1
      if (socket.vaultHits >= 3) {
        socket.send('kick', 'vault_gate')
        socket.disconnect?.()
        continue
      }
      // tell them why, once. world.chat.add() broadcasts to everyone, so
      // send the packet straight down this one socket instead.
      if (!socket.vaultWarned) {
        socket.vaultWarned = true
        socket.send('chatAdded', {
          id: `vault-${socket.id}-${Date.now()}`,
          from: 'HQ',
          body: 'The Vault needs 10,000,000 $CASHCATSLLC.',
          createdAt: new Date().toISOString(),
        })
      }
    }
  }
}
