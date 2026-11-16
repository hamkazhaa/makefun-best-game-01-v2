// Deterministic shot scenes: ?shot=start|play|buy|end with &seed=N
// stages one frame of the game for a screenshot capture. Each scene
// drives the live match into a fixed state, lets it settle for a few
// fixed steps, then the engine renders it twice and freezes it.
import * as THREE from 'three';
import { ARENA } from './port.js';

function stagePlayOrEnd(name, api) {
  const { match, player, bots, hud, port } = api;
  match.beginMatch();
  match.state.phase = 'play';
  match.state.clock = 82;
  hud.hideBuy();
  // Stage the scene: the player stands mid-lane, one Ember bot in the
  // sights, one ally covering the left lane, a second Ember bot further
  // up mid. The target bot goes to the first candidate spot with a clear
  // line of sight from the player.
  const foes = bots.roster.filter((b) => b.team === 'ember');
  const mate = bots.roster.find((b) => b.team === 'vanguard');
  // Stand on the east side of mid-lane, clear of the fuel depot, so the
  // frame shows the lane, the target and the bridge — not a barrel.
  player.rig.pos.set(5, 0, 11);
  const spots = [[0, -4], [3, -2], [-2.5, -3], [-5, 0], [5, 2], [-1, 4], [6, -6], [-6, -4], [2, 0], [-3, 6], [0, -8]];
  let mark = null;
  if (foes[0]) {
    for (const [x, z] of spots) {
      const clear = port.clearShot(5, 1.6, 11, x, 1.3, z);
      if (clear) {
        foes[0].pos.set(x, 0, z);
        foes[0].yaw = Math.PI;
        foes[0].figure.group.position.copy(foes[0].pos);
        foes[0].figure.group.rotation.y = foes[0].yaw;
        mark = foes[0];
        break;
      }
    }
  }
  if (foes[1]) {
    foes[1].pos.set(5.5, 0, -7);
    foes[1].yaw = Math.PI * 0.9;
    foes[1].figure.group.position.copy(foes[1].pos);
    foes[1].figure.group.rotation.y = foes[1].yaw;
  }
  if (mate) {
    mate.pos.set(-6, 0, 6);
    mate.yaw = -0.3;
    mate.figure.group.position.copy(mate.pos);
    mate.figure.group.rotation.y = mate.yaw;
  }
  api.settle(15);
  if (name === 'play') {
    api.equip('rifle');
    if (mark) {
      api.aimAt(new THREE.Vector3(mark.pos.x, 1.1, mark.pos.z));
      api.fire(); // one torso hit: hitmarker, sparks and tracer, bot stays standing
    }
    api.settle(6);
    hud.setHealth(100, 0);
    hud.announce('Round 1 — plant the charge or eliminate Ember', 4000);
  } else {
    // Match won 7 : 4 after eleven rounds: the results screen with its
    // restart button, the round-history pips above it, and Site A behind.
    if (foes[0]) bots.hurt(foes[0], 500, 'body');
    if (foes[1]) bots.hurt(foes[1], 500, 'body');
    match.state.charge = { site: 'A', x: ARENA.sites.A.x, z: ARENA.sites.A.z, timer: 22 };
    match.state.scoreV = 7;
    match.state.scoreE = 4;
    match.state.round = 11;
    match.state.phase = 'matchEnd';
    match.state.log = ['V', 'E', 'V', 'V', 'E', 'V', 'E', 'V', 'E', 'V', 'V'];
    match.state.kills = 12;
    match.state.cash = 4150;
    hud.setScore(7, 4, 11);
    hud.setHistory(match.state.log);
    hud.setKills(12);
    hud.setMoney(4150);
    hud.setCharge(false);
    hud.clearAnnounce();
    player.rig.pos.set(-19, 0, -1);
    api.aimAt(new THREE.Vector3(ARENA.sites.A.x, 2, ARENA.sites.A.z));
    hud.showOverlay('match', {
      title: 'MATCH WON — THE DOCK IS YOURS',
      copy: 'Final score — Vanguard 7 : 4 Ember. You scored 12 kills and fell 3 times. Harbour Line will remember this one.',
    });
  }
  hud.setAlive(match.teamAlive('vanguard'), match.teamAlive('ember'));
}

export function stageShot(name, api) {
  const { match, player, hud } = api;
  if (name === 'start') {
    match.state.phase = 'menu';
    player.rig.pos.set(-2, 0, 14);
    player.rig.yaw = 0.15;
    player.rig.pitch = -0.01;
    api.settle(10);
    api.aimAt(new THREE.Vector3(0, 2, -6));
    hud.showOverlay('start');
    hud.setScore(0, 0, 1);
    hud.setMoney(800);
    hud.setHealth(100, 0);
    hud.setAmmo(12, 48, false);
    hud.setTimer(100);
  } else if (name === 'buy') {
    match.beginMatch();
    match.state.phase = 'buy';
    match.state.buyClock = 12;
    match.state.cash = 3200;
    player.rig.pos.set(0, 0, 15);
    player.rig.yaw = 0;
    api.settle(10);
    api.aimAt(new THREE.Vector3(0, 2, -8));
    hud.showBuy(3200, 12);
    hud.setMoney(3200);
  } else if (name === 'play' || name === 'end') {
    stagePlayOrEnd(name, api);
  }
}
