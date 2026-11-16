// Port Meridian: a container dock at dusk, built from boxes. The two
// plant sites sit at the north end — Site A under the gantry crane on the
// west side, Site B beside the warehouse on the east — and three lanes
// join them to the spawns in the south: the west yard, the container rows
// down the middle, and the east yard. Vanguard spawns south, Ember spawns
// north. A rusted container bridge hangs over the middle lane, and a fuel
// depot of glowing barrels marks the centre of the dock. Every solid box
// both blocks movement and stops bullets, and bots walk a waypoint graph
// whose edges are drawn only where a person could walk in a straight line
// at chest height.
import * as THREE from 'three';
import { DUSK } from './palette.js';

// The dock's fixed facts: limits, spawns and sites. Other modules read
// spawns and sites from here so every file agrees on them.
export const ARENA = {
  limits: { west: -26, east: 26, south: 18, north: -18 },
  vanguardSpawns: [
    { x: -6, z: 15.5, yaw: 0 },
    { x: -2, z: 16, yaw: 0 },
    { x: 2, z: 16, yaw: 0 },
    { x: 6, z: 15.5, yaw: 0 },
  ],
  emberSpawns: [
    { x: -6, z: -15.5, yaw: Math.PI },
    { x: -2, z: -16, yaw: Math.PI },
    { x: 2, z: -16, yaw: Math.PI },
    { x: 6, z: -15.5, yaw: Math.PI },
  ],
  sites: {
    A: { x: -19, z: -11, radius: 4.2, label: 'SITE A — CRANE' },
    B: { x: 19, z: -11, radius: 4.2, label: 'SITE B — WAREHOUSE' },
  },
};

// Waypoints for the navigation graph: a loose grid over the dock, denser
// near the sites and the spawns, with a couple of off-lane points for
// holding angles. Two extra nodes flank the fuel depot so bots can route
// around it instead of through it.
const POINTS = [
  { x: -22, z: 14 }, { x: -12, z: 15 }, { x: 0, z: 15 }, { x: 12, z: 15 }, { x: 22, z: 14 },
  { x: -22, z: 6 }, { x: -12, z: 7 }, { x: -4, z: 8 }, { x: 4, z: 8 }, { x: 12, z: 7 }, { x: 22, z: 6 },
  { x: -22, z: -2 }, { x: -13, z: -1 }, { x: -5, z: 0 }, { x: 5, z: 0 }, { x: 13, z: -1 }, { x: 22, z: -2 },
  { x: -19, z: -11 }, { x: -10, z: -11 }, { x: 0, z: -10 }, { x: 10, z: -11 }, { x: 19, z: -11 },
  { x: -19, z: -16 }, { x: -8, z: -13.5 }, { x: 8, z: -13.5 }, { x: 19, z: -16 },
  { x: -14, z: -6 }, { x: 14, z: -6 },
  { x: -9, z: 4 }, { x: 9, z: 4 },
];

const CHEST = 1.1; // height a straight walk is sampled at
const GIRTH = 0.35; // stands in for the walker's own width
const STEP = 0.5; // metres between walk samples

// Would a straight walk from one point to another hit a solid box? The
// walk is sampled every half metre at chest height. A collider only counts
// when it reaches up past 0.9 m and does not start above 1.8 m, so the
// crane beam, the warehouse roof and the overhead bridge can be walked
// under, and anything buried below the floor never blocks.
function walkHits(solids, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return false;
  const count = Math.ceil(len / STEP);
  for (let i = 1; i < count; i += 1) {
    const x = ax + (dx * i) / count;
    const z = az + (dz * i) / count;
    for (const s of solids) {
      if (s.max.y < 0.9 || s.min.y > 1.8) continue;
      const inX = x > s.min.x - GIRTH && x < s.max.x + GIRTH;
      const inZ = z > s.min.z - GIRTH && z < s.max.z + GIRTH;
      if (inX && inZ) return true;
    }
  }
  return false;
}

// Build the waypoint graph: every pair of nodes closer than 13 m gets an
// edge, unless a straight walk between them is blocked.
function linkGraph(solids) {
  const nodes = POINTS.map((p, i) => ({ id: i, x: p.x, z: p.z, links: [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 13) continue;
      if (walkHits(solids, a.x, a.z, b.x, b.z)) continue;
      a.links.push({ to: j, cost: d });
      b.links.push({ to: i, cost: d });
    }
  }
  return nodes;
}

export function buildPort(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const solids = [];
  const targets = [];
  const caster = new THREE.Raycaster();

  // One shared material per colour and finish, cached by key.
  const cache = {};
  function paint(color, rough = 0.9, metal = 0.08, glow = 0x000000, glowStrength = 1) {
    const key = `${color}|${rough}|${metal}|${glow}`;
    if (!cache[key]) {
      cache[key] = new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: metal,
        emissive: new THREE.Color(glow),
        emissiveIntensity: glowStrength,
      });
    }
    return cache[key];
  }

  // Put a box in the world. By default it blocks movement, stops bullets,
  // and casts and receives shadows.
  function putBox(w, h, d, x, y, z, color, opts = {}) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      paint(color, opts.rough ?? 0.9, opts.metal ?? 0.08, opts.glow ?? 0, opts.glowStrength ?? 1),
    );
    mesh.position.set(x, y, z);
    if (opts.spin) mesh.rotation.y = opts.spin;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.ghost) {
      mesh.updateMatrixWorld(true);
      solids.push(new THREE.Box3().setFromObject(mesh));
    }
    if (!opts.noShot) targets.push(mesh);
    return mesh;
  }

  // Put a cylinder in the world (a barrel, a pillar, a lamp post): same
  // collision rules as a box, with a square footprint that covers it.
  function putDrum(radius, height, x, y, z, color, opts = {}) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 14),
      paint(color, opts.rough ?? 0.7, opts.metal ?? 0.4, opts.glow ?? 0, opts.glowStrength ?? 1),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.ghost) {
      mesh.updateMatrixWorld(true);
      solids.push(new THREE.Box3().setFromObject(mesh));
    }
    if (!opts.noShot) targets.push(mesh);
    return mesh;
  }

  // ---- Floor: wet concrete, darker slabs, and two painted yellow lines
  // marking the lanes.
  putBox(52.8, 0.4, 36.8, 0, -0.2, 0, DUSK.concrete, { noShot: true });
  for (let i = 0; i < 10; i += 1) {
    const x = -22 + (i % 5) * 11;
    const z = -12 + Math.floor(i / 5) * 22;
    putBox(7, 0.06, 5, x, 0.03, z, DUSK.concreteDark, { ghost: true, noShot: true, rough: 0.6, metal: 0.25 });
  }
  for (const laneX of [-8, 8]) {
    putBox(0.5, 0.05, 30, laneX, 0.03, 0, DUSK.bulb, { ghost: true, noShot: true, glow: DUSK.bulb, glowStrength: 0.25 });
  }

  // ---- Outer walls, built from dark steel containers.
  putBox(0.8, 5, 36.8, -26.4, 2.5, 0, DUSK.metalDark);
  putBox(0.8, 5, 36.8, 26.4, 2.5, 0, DUSK.metalDark);
  putBox(52.8, 5, 0.8, 0, 2.5, -18.4, DUSK.metalDark);
  putBox(52.8, 5, 0.8, 0, 2.5, 18.4, DUSK.metalDark);

  // ---- Shipping containers: the cover that shapes every fight, and the
  // colour of the map. Each row is {width, height, depth, x, y, z, colour}.
  const boxes = [
    // mid lane
    { w: 6, h: 2.6, d: 2.4, x: -2, y: 1.3, z: 2, c: DUSK.rust },
    { w: 6, h: 2.6, d: 2.4, x: 3, y: 1.3, z: -4, c: DUSK.metal },
    { w: 2.4, h: 2.6, d: 6, x: -6, y: 1.3, z: -6, c: DUSK.vanguardDark },
    { w: 2.4, h: 2.6, d: 6, x: 7, y: 1.3, z: 6, c: DUSK.rustBright },
    { w: 6, h: 2.6, d: 2.4, x: -1, y: 3.9, z: 2, c: DUSK.metalDark }, // stacked on the first one
    // west yard
    { w: 2.4, h: 2.6, d: 6, x: -14, y: 1.3, z: 8, c: DUSK.metal },
    { w: 6, h: 2.6, d: 2.4, x: -18, y: 1.3, z: 2, c: DUSK.rustBright },
    { w: 2.4, h: 5.2, d: 2.4, x: -21, y: 2.6, z: -4, c: DUSK.emberDark },
    { w: 6, h: 2.6, d: 2.4, x: -13, y: 1.3, z: -8, c: DUSK.metal },
    // east yard
    { w: 2.4, h: 2.6, d: 6, x: 14, y: 1.3, z: 8, c: DUSK.rust },
    { w: 6, h: 2.6, d: 2.4, x: 18, y: 1.3, z: 2, c: DUSK.metal },
    { w: 2.4, h: 5.2, d: 2.4, x: 21, y: 2.6, z: -4, c: DUSK.vanguardDark },
    { w: 6, h: 2.6, d: 2.4, x: 13, y: 1.3, z: -8, c: DUSK.rustBright },
    // north cover near the sites
    { w: 6, h: 2.6, d: 2.4, x: -10, y: 1.3, z: -13, c: DUSK.metalDark },
    { w: 6, h: 2.6, d: 2.4, x: 10, y: 1.3, z: -13, c: DUSK.metalDark },
    { w: 2.4, h: 2.6, d: 6, x: 0, y: 1.3, z: -14, c: DUSK.rust },
    // south cover near the spawns
    { w: 6, h: 2.6, d: 2.4, x: -10, y: 1.3, z: 12, c: DUSK.metal },
    { w: 6, h: 2.6, d: 2.4, x: 10, y: 1.3, z: 12, c: DUSK.rust },
  ];
  for (const b of boxes) {
    putBox(b.w, b.h, b.d, b.x, b.y, b.z, b.c, { metal: 0.35, rough: 0.65 });
  }

  // ---- The overhead bridge: a container slung across the middle lane on
  // two steel trestles, high enough to walk under and to throw a long
  // shadow across the centre of the dock.
  putBox(0.7, 5.2, 0.7, -4.2, 2.6, 2, DUSK.metal, { metal: 0.5, rough: 0.5 });
  putBox(0.7, 5.2, 0.7, 4.2, 2.6, 2, DUSK.metal, { metal: 0.5, rough: 0.5 });
  putBox(9.4, 2.6, 2.4, 0, 6.4, 2, DUSK.rustBright, { metal: 0.35, rough: 0.65 });
  putBox(9.4, 0.3, 2.6, 0, 5.0, 2, DUSK.metalDark, { metal: 0.5, rough: 0.5 });

  // ---- Low crates, just tall enough to crouch behind.
  const crateSpots = [
    [-4, 6], [5, 10], [-9, -2], [9, -2], [-16, 10], [16, 10], [-4, -8], [4, -8],
    [-22, 0], [22, 0], [0, 4], [-15, -13], [15, -13],
  ];
  for (const [x, z] of crateSpots) putBox(1.3, 1.1, 1.3, x, 0.55, z, DUSK.rust, { metal: 0.2, rough: 0.8 });

  // ---- The fuel depot at the centre of the dock: three glowing barrels
  // in a triangle, a low hazard ring painted on the concrete, and a small
  // amber lamp above them.
  putDrum(0.55, 1.1, -1.2, 0.55, 6.6, DUSK.emberDark, { glow: DUSK.ember, glowStrength: 0.35 });
  putDrum(0.55, 1.1, 1.2, 0.55, 6.6, DUSK.emberDark, { glow: DUSK.ember, glowStrength: 0.35 });
  putDrum(0.55, 1.1, 0, 0.55, 8.0, DUSK.metalDark, { glow: DUSK.bulb, glowStrength: 0.2 });
  const depotRing = new THREE.Mesh(
    new THREE.RingGeometry(2.0, 2.35, 40),
    new THREE.MeshBasicMaterial({ color: DUSK.bulb, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  depotRing.rotation.x = -Math.PI / 2;
  depotRing.position.set(0, 0.06, 7.2);
  group.add(depotRing);
  const depotLamp = new THREE.PointLight(DUSK.bulb, 12, 10, 1.8);
  depotLamp.position.set(0, 3.4, 7.2);
  scene.add(depotLamp);

  // ---- The gantry crane over Site A: four legs, a cross beam, and the
  // hook block hanging beneath it.
  for (const [x, z] of [[-23, -15], [-15, -15], [-23, -7], [-15, -7]]) {
    putBox(0.7, 11, 0.7, x, 5.5, z, DUSK.metal, { metal: 0.5, rough: 0.5 });
  }
  putBox(9.4, 1.2, 1.4, -19, 11.4, -11, DUSK.metal, { metal: 0.5, rough: 0.5 });
  putBox(1.6, 1.6, 1.6, -19, 9.6, -11, DUSK.rust, { metal: 0.4, rough: 0.6 });
  // ---- The warehouse shell over Site B: back wall, roof, and two side walls.
  putBox(10, 5, 0.6, 19, 2.5, -16.5, DUSK.metalDark, { metal: 0.3, rough: 0.7 });
  putBox(10, 0.8, 7, 19, 5.2, -13, DUSK.metal, { metal: 0.3, rough: 0.7 });
  putBox(0.6, 5, 7, 14.2, 2.5, -13, DUSK.metalDark, { metal: 0.3, rough: 0.7 });
  putBox(0.6, 5, 7, 23.8, 2.5, -13, DUSK.metalDark, { metal: 0.3, rough: 0.7 });

  // ---- Site markers. Each site gets a glowing ring on the floor, a
  // translucent light pillar, and a point light so the site reads from
  // across the dock.
  function markSite(site, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.06, site.z);
    group.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 5.5, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28 }),
    );
    pillar.position.set(site.x, 2.8, site.z);
    group.add(pillar);
    const glow = new THREE.PointLight(color, 26, 18, 1.6);
    glow.position.set(site.x, 4.5, site.z);
    scene.add(glow);
    return { ring, pillar };
  }
  const markerA = markSite(ARENA.sites.A, DUSK.vanguard);
  const markerB = markSite(ARENA.sites.B, DUSK.ember);

  // ---- Sodium lamps on poles along the lanes.
  const lampSpots = [[-8, 12], [8, 12], [-8, -6], [8, -6], [0, 0]];
  for (const [x, z] of lampSpots) {
    putBox(0.25, 5.2, 0.25, x, 2.6, z, DUSK.metalDark, { metal: 0.5 });
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshBasicMaterial({ color: DUSK.bulb }),
    );
    bulb.position.set(x, 5.3, z);
    group.add(bulb);
    const light = new THREE.PointLight(DUSK.bulb, 20, 17, 1.8);
    light.position.set(x, 5.1, z);
    scene.add(light);
  }

  // ---- Floodlight towers in the two north corners, washing the sites.
  for (const [x, z, color] of [[-24, -16, DUSK.vanguard], [24, -16, DUSK.ember]]) {
    putBox(0.4, 8, 0.4, x, 4, z, DUSK.metalDark, { metal: 0.5 });
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: DUSK.bulb }),
    );
    head.position.set(x, 8.2, z);
    head.rotation.y = x < 0 ? Math.PI / 4 : -Math.PI / 4;
    group.add(head);
    const wash = new THREE.PointLight(color, 18, 20, 1.8);
    wash.position.set(x, 7.8, z);
    scene.add(wash);
  }

  // ---- A ring of distant skyline silhouettes beyond the walls, plus a low sun.
  const skyline = new THREE.Group();
  for (let i = 0; i < 14; i += 1) {
    const h = 8 + ((i * 37) % 18);
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(6, h, 4),
      new THREE.MeshBasicMaterial({ color: 0x1c2333 }),
    );
    const angle = (i / 14) * Math.PI * 2;
    tower.position.set(Math.cos(angle) * 62, h / 2 - 1, Math.sin(angle) * 62);
    skyline.add(tower);
  }
  scene.add(skyline);
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(6, 32),
    new THREE.MeshBasicMaterial({ color: DUSK.sun, fog: false }),
  );
  sun.position.set(-30, 9, -70);
  sun.lookAt(0, 2, 0);
  scene.add(sun);

  // ---- Dusk lighting: a cool hemisphere fill and one warm, low
  // directional sun that throws the long shadows.
  const hemi = new THREE.HemisphereLight(0x9fb0cc, 0x3a3226, 1.6);
  scene.add(hemi);
  const daylight = new THREE.DirectionalLight(0xffb37a, 3.6);
  daylight.position.set(-28, 16, -34);
  daylight.target.position.set(0, 0, 4);
  daylight.castShadow = true;
  daylight.shadow.mapSize.set(2048, 2048);
  daylight.shadow.camera.left = -32;
  daylight.shadow.camera.right = 32;
  daylight.shadow.camera.top = 32;
  daylight.shadow.camera.bottom = -32;
  daylight.shadow.camera.far = 90;
  daylight.shadow.bias = -0.0005;
  scene.add(daylight, daylight.target);

  const nodes = linkGraph(solids);

  // True when no shootable object stands between two points in 3D.
  function clearShot(ax, ay, az, bx, by, bz) {
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    caster.set(new THREE.Vector3(ax, ay, az), dir);
    caster.far = dist;
    const hit = caster.intersectObjects(targets, false)[0];
    return !hit;
  }

  // Flat footprints of the tall cover, drawn on the minimap.
  const mapRects = solids
    .filter((s) => s.max.y > 0.9 && s.max.y < 6)
    .map((s) => ({ x: s.min.x, z: s.min.z, w: s.max.x - s.min.x, d: s.max.z - s.min.z }));

  return {
    solids,
    targets,
    nodes,
    clearShot,
    markers: { A: markerA, B: markerB },
    group,
    mapRects,
  };
}
