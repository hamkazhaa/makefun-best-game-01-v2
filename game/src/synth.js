// Synthesised sound: every effect is built from WebAudio oscillators and
// filtered noise at runtime, so the game ships no audio files and needs no
// network. Sounds are created lazily on the first user gesture (browsers
// require it). The round horn is new: a low two-note call when a round
// opens, so the buy phase ends with a sound as well as a sight.
export function makeAudio() {
  let ctx = null;
  let master = null;
  let on = true;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function noise(seconds) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function rumble({ len = 0.12, freq = 1200, shape = 'lowpass', vol = 0.5, drop = null }) {
    if (!on || !ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(len + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = shape;
    filter.frequency.setValueAtTime(freq, t);
    if (drop) filter.frequency.exponentialRampToValueAtTime(Math.max(40, drop), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + len + 0.05);
  }

  function blip({ freq = 440, glide = null, len = 0.1, wave = 'sine', vol = 0.2, at = 0 }) {
    if (!on || !ensure()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + len + 0.05);
  }

  const SHOT_TABLE = {
    pistol: { len: 0.1, freq: 2600, drop: 500, vol: 0.5 },
    smg: { len: 0.08, freq: 3000, drop: 700, vol: 0.42 },
    rifle: { len: 0.13, freq: 1800, drop: 320, vol: 0.55 },
    dmr: { len: 0.16, freq: 2100, drop: 260, vol: 0.6 },
    sniper: { len: 0.22, freq: 1400, drop: 180, vol: 0.7 },
    shotgun: { len: 0.18, freq: 1100, drop: 220, vol: 0.7 },
  };

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    toggle() {
      on = !on;
      return on;
    },
    shot(kind) {
      const spec = SHOT_TABLE[kind] || SHOT_TABLE.rifle;
      rumble(spec);
      blip({ freq: 160, glide: 55, len: 0.09, wave: 'triangle', vol: 0.35 });
    },
    distantShot() {
      rumble({ len: 0.09, freq: 900, drop: 300, vol: 0.16 });
    },
    dryFire() {
      blip({ freq: 1200, len: 0.03, wave: 'square', vol: 0.08 });
    },
    reload() {
      blip({ freq: 500, len: 0.04, wave: 'square', vol: 0.1 });
      blip({ freq: 700, len: 0.04, wave: 'square', vol: 0.1, at: 0.18 });
      blip({ freq: 900, len: 0.05, wave: 'square', vol: 0.12, at: 0.42 });
    },
    hit() {
      blip({ freq: 1500, len: 0.05, vol: 0.22 });
    },
    headshot() {
      blip({ freq: 1900, len: 0.06, vol: 0.25 });
      blip({ freq: 2400, len: 0.08, vol: 0.2, at: 0.05 });
    },
    hurt() {
      blip({ freq: 220, glide: 90, len: 0.16, wave: 'sawtooth', vol: 0.25 });
    },
    kill() {
      blip({ freq: 660, len: 0.07, vol: 0.2 });
      blip({ freq: 990, len: 0.1, vol: 0.2, at: 0.07 });
    },
    plantBeep() {
      blip({ freq: 1100, len: 0.07, wave: 'square', vol: 0.14 });
    },
    planted() {
      blip({ freq: 880, len: 0.12, wave: 'square', vol: 0.16 });
      blip({ freq: 880, len: 0.12, wave: 'square', vol: 0.16, at: 0.18 });
    },
    defuseBeep() {
      blip({ freq: 700, len: 0.07, wave: 'square', vol: 0.14 });
    },
    explosion() {
      rumble({ len: 0.9, freq: 500, drop: 60, vol: 0.9 });
      blip({ freq: 90, glide: 30, len: 0.8, vol: 0.6 });
    },
    grenadePin() {
      blip({ freq: 1400, len: 0.03, wave: 'square', vol: 0.1 });
    },
    buy() {
      blip({ freq: 1200, len: 0.05, vol: 0.16 });
      blip({ freq: 1600, len: 0.07, vol: 0.16, at: 0.06 });
    },
    denied() {
      blip({ freq: 220, len: 0.12, wave: 'square', vol: 0.15 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => blip({ freq: f, len: 0.16, wave: 'triangle', vol: 0.2, at: i * 0.12 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => blip({ freq: f, len: 0.18, wave: 'triangle', vol: 0.18, at: i * 0.13 }));
    },
    horn() {
      blip({ freq: 196, len: 0.35, wave: 'sawtooth', vol: 0.14 });
      blip({ freq: 294, len: 0.4, wave: 'sawtooth', vol: 0.14, at: 0.28 });
    },
    tick() {
      blip({ freq: 1000, len: 0.04, vol: 0.12 });
    },
  };
}
