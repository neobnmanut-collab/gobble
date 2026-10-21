'use strict';
// Every gameplay number lives here, so balance can be tuned without touching the game code.
module.exports = {
  WORLD: 12000,          // arena width and height
  GRID: 100,             // pellet grid cell size
  TICK_HZ: 30,           // simulation steps per second
  SEND_EVERY: 1,         // send a world update every step (30 updates per second)

  PELLETS: 5500,         // pellets kept on the map
  PELLET_MASS: 7,
  PELLET_REGROW: 300,    // pellets regrown per second, up to PELLETS
  SETTLED_EJECT_CAP: 6000, // ejected blobs that have stopped and lie on the map

  SPIKES: 40,
  SPIKE_DRAW_MASS: 100,  // spikes look like an orb of this mass
  SPIKE_POP_MASS: 800,   // orbs at or above this burst on a spike
  SPIKE_GAIN: 400,       // mass a spike adds to the orb that swallows it
  SPIKE_PIECES: 5,

  START_MASS: 800,
  MIN_PIECE: 400,        // no orb is ever smaller than this
  MAX_PIECES: 12,
  MAX_MASS: 120000,      // an orb above this splits in two (shown as 60,000)
  EJECT_MASS: 16,
  EJECT_MIN_MS: 40,      // fastest allowed rapid feed
  SPEED: 1685,           // speed = SPEED * mass^-0.25
  SPLIT_SPEED: 806,
  EAT_RATIO: 1.25,
  MERGE_BASE: 18,        // seconds split pieces must wait before they can join again...
  MERGE_PER_MASS: 0.004, // ...plus this many seconds per unit of piece mass...
  MERGE_MAX: 40,         // ...but never longer than this
  GROWTH: 5,             // highest (and default) growth boost a player can pick, 1x to this: pellets give this many times their mass, eaten orbs give 1 + (GROWTH-1)/2 times (3x at 5)

  BOT_FILL: 40,          // bots fill the arena up to this many players
  MAX_PLAYERS: 120,      // human players allowed at once
  SPAWN_PROTECT: 3,      // seconds a new orb cannot be eaten

  VIEW_SCALE: 1.2,       // how far past the screen a player can see
};
