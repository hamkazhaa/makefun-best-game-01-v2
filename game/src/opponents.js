// The other nine agents on the dock. A bot is a small box-built humanoid
// — head (the headshot target), torso, legs, a rifle — dressed in its
// team's colour. Each one thinks in modes: it pushes along a route across
// the map's waypoint graph, posts up at a spot, fights an enemy it can
// see, channels the charge, or retreats when badly hurt. Sometimes a
// Vanguard bot takes the long way round — a flank down the far lane — so
// Ember cannot just watch the two obvious approaches. Bots hear shots,
// take a human-like moment to react, and aim worse at range and at a
// moving target, so a player who stops, aims, and picks the moment wins
// duels.
import * as THREE from 'three';
import { DUSK } from './palette.js';
import { ARENA } from './port.js';

const GIRTH = 0.34;
const STATURE = 1.74;
const PACE = 3.7;
const EYE = 1.55;

const VANGUARD_CALLSIGNS = ['Rook', 'Haven', 'Sable'];
const EMBER_CALLSIGNS = ['Cinder', 'Ash', 'Flint', 'Onyx'];

// The spawn tables live here, next to the bots that use them, and the
// rounds module reads the same coordinates from ARENA, so the two files
// always agree.
const POSTS = { vanguard: ARENA.vanguardSpawns, ember: ARENA.emberSpawns };

// Shortest path over the waypoint graph: plain Dijkstra with a linear scan
// for the nearest unvisited node. The graph is small, so this is plenty.
function shortestPath(nodes, from, to) {
  const best = new Array(nodes.length).fill(Infinity);
  const back = new Array(nodes.length).fill(-1);
  const closed = new Array(nodes.length).fill(false);
  best[from] = 0;
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let pick = -1;
    let pickCost = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      if (!closed[i] && best[i] < pickCost) {
        pickCost = best[i];
        pick = i;
      }
    }
    if (pick === -1) break;
    closed[pick] = true;
    if (pick === to) break;
    for (const link of nodes[pick].links) {
      const via = best[pick] + link.cost;
      if (via < best[link.to]) {
        best[link.to] = via;
        back[link.to] = pick;
      }
    }
  }
  if (best[to] === Infinity) return [];
  const path = [];
  for (let at = to; at !== -1; at = back[at]) path.unshift(at);
  return path;
}

// Wrap an angle difference into (-PI, PI].
function turnTo(a) {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Assemble one bot's visible body out of boxes and return its named parts.
function buildFigure(scene, team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: team === 'vanguard' ? 0x2c3a44 : 0x453029,
    roughness: 0.85,
    metalness: 0.1,
  });
  const tint = team === 'vanguard' ? DUSK.vanguard : DUSK.ember;
  const accent = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 0.5,
    metalness: 0.2,
    emissive: tint,
    emissiveIntensity: 0.5,
  });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.4, metalness: 0.6 });
  function box(w, h, d, x, y, z, mat, parent = group) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const legL = box(0.16, 0.78, 0.2, -0.11, 0.39, 0, suit);
  const legR = box(0.16, 0.78, 0.2, 0.11, 0.39, 0, suit);
  const torso = box(0.52, 0.62, 0.3, 0, 1.08, 0, suit);
  box(0.54, 0.1, 0.32, 0, 1.32, 0, accent); // shoulder stripe
  const head = box(0.26, 0.26, 0.26, 0, 1.56, 0, skin);
  box(0.28, 0.08, 0.28, 0, 1.7, 0, accent); // helmet band
  const armL = box(0.12, 0.5, 0.14, -0.32, 1.12, 0.08, suit);
  const armR = box(0.12, 0.5, 0.14, 0.32, 1.12, 0.08, suit);
  const gun = box(0.07, 0.1, 0.62, 0.18, 1.18, -0.3, iron);
  armL.rotation.x = -0.9;
  armR.rotation.x = -0.9;
  scene.add(group);
  return { group, head, torso, legL, legR, gun };
}

export function makeOpponents(scene, port, hooks) {
  const roster = [];
  const solids = port.solids;
  const probe = new THREE.Box3();

  // Would a bot-sized box at (x, y, z) intersect any solid collider?
  function fitsAt(x, y, z) {
    probe.min.set(x - GIRTH, y + 0.05, z - GIRTH);
    probe.max.set(x + GIRTH, y + STATURE - 0.05, z + GIRTH);
    for (const s of solids) {
      if (probe.intersectsBox(s)) return false;
    }
    return true;
  }

  // The connected waypoint nearest a point on the ground.
  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    port.nodes.forEach((n, i) => {
      if (n.links.length === 0) return; // never route from an isolated node
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // Copy a bot's logical position and facing onto its visible body.
  function placeFigure(bot) {
    bot.figure.group.position.set(bot.pos.x, bot.figure.group.position.y, bot.pos.z);
    bot.figure.group.rotation.y = bot.yaw;
  }

  // Can this bot see a point? Within range, roughly in front of it, and
  // with a clear line of sight.
  function canSee(bot, x, y, z) {
    const ox = x - bot.pos.x;
    const oy = y - (bot.pos.y + EYE);
    const oz = z - bot.pos.z;
    const range = Math.hypot(ox, oy, oz);
    if (range > 55) return false;
    const ahead = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const toward = new THREE.Vector3(ox, 0, oz).normalize();
    const inFront = ahead.dot(toward) >= 0.1 || range <= 4;
    if (!inFront) return false;
    return port.clearShot(bot.pos.x, bot.pos.y + EYE, bot.pos.z, x, y, z);
  }

  function fieldBot(team, name, spawn, index) {
    const figure = buildFigure(scene, team);
    const bot = {
      id: `${team}-${index}`,
      team,
      name,
      figure,
      pos: new THREE.Vector3(spawn.x, 0, spawn.z),
      yaw: spawn.yaw,
      health: 100,
      alive: true,
      mode: 'push',
      route: [],
      routeAt: 0,
      goalNode: -1,
      holdBy: 0,
      seen: null, // {foe, at}
      reactBy: 0,
      shotsLeft: 0,
      nextBurst: 0,
      aimWobble: 0.02,
      stride: Math.random() * 6,
      thinkBy: Math.random() * 0.2,
      task: null, // {type: 'plant'|'defuse', until, at}
      carrying: false,
      pace: PACE * (0.92 + Math.random() * 0.16),
      flash: 0,
    };
    figure.group.position.copy(bot.pos);
    figure.group.rotation.y = bot.yaw;
    figure.head.userData = { bot, part: 'head' };
    figure.torso.userData = { bot, part: 'body' };
    figure.legL.userData = { bot, part: 'legs' };
    figure.legR.userData = { bot, part: 'legs' };
    roster.push(bot);
    return bot;
  }

  function goTo(bot, x, z) {
    const from = nearestNode(bot.pos.x, bot.pos.z);
    const to = nearestNode(x, z);
    bot.route = shortestPath(port.nodes, from, to);
    bot.routeAt = 0;
    bot.goalNode = to;
  }

  // Route through a detour point first, then on to the goal: the flank.
  // The two legs are joined at the detour node so the walk stays smooth.
  function goVia(bot, viaX, viaZ, x, z) {
    const from = nearestNode(bot.pos.x, bot.pos.z);
    const via = nearestNode(viaX, viaZ);
    const to = nearestNode(x, z);
    const first = shortestPath(port.nodes, from, via);
    const second = shortestPath(port.nodes, via, to);
    if (!first.length || !second.length) {
      goTo(bot, x, z);
      return;
    }
    bot.route = first.concat(second.slice(1));
    bot.routeAt = 0;
    bot.goalNode = to;
  }

  // Walk toward the current waypoint. Returns true once the whole route is
  // done. Movement is axis-separated so a bot slides along walls instead of
  // sticking on them, and it is clamped inside the dock.
  function followRoute(bot, dt) {
    if (bot.routeAt >= bot.route.length) return true;
    const node = port.nodes[bot.route[bot.routeAt]];
    const stepX = node.x - bot.pos.x;
    const stepZ = node.z - bot.pos.z;
    const stepLen = Math.hypot(stepX, stepZ);
    if (stepLen < 0.6) {
      bot.routeAt += 1;
      bot.stuckFor = 0;
      bot.lastGap = undefined;
      return bot.routeAt >= bot.route.length;
    }
    // Stuck detection: if we stop closing on the waypoint, skip it — a node
    // can sit just behind a container corner the bot cannot round.
    if (bot.lastGap !== undefined && stepLen > bot.lastGap - 0.05) {
      bot.stuckFor = (bot.stuckFor || 0) + dt;
      if (bot.stuckFor > 1.2) {
        bot.routeAt += 1;
        bot.stuckFor = 0;
        bot.lastGap = undefined;
        return bot.routeAt >= bot.route.length;
      }
    } else {
      bot.stuckFor = 0;
    }
    bot.lastGap = stepLen;
    const vx = (stepX / stepLen) * bot.pace;
    const vz = (stepZ / stepLen) * bot.pace;
    const nx = bot.pos.x + vx * dt;
    if (fitsAt(nx, bot.pos.y, bot.pos.z)) bot.pos.x = nx;
    const nz = bot.pos.z + vz * dt;
    if (fitsAt(bot.pos.x, bot.pos.y, nz)) bot.pos.z = nz;
    bot.pos.x = Math.max(-25.4, Math.min(25.4, bot.pos.x));
    bot.pos.z = Math.max(-17.4, Math.min(17.4, bot.pos.z));
    const wantYaw = Math.atan2(-stepX, -stepZ);
    bot.yaw += turnTo(wantYaw - bot.yaw) * Math.min(1, dt * 6);
    return false;
  }

  // Decide where a bot should go next when it has no fight to take.
  function pickGoal(bot, ctx) {
    if (bot.team === 'vanguard') {
      // Vanguard pushes a site; the carrier heads for the nearer one, the
      // others split between the two at random. One in four takes the long
      // way round — a flank down the far lane.
      const site = ctx.planted
        ? null
        : bot.carrying
          ? ctx.nearSite(bot)
          : Math.random() < 0.5
            ? ctx.sites.A
            : ctx.sites.B;
      if (site) {
        if (Math.random() < 0.25) {
          const far = site === ctx.sites.A ? { x: 13, z: -1 } : { x: -13, z: -1 };
          goVia(bot, far.x, far.z, site.x, site.z);
        } else {
          goTo(bot, site.x, site.z);
        }
        bot.mode = 'push';
        return;
      }
      // Nothing to push: hunt the last known enemy position.
      goTo(bot, ctx.enemyLastX ?? 0, ctx.enemyLastZ ?? 0);
      bot.mode = 'push';
      return;
    }
    // Ember holds near a site, spread across both of them.
    const site = bot.id.endsWith('0') || bot.id.endsWith('2') ? ctx.sites.A : ctx.sites.B;
    const holdX = site.x + (Math.random() * 6 - 3);
    const holdZ = site.z + 3 + Math.random() * 4;
    goTo(bot, holdX, holdZ);
    bot.mode = 'push';
    bot.holdSite = site;
  }

  // Fire at an enemy in short bursts, after a reaction delay, with
  // distance-based inaccuracy. Hits and misses both draw a tracer.
  function openFire(bot, foe, dt, now) {
    if (now < bot.reactBy) return;
    if (bot.shotsLeft <= 0) {
      if (now < bot.nextBurst) return;
      bot.shotsLeft = 3 + Math.floor(Math.random() * 3);
      bot.nextBurst = now + 0.7 + Math.random() * 0.6;
    }
    if (now < bot.nextBurst - 0.6) return;
    bot.nextBurst = now + 0.13;
    bot.shotsLeft -= 1;
    const target = foe.eyePos.clone();
    target.y -= 0.25; // aim at the chest
    const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.35, bot.pos.z);
    const dist = from.distanceTo(target);
    const error = 0.012 + dist * 0.0016 + (foe.speed || 0) * 0.003;
    const hitChance = Math.max(0.1, Math.min(0.62, 0.55 - dist * 0.007));
    const landed = Math.random() < hitChance;
    const head = landed && Math.random() < 0.14;
    let end;
    if (landed) {
      end = target.clone();
      const hurt = Math.round((head ? 44 : 22) * (dist > 30 ? 0.75 : 1));
      if (foe.isPlayer) hooks.hitPlayer(hurt, bot, head);
      else hooks.hitBot(bot, foe.bot, hurt, head);
    } else {
      end = target.clone();
      end.x += (Math.random() - 0.5) * dist * error * 4;
      end.y += (Math.random() - 0.5) * dist * error * 4 + 0.3;
      end.z += (Math.random() - 0.5) * dist * error * 4;
    }
    hooks.trace(from, end);
    hooks.shotHeard(bot, dist);
    bot.figure.gun.position.z = -0.24;
    setTimeout(() => {
      bot.figure.gun.position.z = -0.3;
    }, 60);
  }

  // Hurt a bot. Returns true if the hit killed it. A bot that is shot turns
  // toward the shooter, and one below 35 health pulls back instead of
  // fighting on.
  function hurt(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.flash = 1;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.figure.group.rotation.x = -Math.PI / 2;
      bot.figure.group.position.y = 0.25;
      return true;
    }
    if (bot.health < 35 && bot.mode !== 'duel') {
      bot.mode = 'fallBack';
      bot.holdBy = 0;
    }
    return false;
  }

  // Scan for the nearest visible enemy. Returns the foe, or null.
  function scan(bot, ctx) {
    let mark = null;
    let markDist = Infinity;
    for (const foe of ctx.enemiesOf(bot)) {
      if (!foe.alive) continue;
      const p = foe.eyePos;
      const d = Math.hypot(p.x - bot.pos.x, p.y - (bot.pos.y + EYE), p.z - bot.pos.z);
      if (d < markDist && canSee(bot, p.x, p.y, p.z)) {
        mark = foe;
        markDist = d;
      }
    }
    return mark;
  }

  function tick(dt, now, ctx) {
    for (const bot of roster) {
      if (!bot.alive) continue;
      // Walk-cycle animation.
      bot.stride += dt * 9;
      const sway = Math.sin(bot.stride) * 0.45;
      bot.figure.legL.rotation.x = sway;
      bot.figure.legR.rotation.x = -sway;
      if (bot.flash > 0) {
        bot.flash -= dt * 4;
        bot.figure.torso.material.emissive.setHex(0x881111);
        bot.figure.torso.material.emissiveIntensity = Math.max(0, bot.flash);
      }

      // Perception runs on a staggered timer: scan for the nearest visible
      // enemy and fight it, or give up the fight once it has been out of
      // sight for a while.
      if (now >= bot.thinkBy) {
        bot.thinkBy = now + 0.15 + Math.random() * 0.1;
        const mark = scan(bot, ctx);
        if (mark) {
          if (!bot.seen) bot.reactBy = now + 0.35 + Math.random() * 0.35;
          bot.seen = { foe: mark, at: now };
          bot.mode = 'duel';
        } else if (bot.mode === 'duel') {
          if (bot.seen && now - bot.seen.at > 2.5) {
            bot.seen = null;
            bot.mode = 'push';
            pickGoal(bot, ctx);
          }
        }
      }

      // Plant and defuse tasks: the bot stands still until the timer runs
      // out, then the hook resolves the round.
      if (bot.task) {
        if (now >= bot.task.until) {
          const kind = bot.task.type;
          bot.task = null;
          if (kind === 'plant') hooks.planted(bot);
          else hooks.defused(bot);
        } else {
          continue;
        }
      }

      if (bot.mode === 'duel' && bot.seen) {
        const foe = bot.seen.foe;
        if (!foe.alive) {
          bot.seen = null;
          bot.mode = 'push';
          pickGoal(bot, ctx);
          placeFigure(bot);
          continue;
        }
        const eye = foe.eyePos;
        const dx = eye.x - bot.pos.x;
        const dz = eye.z - bot.pos.z;
        const wantYaw = Math.atan2(-dx, -dz);
        bot.yaw += turnTo(wantYaw - bot.yaw) * Math.min(1, dt * 8);
        const dist = Math.hypot(dx, dz);
        // Keep a fighting distance: close in when far away, back off when
        // the enemy is point blank.
        if (dist > 16) {
          followRoute(bot, dt) || goTo(bot, eye.x, eye.z);
        } else if (dist < 3) {
          const nx = bot.pos.x + Math.sin(bot.yaw) * bot.pace * dt;
          const nz = bot.pos.z + Math.cos(bot.yaw) * bot.pace * dt;
          if (fitsAt(nx, bot.pos.y, bot.pos.z)) bot.pos.x = nx;
          if (fitsAt(bot.pos.x, bot.pos.y, nz)) bot.pos.z = nz;
        }
        openFire(bot, foe, dt, now);
        placeFigure(bot);
        continue;
      }

      if (bot.mode === 'fallBack') {
        // Run back toward the team's spawn, then rejoin the attack or defence.
        goTo(bot, 0, bot.team === 'vanguard' ? 15 : -15);
        if (followRoute(bot, dt)) {
          bot.mode = 'push';
          pickGoal(bot, ctx);
        }
        placeFigure(bot);
        continue;
      }

      // Push and post behaviour.
      if (bot.mode === 'push') {
        if (bot.route.length === 0) pickGoal(bot, ctx);
        const arrived = followRoute(bot, dt);
        if (arrived) {
          // At a site with the charge: start planting it.
          if (bot.carrying && ctx.plantSite) {
            const site = ctx.plantSite(bot);
            if (site) {
              bot.task = { type: 'plant', until: now + 3, at: now };
              bot.mode = 'channel';
              continue;
            }
          }
          // At a planted charge as a defender: start defusing it.
          if (ctx.planted && bot.team === 'ember') {
            bot.task = { type: 'defuse', until: now + 5, at: now };
            bot.mode = 'channel';
            continue;
          }
          bot.mode = 'post';
          bot.holdBy = now + 3 + Math.random() * 4;
          // Sweep the lane while posted.
          bot.yaw += (Math.random() - 0.5) * 1.2;
        }
      } else if (bot.mode === 'post') {
        if (now >= bot.holdBy) {
          bot.mode = 'push';
          pickGoal(bot, ctx);
        } else {
          bot.yaw += Math.sin(now * 0.5 + bot.stride) * dt * 0.4;
        }
      } else if (bot.mode === 'channel') {
        // The task above handles this; nothing else to do.
      } else {
        pickGoal(bot, ctx);
      }

      placeFigure(bot);
    }
  }

  // Clear every bot body from the scene and field a fresh set for a round.
  // On even rounds the first Vanguard bot carries the charge.
  function fieldSquad(round, carrier) {
    for (const bot of roster) scene.remove(bot.figure.group);
    roster.length = 0;
    POSTS.vanguard.forEach((spawn, i) => {
      const bot = fieldBot('vanguard', VANGUARD_CALLSIGNS[i], spawn, i);
      bot.figure.group.userData.isBotBody = true;
      if (carrier === 'vanguard-0' && i === 0) bot.carrying = true;
    });
    POSTS.ember.forEach((spawn, i) => {
      const bot = fieldBot('ember', EMBER_CALLSIGNS[i], spawn, i);
      bot.figure.group.userData.isBotBody = true;
    });
  }

  function countAlive(team) {
    return roster.filter((b) => b.team === team && b.alive).length;
  }

  function shootMeshes() {
    const meshes = [];
    for (const bot of roster) {
      if (!bot.alive) continue;
      meshes.push(bot.figure.head, bot.figure.torso, bot.figure.legL, bot.figure.legR);
    }
    return meshes;
  }

  function chargeCarrier() {
    return roster.find((b) => b.carrying && b.alive) || null;
  }

  return { roster, tick, hurt, fieldSquad, countAlive, shootMeshes, chargeCarrier };
}
