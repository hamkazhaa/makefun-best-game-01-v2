// Keyboard and mouse input, with pointer lock. The simulation never
// reads the DOM for keys: this module keeps one Set of held codes and a
// small look delta the fixed-step loop drains, so input and simulation
// stay decoupled. A press is consumed once (tap), so one tap never fires
// twice. Mouse buttons report both a held state and a one-shot edge.
export function makeInput(canvas, onGrab) {
  const held = new Set();
  const look = { dx: 0, dy: 0 };
  let grabbed = false;
  let triggerHeld = false;
  let triggerEdge = false;
  let sightHeld = false;

  function keyDown(ev) {
    if (ev.repeat) return;
    held.add(ev.code);
    if (ev.code === 'Space') ev.preventDefault();
  }
  function keyUp(ev) {
    held.delete(ev.code);
  }
  function mouseMoved(ev) {
    if (!grabbed) return;
    look.dx += ev.movementX;
    look.dy += ev.movementY;
  }
  function mouseDown(ev) {
    if (!grabbed) return;
    if (ev.button === 0) {
      triggerHeld = true;
      triggerEdge = true;
    }
    if (ev.button === 2) sightHeld = true;
  }
  function mouseUp(ev) {
    if (ev.button === 0) triggerHeld = false;
    if (ev.button === 2) sightHeld = false;
  }
  function lockChanged() {
    grabbed = document.pointerLockElement === canvas;
    if (!grabbed) {
      triggerHeld = false;
      sightHeld = false;
    }
    onGrab(grabbed);
  }
  function blockMenu(ev) {
    ev.preventDefault();
  }

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  document.addEventListener('mousemove', mouseMoved);
  document.addEventListener('mousedown', mouseDown);
  document.addEventListener('mouseup', mouseUp);
  document.addEventListener('pointerlockchange', lockChanged);
  canvas.addEventListener('contextmenu', blockMenu);

  return {
    held,
    get firing() {
      return triggerHeld;
    },
    get aiming() {
      return sightHeld;
    },
    grabbed() {
      return grabbed;
    },
    grab() {
      if (!grabbed) canvas.requestPointerLock();
    },
    drop() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    drainLook() {
      const out = { dx: look.dx, dy: look.dy };
      look.dx = 0;
      look.dy = 0;
      return out;
    },
    tapTrigger() {
      const edge = triggerEdge;
      triggerEdge = false;
      return edge;
    },
    tap(code) {
      if (!held.has(code)) return false;
      held.delete(code);
      return true;
    },
    reset() {
      held.clear();
      triggerHeld = false;
      sightHeld = false;
      look.dx = 0;
      look.dy = 0;
    },
  };
}
