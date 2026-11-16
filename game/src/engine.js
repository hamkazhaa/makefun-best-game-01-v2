// Boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. The player shoots hitscan weapons with spread,
// recoil and headshots; bots shoot back through the same hooks; the rounds
// module owns the match, money and the charge. ?shot=start|play|buy|end
// with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { DUSK } from './palette.js';
import { ARENA, buildPort } from './port.js';
import { makeInput } from './input.js';
import { makePlayer } from './actor.js';
import { GUNS, FRAG, buildViewmodel, freshLoadout, spreadNow, falloffAt } from './weapons.js';
import { makeOpponents } from './opponents.js';
import { makeEffects } from './effects.js';
import { makeHud } from './display.js';
import { makeAudio } from './synth.js';
import { makeMatch } from './rounds.js';
import { stageShot } from './staging.js';

const STEP = 1 / 60;
const FOV = 74;
const query = new URLSearchParams(window.location.search);
const shotName = query.get('shot');
const lowFx = query.get('lowfx') === '1'; // test affordance: no shadows, pixel ratio 1
const seed = Number.parseInt(query.get('seed') ?? '1', 10) || 1;

// Seeded RNG for shot scenes; live play uses Math.random.
function mulberry32(start) {
  let a = start;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shotName ? mulberry32(seed) : Math.random;

// ---- Renderer, scene, camera.
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(lowFx ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowFx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(DUSK.sky);
scene.fog = new THREE.Fog(new THREE.Color(DUSK.haze), 32, 100);
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

// ---- World and subsystems.
const port = buildPort(scene);
const audio = makeAudio();
const fx = makeEffects(scene, port.solids);
const player = makePlayer(port.solids, ARENA.vanguardSpawns[0]);
const loadout = freshLoadout();
const owned = new Set(['pistol']);
let viewmodel = buildViewmodel(camera, 'pistol');
let viewKick = 0;

const hud = makeHud({
  onPlay: () => {
    audio.unlock();
    if (match.state.phase === 'menu') {
      match.beginMatch();
      hud.hideOverlay(); // buy menu is the active UI now; B locks the mouse in
    } else if (match.state.phase === 'roundEnd' || match.state.phase === 'matchEnd') {
      match.advance();
      hud.hideOverlay();
    } else {
      input.grab();
    }
  },
  onBuy: (id) => {
    if (match.purchase(id)) refreshGunHud();
  },
});

const raycaster = new THREE.Raycaster();
raycaster.far = 140;
const shootables = port.targets;
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const muzzle = new THREE.Vector3();
let trauma = 0;
let elapsed = 0;
let frozen = false;
let staging = false; // true while a ?shot= scene is being set up: bots hold still
let lastTime = performance.now();
let accumulator = 0;
let minimapAt = 0;
const seenFoes = new Map(); // bot id -> {x, z, at}

// ---- Weapon / HUD helpers.

function refreshGunHud() {
  const gun = GUNS[loadout.id];
  hud.setAmmo(loadout.mag, loadout.spare, loadout.reloading);
  hud.setMoney(match.state.cash);
}

function equipGun(id) {
  if (!owned.has(id)) owned.add(id);
  camera.remove(viewmodel);
  loadout.id = id;
  loadout.mag = GUNS[id].magSize;
  loadout.spare = GUNS[id].spare;
  loadout.reloading = false;
  loadout.bloom = 0;
  viewmodel = buildViewmodel(camera, id);
  refreshGunHud();
}

function reloadGun() {
  const gun = GUNS[loadout.id];
  const full = loadout.mag === gun.magSize;
  if (loadout.reloading || full || loadout.spare <= 0) return;
  loadout.reloading = true;
  loadout.reloadAt = elapsed + gun.reload;
  audio.reload();
  hud.setAmmo(loadout.mag, loadout.spare, true);
}

// ---- Damage.

function hurtPlayer(amount, fromBot, headshot) {
  if (!player.rig.alive || match.state.phase !== 'play') return;
  const soaked = Math.min(player.rig.armor, amount * 0.5);
  player.rig.armor -= soaked;
  player.rig.health -= amount - soaked;
  hud.damageFlash();
  hud.setHealth(player.rig.health, player.rig.armor);
  audio.hurt();
  trauma = Math.min(1, trauma + 0.35);
  if (player.rig.health <= 0) {
    player.rig.health = 0;
    player.rig.alive = false;
    input.drop();
    match.recordKill(fromBot.team, fromBot.name, 'vanguard', 'You', headshot);
    hud.announce('You are down — your team fights on');
  }
}

function hurtBot(bot, amount, part) {
  const killed = bots.hurt(bot, amount, part);
  if (killed) {
    match.recordKill('vanguard', 'You', 'ember', bot.name, part === 'head');
    hud.hitMarker(true, shotName ? 4000 : 110);
    audio.kill();
  }
  return killed;
}

// ---- Bots, wired to the same hooks the player uses.

const bots = makeOpponents(scene, port, {
  hitPlayer: (damage, bot, head) => hurtPlayer(damage, bot, head),
  hitBot: (shooter, victim, damage, head) => {
    if (!victim || !victim.alive) return;
    const killed = bots.hurt(victim, damage, head ? 'head' : 'body');
    if (killed) match.recordKill(shooter.team, shooter.name, victim.team, victim.name, head);
  },
  trace: (from, to) => fx.trace(from, to),
  shotHeard: (bot, dist) => {
    if (dist < 40) audio.distantShot();
  },
  planted: (bot) => match.botPlanted(bot),
  defused: () => match.botDefused(),
});

// ---- Match, with the charge-detonation side effects.

const match = makeMatch({
  player,
  bots,
  hud,
  audio,
  loadout,
  swapGun: equipGun,
  onDetonate(planted) {
    fx.detonate(new THREE.Vector3(planted.x, 1, planted.z));
    audio.explosion();
    trauma = 1;
    for (const bot of bots.roster) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.pos.x - planted.x, bot.pos.z - planted.z);
      if (d < 8) {
        const killed = bots.hurt(bot, d < 4 ? 200 : 90, 'body');
        if (killed) match.recordKill('vanguard', 'Charge', bot.team, bot.name, false);
      }
    }
    if (player.rig.alive) {
      const d = Math.hypot(player.rig.pos.x - planted.x, player.rig.pos.z - planted.z);
      if (d < 8) hurtPlayer(d < 4 ? 200 : 90, { team: 'vanguard', name: 'Charge' }, false);
    }
  },
});

// ---- Input wiring.

const input = makeInput(renderer.domElement, (grabbed) => {
  if (shotName) return;
  if (grabbed) hud.hideOverlay();
  else if (match.state.phase === 'play' || match.state.phase === 'buy') hud.showOverlay('paused');
});

// Click the game to grab the mouse when playing without pointer lock.
renderer.domElement.addEventListener('click', () => {
  if (shotName) return;
  const playing = match.state.phase === 'play' || match.state.phase === 'buy';
  if (playing && !input.grabbed()) {
    if (document.getElementById('shop').hidden) input.grab();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Camera and aiming.

function syncCamera() {
  const body = player.rig;
  if (body.alive) {
    camera.position.set(body.pos.x, body.pos.y + body.eye, body.pos.z);
    camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  }
  if (trauma > 0) {
    camera.rotation.x += (random() - 0.5) * trauma * 0.03;
    camera.rotation.z += (random() - 0.5) * trauma * 0.03;
  }
}

function aimAt(point) {
  const body = player.rig;
  const dx = point.x - body.pos.x;
  const dy = point.y - (body.pos.y + body.eye);
  const dz = point.z - body.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

// ---- Grenades.

function throwFrag() {
  const inPlay = match.state.phase === 'play';
  if (loadout.frags <= 0 || !inPlay) return;
  loadout.frags -= 1;
  audio.grenadePin();
  player.eyeAt(eyePos);
  camera.getWorldDirection(direction);
  fx.lob(eyePos, direction);
  hud.announce(`Frag out — ${loadout.frags} left`);
}

function burstFrag(at) {
  audio.explosion();
  trauma = Math.min(1, trauma + 0.5);
  for (const bot of bots.roster) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.pos.x - at.x, bot.pos.z - at.z);
    const inRange = d < 5;
    const visible = inRange && port.clearShot(at.x, at.y, at.z, bot.pos.x, bot.pos.y + 1, bot.pos.z);
    if (visible) {
      const dmg = Math.round(120 - (d / 5) * 90);
      const killed = bots.hurt(bot, dmg, 'body');
      if (killed) match.recordKill('vanguard', 'You', bot.team, bot.name, false);
    }
  }
  if (player.rig.alive) {
    const d = Math.hypot(player.rig.pos.x - at.x, player.rig.pos.z - at.z);
    if (d < 5) hurtPlayer(Math.round(120 - (d / 5) * 90), { team: 'ember', name: 'Frag' }, false);
  }
}

// ---- Shooting: one hitscan trigger pull, pellets and all.

function fireOnce() {
  const gun = GUNS[loadout.id];
  const now = elapsed;
  const tooSoon = now - loadout.lastFired < gun.interval;
  if (loadout.reloading || tooSoon) return false;
  if (loadout.mag <= 0) {
    audio.dryFire();
    loadout.lastFired = now;
    return false;
  }
  loadout.mag -= 1;
  loadout.lastFired = now;
  const heatGain = gun.id === 'smg' ? 0.09 : gun.id === 'rifle' ? 0.07 : gun.id === 'dmr' ? 0.1 : 0.12;
  loadout.bloom = Math.min(1, loadout.bloom + heatGain);
  const speed = player.speedOverGround();
  const spread = shotName ? 0 : spreadNow(gun, speed, player.rig.crouched, input.aiming);
  player.eyeAt(eyePos);
  camera.getWorldDirection(direction);
  muzzle.copy(eyePos).addScaledVector(direction, 0.6);
  muzzle.y -= 0.12;
  fx.flash(muzzle);
  audio.shot(gun.sfx);
  viewKick = 1;
  const pitchKick = gun.kick * (0.8 + random() * 0.4);
  const yawKick = (random() - 0.5) * gun.kick * 0.5;
  player.kickBack(pitchKick, yawKick);
  trauma = Math.min(1, trauma + gun.kick * 4);

  const pellets = gun.pellets || 1;
  let scoredHit = false;
  for (let p = 0; p < pellets; p += 1) {
    const ray = direction.clone();
    ray.x += (random() * 2 - 1) * spread;
    ray.y += (random() * 2 - 1) * spread;
    ray.z += (random() * 2 - 1) * spread;
    ray.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(eyePos, ray);
    const targets = shootables.concat(bots.shootMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) continue;
    fx.trace(muzzle, hit.point, shotName ? 4 : 0.07);
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const dist = hit.distance;
      const drop = falloffAt(gun, dist);
      const headMult = part === 'head' ? gun.head : 1;
      const legMult = part === 'legs' ? 0.75 : 1;
      const dmg = Math.round(gun.dmg * headMult * drop * legMult);
      hurtBot(bot, dmg, part);
      hud.hitMarker(part === 'head', shotName ? 4000 : 110);
      if (part === 'head') audio.headshot();
      else audio.hit();
      fx.burst(hit.point, 6, 0xe5484d);
      scoredHit = true;
    } else {
      fx.burst(hit.point, 5);
    }
  }
  if (loadout.mag === 0) refreshGunHud();
  else hud.setAmmo(loadout.mag, loadout.spare, false);
  return scoredHit;
}

// ---- The fixed step.

function handleKeys() {
  const switchCodes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
  const switchIds = ['rifle', 'dmr', 'smg', 'shotgun', 'sniper', 'pistol'];
  for (let i = 0; i < switchCodes.length; i += 1) {
    const code = switchCodes[i];
    const id = switchIds[i];
    if (input.tap(code) && owned.has(id) && id !== loadout.id) equipGun(id);
  }
  if (input.tap('KeyQ')) {
    const cycle = [...owned];
    const following = cycle[(cycle.indexOf(loadout.id) + 1) % cycle.length];
    equipGun(following);
  }
  if (input.tap('KeyR')) reloadGun();
  if (input.tap('KeyG')) throwFrag();
  if (input.tap('KeyB') && match.state.phase === 'buy') {
    const menu = document.getElementById('shop');
    if (menu.hidden) {
      hud.showBuy(match.state.cash, match.state.buyClock);
      input.drop();
    } else {
      hud.hideBuy();
      input.grab();
    }
  }
  if (input.tap('KeyM')) audio.toggle();
}

function refreshMinimap() {
  player.eyeAt(eyePos);
  for (const bot of bots.roster) {
    if (bot.team !== 'ember' || !bot.alive) continue;
    const d = Math.hypot(bot.pos.x - eyePos.x, bot.pos.z - eyePos.z);
    const near = d < 45;
    const seen = near && port.clearShot(eyePos.x, eyePos.y, eyePos.z, bot.pos.x, bot.pos.y + 1.2, bot.pos.z);
    if (seen) seenFoes.set(bot.id, { x: bot.pos.x, z: bot.pos.z, at: elapsed });
  }
  const allies = bots.roster
    .filter((b) => b.team === 'vanguard' && b.alive)
    .map((b) => ({ x: b.pos.x, z: b.pos.z }));
  const foes = [...seenFoes.values()].filter((e) => elapsed - e.at < 3);
  hud.drawMinimap({
    mapRects: port.mapRects,
    sites: ARENA.sites,
    planted: match.state.charge,
    allies,
    enemies: foes,
    player: { x: player.rig.pos.x, z: player.rig.pos.z, yaw: player.rig.yaw },
  });
}

function step(dt) {
  elapsed += dt;
  trauma = Math.max(0, trauma - dt * 2.2);
  viewKick = Math.max(0, viewKick - dt * 8);
  viewmodel.position.z = -0.5 + viewKick * 0.09;
  viewmodel.position.y = -0.24 - viewKick * 0.02;

  const held = input.held;
  const isAiming = input.aiming && player.rig.alive;
  const wantFov = isAiming ? FOV / GUNS[loadout.id].zoom : FOV;
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();

  handleKeys();

  if (match.state.phase === 'play' && player.rig.alive) {
    player.move(dt, held, isAiming);
    const gun = GUNS[loadout.id];
    const wantFire = gun.auto ? input.firing : input.tapTrigger();
    if (wantFire) fireOnce();
    match.channel(dt, held, player.rig.pos);
  } else if (match.state.phase === 'buy' && player.rig.alive) {
    player.move(dt, held, false);
  }

  if (loadout.reloading && elapsed >= loadout.reloadAt) {
    const gun = GUNS[loadout.id];
    const need = gun.magSize - loadout.mag;
    const take = Math.min(need, loadout.spare);
    loadout.mag += take;
    loadout.spare -= take;
    loadout.reloading = false;
    refreshGunHud();
  }
  loadout.bloom = Math.max(0, loadout.bloom - dt * 0.55);

  // Bots and match.
  player.eyeAt(eyePos);
  const ctx = match.scoutView(eyePos, player.speedOverGround());
  const botsActive = match.state.phase === 'play' || match.state.phase === 'buy';
  const wasBuy = match.state.phase === 'buy';
  if (!staging && botsActive) bots.tick(dt, elapsed, ctx);
  match.tick(dt);
  if (wasBuy && match.state.phase === 'play') audio.horn();
  fx.tick(dt);
  fx.stepFrags(dt, burstFrag);

  // Track enemies the player can see, for the minimap.
  minimapAt -= dt;
  if (minimapAt <= 0) {
    minimapAt = 0.25;
    refreshMinimap();
  }

  // HUD readouts.
  const gun = GUNS[loadout.id];
  hud.setHealth(player.rig.health, player.rig.armor);
  hud.setAmmo(loadout.mag, loadout.spare, loadout.reloading);
  const spread = spreadNow(gun, player.speedOverGround(), player.rig.crouched, isAiming);
  hud.setSpread(6 + spread * 900);
  hud.setAlive(match.teamAlive('vanguard'), match.teamAlive('ember'));
}

// ---- The render loop.

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const mouse = input.drainLook();
    const sense = input.aiming ? 0.0012 : 0.0021;
    const canLook = player.rig.alive && (match.state.phase === 'play' || match.state.phase === 'buy');
    if (canLook) player.turn(mouse.dx, mouse.dy, sense);
    accumulator += dt;
    let count = 0;
    while (accumulator >= STEP && count < 5) {
      step(STEP);
      accumulator -= STEP;
      count += 1;
    }
    if (accumulator > STEP * 5) accumulator = 0;
    // Spectate an alive ally when dead.
    const dead = !player.rig.alive && match.state.phase === 'play';
    if (dead) {
      const ally = bots.roster.find((b) => b.team === 'vanguard' && b.alive);
      if (ally) {
        camera.position.set(ally.pos.x, ally.pos.y + 1.55, ally.pos.z);
        camera.rotation.set(0, ally.yaw, 0, 'YXZ');
      }
    } else {
      syncCamera();
    }
  }
  renderer.render(scene, camera);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// ---- Boot.

hud.setHealth(100, 0);
hud.setAmmo(loadout.mag, loadout.spare, false);
hud.setMoney(match.state.cash);
hud.setScore(0, 0, 1);
hud.setTimer(100);
hud.setAlive(4, 4);
hud.setKills(0);
hud.showOverlay('start');
syncCamera();
// Read-only handle for automated playtests (and for the finalist review to
// inspect the live match): phase, round, scores, player and bot positions.
window.__game = {
  match: match.state,
  player: player.rig,
  bots: bots.roster,
  weapons: GUNS,
};
if (shotName) {
  staging = true;
  hud.hideOverlay();
  audio.unlock();
  stageShot(shotName, {
    match,
    player,
    bots,
    hud,
    audio,
    port,
    settle(steps) {
      for (let i = 0; i < steps; i += 1) step(STEP);
    },
    aimAt,
    equip: equipGun,
    fire: fireOnce,
  });
  hud.setAmmo(loadout.mag, loadout.spare, false);
  paintTwiceThenReady();
} else {
  requestAnimationFrame(frame);
}
