// Visual effects, pooled so the hot loops allocate nothing: tracer lines,
// impact sparks, muzzle flash, explosion smoke and rings, and thrown frag
// grenades. A tracer is one thin stretched box; sparks are small points
// that fade; an explosion ring is a flat circle that grows and fades. The
// ring and the smoke are driven by the step loop, not by timers, so they
// freeze with the game when a screenshot is staged.
import * as THREE from 'three';
import { DUSK } from './palette.js';

const TRACER_COUNT = 24;
const SPARK_COUNT = 400;

export function makeEffects(scene, solids) {
  const tracerPool = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: DUSK.bulb, transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracerPool.push({ mesh, life: 0 });
  }
  let tracerAt = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0.95 });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkAt = 0;

  const flash = new THREE.PointLight(0xffc46b, 0, 9, 1.6);
  scene.add(flash);
  let flashLeft = 0;

  const frags = [];
  const fragGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const fragMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.4, metalness: 0.7 });
  const scratch = new THREE.Vector3();

  // Rings and smoke puffs that grow and fade over their own lifetime.
  const anims = [];

  function trace(from, to, life = 0.07) {
    const t = tracerPool[tracerAt];
    tracerAt = (tracerAt + 1) % TRACER_COUNT;
    const dir = scratch.copy(to).sub(from);
    const len = dir.length();
    if (len < 0.1) return;
    t.mesh.position.copy(from).addScaledVector(dir, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = life;
  }

  function burst(at, count, color = 0xffc46b) {
    sparkMat.color.setHex(color);
    for (let n = 0; n < count; n += 1) {
      const i = sparkAt;
      sparkAt = (sparkAt + 1) % SPARK_COUNT;
      sparkPos[i * 3] = at.x;
      sparkPos[i * 3 + 1] = at.y;
      sparkPos[i * 3 + 2] = at.z;
      sparkVel[i * 3] = (Math.random() - 0.5) * 6;
      sparkVel[i * 3 + 1] = Math.random() * 4 + 1;
      sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 6;
      sparkLife[i] = 0.4 + Math.random() * 0.3;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  // A flat ring on the ground that grows outward and fades: the shockwave
  // of an explosion, so its blast radius reads at a glance.
  function shockwave(at, maxRadius = 5) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.08, at.z);
    scene.add(ring);
    anims.push({ kind: 'ring', mesh: ring, age: 0, span: 0.55, max: maxRadius });
  }

  function detonate(at) {
    burst(at, 90, 0xff8a3c);
    shockwave(at, 5);
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x555049, transparent: true, opacity: 0.5 }),
    );
    smoke.position.copy(at);
    scene.add(smoke);
    anims.push({ kind: 'smoke', mesh: smoke, age: 0, span: 0.9 });
    flash.position.copy(at);
    flash.intensity = 60;
    flashLeft = 0.18;
  }

  function lob(from, direction) {
    const mesh = new THREE.Mesh(fragGeo, fragMat);
    mesh.position.copy(from);
    scene.add(mesh);
    frags.push({
      mesh,
      velocity: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: 2.2,
      bounces: 0,
    });
  }

  function stepFrags(dt, onBurst) {
    for (let i = frags.length - 1; i >= 0; i -= 1) {
      const g = frags[i];
      g.fuse -= dt;
      g.velocity.y -= 14 * dt;
      const next = g.mesh.position.clone().addScaledVector(g.velocity, dt);
      // Simple bounce: stop the axis that entered a collider.
      const probe = new THREE.Box3(
        new THREE.Vector3(next.x - 0.09, next.y - 0.09, next.z - 0.09),
        new THREE.Vector3(next.x + 0.09, next.y + 0.09, next.z + 0.09),
      );
      let blocked = false;
      for (const s of solids) {
        if (probe.intersectsBox(s)) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        g.velocity.multiplyScalar(-0.4);
        g.velocity.y = Math.abs(g.velocity.y) * 0.4 + 1;
        g.bounces += 1;
      } else {
        g.mesh.position.copy(next);
      }
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) * 0.4;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
      }
      if (g.fuse <= 0) {
        const at = g.mesh.position.clone();
        scene.remove(g.mesh);
        frags.splice(i, 1);
        detonate(at);
        onBurst(at);
      }
    }
  }

  function tick(dt) {
    for (const t of tracerPool) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    let anyAlive = false;
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      if (sparkLife[i] > 0) {
        sparkLife[i] -= dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        sparkVel[i * 3 + 1] -= 9 * dt;
        if (sparkPos[i * 3 + 1] < 0.03) sparkPos[i * 3 + 1] = 0.03;
        anyAlive = true;
      } else {
        sparkPos[i * 3 + 1] = -100;
      }
    }
    if (anyAlive) sparkGeo.attributes.position.needsUpdate = true;
    if (flashLeft > 0) {
      flashLeft -= dt;
      if (flashLeft <= 0) flash.intensity = 0;
    }
    for (let i = anims.length - 1; i >= 0; i -= 1) {
      const a = anims[i];
      a.age += dt;
      const done = a.age >= a.span;
      if (a.kind === 'ring') {
        const grown = 1 + (a.age / a.span) * 9;
        a.mesh.scale.setScalar(Math.min(grown, a.max));
        a.mesh.material.opacity = Math.max(0, (1 - a.age / a.span) * 0.85);
      } else {
        a.mesh.scale.multiplyScalar(1 + dt * 1.4);
        a.mesh.material.opacity = Math.max(0, (1 - a.age / a.span) * 0.5);
      }
      if (done) {
        scene.remove(a.mesh);
        a.mesh.geometry.dispose();
        a.mesh.material.dispose();
        anims.splice(i, 1);
      }
    }
  }

  return {
    trace,
    burst,
    detonate,
    shockwave,
    lob,
    stepFrags,
    tick,
    flash(at) {
      flash.position.copy(at);
      flash.intensity = 26;
      flashLeft = 0.05;
    },
  };
}
