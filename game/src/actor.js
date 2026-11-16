// The player's body: acceleration, friction, gravity, crouch and jump,
// resolved as a box against the map's colliders one axis at a time, so a
// wall never swallows the player. Spread and recoil read the speed this
// module reports.
import * as THREE from 'three';

const HALF = 0.34;
const TALL = 1.72;
const LOW = 1.12;
const EYE_TALL = 1.6;
const EYE_LOW = 1.02;
const PACE = 5.4;
const PACE_LOW = 2.5;
const PACE_SIGHT = 3.4;
const PUSH_GROUND = 46;
const PUSH_AIR = 10;
const DRAG = 10;
const PULL = 21;
const LEAP = 6.4;

export function makePlayer(colliders, spawn) {
  const rig = {
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    eye: EYE_TALL,
    grounded: true,
    crouched: false,
    height: TALL,
    health: 100,
    armor: 0,
    alive: true,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function hits(x, y, z, height, inset) {
    probe.min.set(x - HALF, y + inset, z - HALF);
    probe.max.set(x + HALF, y + height - inset, z + HALF);
    for (const solid of colliders) {
      if (probe.intersectsBox(solid)) return solid;
    }
    return null;
  }

  function turn(dx, dy, sense = 0.0021) {
    rig.yaw -= dx * sense;
    rig.pitch = Math.max(-1.45, Math.min(1.45, rig.pitch - dy * sense));
  }

  function kickBack(pitchUp, yawSide) {
    rig.pitch = Math.min(1.45, rig.pitch + pitchUp);
    rig.yaw += yawSide;
  }

  function move(dt, keys, sighted) {
    if (!rig.alive) return;
    const wantLow = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantLow && !rig.crouched) {
      rig.crouched = true;
      rig.height = LOW;
    } else if (!wantLow && rig.crouched && !hits(rig.pos.x, rig.pos.y, rig.pos.z, TALL, 0.02)) {
      rig.crouched = false;
      rig.height = TALL;
    }
    const eyeWant = rig.crouched ? EYE_LOW : EYE_TALL;
    rig.eye += (eyeWant - rig.eye) * Math.min(1, dt * 12);

    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (fwd || side) {
      const sin = Math.sin(rig.yaw);
      const cos = Math.cos(rig.yaw);
      wish.set(-sin * fwd + cos * side, 0, -cos * fwd - sin * side).normalize();
    }

    let pace = rig.crouched ? PACE_LOW : PACE;
    if (sighted) pace = Math.min(pace, PACE_SIGHT);
    const push = rig.grounded ? PUSH_GROUND : PUSH_AIR;
    const blend = Math.min(1, (push * dt) / pace);
    rig.vel.x += (wish.x * pace - rig.vel.x) * blend;
    rig.vel.z += (wish.z * pace - rig.vel.z) * blend;
    if (rig.grounded && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - DRAG * dt);
      rig.vel.x *= damp;
      rig.vel.z *= damp;
    }

    if (keys.has('Space') && rig.grounded) {
      rig.vel.y = LEAP;
      rig.grounded = false;
    }
    rig.vel.y -= PULL * dt;

    const nextX = rig.pos.x + rig.vel.x * dt;
    if (!hits(nextX, rig.pos.y, rig.pos.z, rig.height, 0.04)) rig.pos.x = nextX;
    else rig.vel.x = 0;
    const nextZ = rig.pos.z + rig.vel.z * dt;
    if (!hits(rig.pos.x, rig.pos.y, nextZ, rig.height, 0.04)) rig.pos.z = nextZ;
    else rig.vel.z = 0;

    rig.pos.y += rig.vel.y * dt;
    rig.grounded = false;
    const under = hits(rig.pos.x, rig.pos.y, rig.pos.z, rig.height, 0);
    if (under && rig.vel.y <= 0) {
      rig.pos.y = under.max.y;
      rig.vel.y = 0;
      rig.grounded = true;
    } else if (under) {
      rig.pos.y = under.min.y - rig.height;
      rig.vel.y = 0;
    }
    if (rig.pos.y < 0) {
      rig.pos.y = 0;
      rig.vel.y = 0;
      rig.grounded = true;
    }
    rig.vel.y = Math.max(-30, rig.vel.y);
    // Keep the player inside the dock.
    rig.pos.x = Math.max(-25.4, Math.min(25.4, rig.pos.x));
    rig.pos.z = Math.max(-17.4, Math.min(17.4, rig.pos.z));
  }

  function respawn(at) {
    rig.pos.set(at.x, 0, at.z);
    rig.vel.set(0, 0, 0);
    rig.yaw = at.yaw;
    rig.pitch = 0;
    rig.health = 100;
    rig.armor = 0;
    rig.alive = true;
    rig.crouched = false;
    rig.height = TALL;
    rig.eye = EYE_TALL;
  }

  return {
    rig,
    move,
    turn,
    kickBack,
    respawn,
    eyeAt(out) {
      out.set(rig.pos.x, rig.pos.y + rig.eye, rig.pos.z);
      return out;
    },
    speedOverGround() {
      return Math.hypot(rig.vel.x, rig.vel.z);
    },
  };
}
