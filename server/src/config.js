'use strict';
// Every gameplay number lives here, so balance can be tuned without touching the game code.
module.exports = {
  WORLD: 16200,          // arena width and height
  GRID: 100,             // pellet grid cell size
  TICK_HZ: 25,           // simulation steps per second
  SEND_EVERY: 1,         // send a world update every step (25 updates per second)

  PELLETS: 2750,         // pellets kept on the map, each worth 14
  PELLET_MASS: 14,
  PELLET_REGROW: 150,    // pellets regrown per second, up to PELLETS
  SETTLED_EJECT_CAP: 6000, // ejected blobs that have stopped and lie on the map

  SPIKES: 26,
  SPIKE_LIFE: 19,        // seconds a needle lasts before it vanishes and a new one appears somewhere else...
  SPIKE_LIFE_JITTER: 4,  // ...give or take this many seconds, so they don't all change at once
  SPIKE_FEED: 9,         // blobs a needle must be fed before it shoots out a new needle
  SPIKE_DRAW_MASS: 640,  // spikes are exactly the size of the smallest orb that can burst on them (shown as 320)
  SPIKE_POP_MASS: 640,   // orbs at or above this burst on a spike (shown as 320); smaller orbs pass through
  SPIKE_GAIN: 400,       // mass a spike adds to the orb that swallows it
  SPIKE_PIECES: 5,

  START_MASS: 60000,     // every orb a player starts with (shown as 30,000)
  MIN_PIECE: 320,        // no orb is ever smaller than this (shown as 160); orbs can split from twice this
  MAX_PIECES: 16,
  MAX_MASS: 120000,      // an orb above this splits in two (shown as 60,000)
  EJECT_MASS: 16,
  EJECT_MIN_MS: 40,      // fastest allowed rapid feed
  SPEED: 1685,           // speed = SPEED * mass^-0.25
  SPLIT_SPEED: 806,      // launch speed of a split piece for small orbs...
  SPLIT_GROWTH: 0.5,     // ...bigger orbs launch a bit faster: 0 = same for all sizes, 1 = in proportion to size
  EAT_RATIO: 1.25,
  MERGE_BASE: 18,        // seconds split pieces must wait before they can join again...
  MERGE_PER_MASS: 0.004, // ...plus this many seconds per unit of piece mass...
  MERGE_MAX: 40,         // ...but never longer than this
  GROWTH_DEFAULT: 2,     // growth a player gets until they pick one
  GROWTH: 3,             // highest growth boost a player can pick (1x up to this): pellets give this many times their mass, eaten orbs give 1 + (growth-1)/2 times
  TEST_MASS: 70000,      // test mode (page opened with ?test=1): the first orb starts with this (shown as 35,000) and test players never lose mass

  BOT_MAX: 23,           // at most this many bots...
  BOT_FILL: 40,          // ...and fewer once real players fill the arena up to this many
  MAX_PLAYERS: 120,      // human players allowed at once
  SPAWN_PROTECT: 3,      // seconds a new orb cannot be eaten

  SPEC_ZOOM: 0.55,       // viewer mode zoom compared with a player's view (smaller = wider): 0.55 shows about 1.8x the area
  VIEW_SCALE: 1.0,       // how far past the screen a player can see (client/game.js has the same number)
};
