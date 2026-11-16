// The armoury: six original guns plus a frag grenade. Each gun is one
// row of data — damage, fire rate, spread, recoil, reach, price — and one
// small viewmodel built from boxes, so the gun the player sees is the gun
// the code fires. Spread grows with movement and with sustained fire and
// shrinks when crouched or aiming down sights: stopping to aim pays. The
// Kestrel DMR is the new arrival this season: a semi-automatic marksman
// rifle that rewards a steady hand at long range.
import * as THREE from 'three';

// One row per gun. `reach` is the distance at which damage starts to fall
// off; past twice that it halves. `heat` is the bloom added per shot.
export const GUN_LIST = [
  { id: 'pistol', label: 'P9 Sidearm', kind: 'pistol', cost: 300, dmg: 34, head: 4, interval: 0.16, auto: false, magSize: 12, spare: 48, reload: 1.1, baseSpread: 0.011, moveSpread: 0.02, kick: 0.011, reach: 60, zoom: 1, sfx: 'pistol', blurb: 'Reliable sidearm. Free with every loadout.' },
  { id: 'smg', label: 'VK-9 Repeater', kind: 'smg', cost: 1500, dmg: 26, head: 4, interval: 0.075, auto: true, magSize: 25, spare: 100, reload: 1.6, baseSpread: 0.016, moveSpread: 0.028, kick: 0.008, reach: 45, zoom: 1, sfx: 'smg', blurb: 'Fast close-quarters spray. Punishes wild fire.' },
  { id: 'rifle', label: 'AR-77 Longshot', kind: 'rifle', cost: 2700, dmg: 33, head: 4, interval: 0.11, auto: true, magSize: 30, spare: 90, reload: 2.1, baseSpread: 0.008, moveSpread: 0.024, kick: 0.013, reach: 80, zoom: 1.15, sfx: 'rifle', blurb: 'The all-round rifle. Accurate when still.' },
  { id: 'dmr', label: 'Kestrel DMR', kind: 'dmr', cost: 3400, dmg: 55, head: 3, interval: 0.32, auto: false, magSize: 10, spare: 40, reload: 2.2, baseSpread: 0.004, moveSpread: 0.045, kick: 0.028, reach: 100, zoom: 2.2, sfx: 'dmr', blurb: 'Semi-auto marksman rifle. Two taps at range.' },
  { id: 'shotgun', label: 'M12 Breacher', kind: 'shotgun', cost: 1700, dmg: 12, head: 2, interval: 0.85, auto: false, pellets: 8, magSize: 6, spare: 24, reload: 2.4, baseSpread: 0.045, moveSpread: 0.02, kick: 0.035, reach: 22, zoom: 1, sfx: 'shotgun', blurb: 'Eight pellets. Devastating up close.' },
  { id: 'sniper', label: 'LR-90 Deadeye', kind: 'sniper', cost: 4750, dmg: 88, head: 2.2, interval: 1.15, auto: false, magSize: 5, spare: 15, reload: 2.8, baseSpread: 0.001, moveSpread: 0.06, kick: 0.05, reach: 120, zoom: 2.6, sfx: 'sniper', blurb: 'One shot, one kill — if you hold still.' },
];

export const GUNS = {};
for (const row of GUN_LIST) GUNS[row.id] = row;

export const FRAG = { id: 'grenade', label: 'Frag Grenade', cost: 300, blurb: 'Cooks 2.2 s, then 120 damage in 5 m.' };
export const VEST = { id: 'armor', label: 'Kevlar Vest', cost: 650, blurb: '+50 armor, absorbs half of each hit.' };

// A boxy first-person viewmodel. Each gun gets a blueprint: a list of
// [width, height, depth, x, y, z, finish] boxes. Long barrel for the
// rifle, sniper and DMR, short body for the pistol and SMG, wide tube for
// the shotgun. The DMR gets a scope bump on top.
const BLUEPRINTS = {
  pistol: [
    [0.05, 0.07, 0.3, 0, 0, -0.15, 'body'],
    [0.045, 0.12, 0.06, 0, -0.08, 0.02, 'grip'],
    [0.055, 0.015, 0.05, 0, 0.045, -0.28, 'glow'],
  ],
  smg: [
    [0.07, 0.09, 0.5, 0, 0, -0.22, 'body'],
    [0.05, 0.14, 0.06, 0, -0.1, -0.12, 'grip'],
    [0.06, 0.05, 0.22, 0, -0.06, -0.3, 'body'],
    [0.075, 0.02, 0.06, 0, 0.055, -0.42, 'glow'],
    [0.05, 0.05, 0.14, 0, -0.09, -0.32, 'grip'],
  ],
  rifle: [
    [0.07, 0.09, 0.5, 0, 0, -0.22, 'body'],
    [0.05, 0.14, 0.06, 0, -0.1, -0.12, 'grip'],
    [0.06, 0.05, 0.22, 0, -0.06, -0.3, 'body'],
    [0.075, 0.02, 0.06, 0, 0.055, -0.42, 'glow'],
  ],
  dmr: [
    [0.06, 0.08, 0.62, 0, 0, -0.26, 'body'],
    [0.05, 0.05, 0.14, 0, 0.075, -0.2, 'glow'],
    [0.045, 0.04, 0.08, 0, 0.05, -0.34, 'body'],
    [0.05, 0.13, 0.07, 0, -0.09, 0.02, 'grip'],
    [0.05, 0.09, 0.05, 0, -0.04, -0.3, 'grip'],
  ],
  shotgun: [
    [0.09, 0.09, 0.55, 0, 0, -0.2, 'body'],
    [0.07, 0.07, 0.4, 0, -0.02, -0.32, 'body'],
    [0.07, 0.12, 0.16, 0, -0.09, 0.05, 'grip'],
    [0.095, 0.02, 0.08, 0, 0.055, -0.4, 'glow'],
  ],
  sniper: [
    [0.06, 0.08, 0.7, 0, 0, -0.28, 'body'],
    [0.05, 0.05, 0.1, 0, 0.06, -0.2, 'body'],
    [0.06, 0.06, 0.12, 0, 0.075, -0.18, 'glow'],
    [0.05, 0.13, 0.07, 0, -0.09, 0.02, 'grip'],
  ],
};

export function buildViewmodel(camera, gunId) {
  const group = new THREE.Group();
  const finishes = {
    body: new THREE.MeshStandardMaterial({ color: 0x333a42, roughness: 0.45, metalness: 0.6 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.85, metalness: 0.05 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x2fa8a0, roughness: 0.5, metalness: 0.3, emissive: 0x2fa8a0, emissiveIntensity: 0.35 }),
  };
  for (const [w, h, d, x, y, z, finish] of BLUEPRINTS[gunId] ?? BLUEPRINTS.rifle) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), finishes[finish]);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  group.position.set(0.28, -0.24, -0.5);
  group.scale.setScalar(0.85);
  camera.add(group);
  return group;
}

export function freshLoadout() {
  return {
    id: 'pistol',
    mag: GUNS.pistol.magSize,
    spare: GUNS.pistol.spare,
    reloading: false,
    reloadAt: 0,
    lastFired: -10,
    bloom: 0, // sustained-fire bloom, 0..1
    frags: 0,
  };
}

// Current spread in radians: base + movement + bloom, reduced by crouch
// and by aiming down sights.
export function spreadNow(gun, speed, low, sighted) {
  let spread = gun.baseSpread + gun.moveSpread * Math.min(1, speed / 5.4) + gun.bloom * 0.02;
  if (low) spread *= 0.7;
  if (sighted) spread *= 0.45;
  return spread;
}

// Damage multiplier by distance: full out to half the gun's reach, half
// past its full reach, straight line between.
export function falloffAt(gun, distance) {
  const half = gun.reach * 0.5;
  if (distance <= half) return 1;
  if (distance >= gun.reach) return 0.5;
  return 1 - 0.5 * ((distance - half) / half);
}
