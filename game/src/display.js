// The HUD: every DOM readout — health, armour, ammo, money, timer,
// score, round history, alive counts, killfeed, crosshair spread,
// hitmarker, damage flash, plant progress, the buy menu and the start /
// pause / round / match overlays — plus a live top-down minimap drawn on
// a 2D canvas from the map's cover footprints.
import { GUNS, FRAG, VEST } from './weapons.js';

const SHOP_ROWS = [
  { id: 'rifle', key: '1' },
  { id: 'dmr', key: '2' },
  { id: 'smg', key: '3' },
  { id: 'shotgun', key: '4' },
  { id: 'sniper', key: '5' },
  { id: 'pistol', key: '6' },
  { id: 'grenade', key: '7' },
  { id: 'armor', key: '8' },
];

export function makeHud(hooks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    hp: $('hp-num'), hpBar: $('hp-bar'), armor: $('armor-num'),
    ammoCur: $('ammo-cur'), ammoSpare: $('ammo-spare'), ammoBox: $('ammo-box'),
    cash: $('cash-num'), clock: $('clock-num'), scoreV: $('score-v'),
    scoreE: $('score-e'), round: $('round-num'), aliveV: $('alive-v'),
    aliveE: $('alive-e'), feed: $('feed'), reticle: $('reticle'),
    hitmark: $('hitmark'), hurt: $('hurt-veil'), plant: $('plant-wrap'),
    plantFill: $('plant-fill'), plantText: $('plant-text'), veil: $('veil'),
    veilTitle: $('veil-title'), veilCopy: $('veil-copy'),
    playBtn: $('play-btn'), shop: $('shop'), shopList: $('shop-list'),
    shopCash: $('shop-cash'), shopClock: $('shop-clock'), carrying: $('carrying'),
    map: $('map'), shout: $('shout'),
    pips: $('pips'), frags: $('frags-num'),
  };
  const mapCtx = els.map ? els.map.getContext('2d') : null;
  let hitTimer = null;
  let shoutTimer = null;

  // Build the buy menu once.
  if (els.shopList) {
    for (const row of SHOP_ROWS) {
      const item = row.id === 'grenade' ? FRAG : row.id === 'armor' ? VEST : GUNS[row.id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shop-item';
      button.dataset.id = row.id;
      button.innerHTML = `<span class="shop-key">${row.key}</span><span class="shop-name">${item.label}</span><span class="shop-blurb">${item.blurb}</span><span class="shop-cost">$${item.cost}</span>`;
      button.addEventListener('click', () => hooks.onBuy(row.id));
      els.shopList.appendChild(button);
    }
  }
  els.playBtn.addEventListener('click', () => hooks.onPlay());

  function showOverlay(kind, data = {}) {
    els.veil.hidden = false;
    if (kind === 'start') {
      els.veilTitle.textContent = 'HARBOUR LINE';
      els.veilCopy.innerHTML = 'A round-based tactical shooter on the docks of Port Meridian. Plant the charge at Site A or Site B — or eliminate the Ember team. First to 7 rounds takes the match.<br><br>Click to play. Your team buys between rounds with <b>B</b>.';
      els.playBtn.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.veilTitle.textContent = 'Paused';
      els.veilCopy.textContent = 'The dock waits. Click to get back in.';
      els.playBtn.textContent = 'Resume';
    } else if (kind === 'round') {
      els.veilTitle.textContent = data.title;
      els.veilCopy.textContent = data.copy;
      els.playBtn.textContent = 'Next round';
    } else if (kind === 'match') {
      els.veilTitle.textContent = data.title;
      els.veilCopy.textContent = data.copy;
      els.playBtn.textContent = 'Play again';
    }
  }
  function hideOverlay() {
    els.veil.hidden = true;
  }

  function drawMinimap(view) {
    if (!mapCtx || !view.mapRects) return;
    const ctx = mapCtx;
    const W = els.map.width;
    const H = els.map.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20, 24, 32, 0.85)';
    ctx.fillRect(0, 0, W, H);
    const toX = (x) => ((x + 27) / 54) * W;
    const toZ = (z) => ((z + 19) / 38) * H;
    ctx.fillStyle = '#4d5a66';
    for (const r of view.mapRects) {
      ctx.fillRect(toX(r.x), toZ(r.z), Math.max(1, (r.w / 54) * W), Math.max(1, (r.d / 38) * H));
    }
    // Sites.
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    for (const [key, site] of [['A', view.sites.A], ['B', view.sites.B]]) {
      ctx.fillStyle = key === 'A' ? '#2fa8a0' : '#e05a2a';
      ctx.beginPath();
      ctx.arc(toX(site.x), toZ(site.z), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(key, toX(site.x), toZ(site.z) + 4);
    }
    // Charge.
    if (view.planted) {
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc(toX(view.planted.x), toZ(view.planted.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Dots: player, allies, enemies (only when recently seen).
    const dot = (x, z, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toX(x), toZ(z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const ally of view.allies) dot(ally.x, ally.z, '#2fa8a0', 2.5);
    for (const foe of view.enemies) dot(foe.x, foe.z, '#e05a2a', 2.5);
    dot(view.player.x, view.player.z, '#ffffff', 3.5);
    // Player facing tick.
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(toX(view.player.x), toZ(view.player.z));
    ctx.lineTo(toX(view.player.x) - Math.sin(view.player.yaw) * 8, toZ(view.player.z) - Math.cos(view.player.yaw) * 8);
    ctx.stroke();
  }

  return {
    setHealth(health, armor) {
      els.hp.textContent = Math.max(0, Math.ceil(health));
      els.hpBar.style.width = `${Math.max(0, Math.min(100, health))}%`;
      els.hpBar.classList.toggle('low', health <= 30);
      els.armor.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, spare, reloading) {
      els.ammoCur.textContent = reloading ? '--' : mag;
      els.ammoSpare.textContent = `/ ${spare}`;
      els.ammoBox.classList.toggle('empty', mag === 0);
    },
    setMoney(cash) {
      els.cash.textContent = `$${cash}`;
    },
    setTimer(seconds, urgent) {
      const s = Math.max(0, Math.ceil(seconds));
      els.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.clock.classList.toggle('urgent', !!urgent);
    },
    setScore(v, e, round) {
      els.scoreV.textContent = v;
      els.scoreE.textContent = e;
      els.round.textContent = `ROUND ${round}`;
    },
    // One pip per finished round, teal for Vanguard, orange for Ember.
    setHistory(log) {
      if (!els.pips) return;
      els.pips.textContent = '';
      for (const winner of log) {
        const pip = document.createElement('span');
        pip.className = winner === 'V' ? 'pip v' : 'pip e';
        els.pips.appendChild(pip);
      }
    },
    setKills(kills) {
      if (els.frags) els.frags.textContent = kills;
    },
    setAlive(v, e) {
      els.aliveV.textContent = `●`.repeat(v) + `○`.repeat(Math.max(0, 4 - v));
      els.aliveE.textContent = `●`.repeat(e) + `○`.repeat(Math.max(0, 4 - e));
    },
    setSpread(px) {
      els.reticle.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(kill, holdMs = 110) {
      els.hitmark.classList.add('on');
      els.hitmark.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmark.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      els.hurt.classList.add('on');
      setTimeout(() => els.hurt.classList.remove('on'), 220);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const line = document.createElement('div');
      line.className = `feed-line ${killerTeam}`;
      line.textContent = `${killer} ${headshot ? '◉' : '✕'} ${victim}`;
      els.feed.prepend(line);
      while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
    },
    announce(text, ms = 2600) {
      els.shout.textContent = text;
      els.shout.classList.add('on');
      clearTimeout(shoutTimer);
      shoutTimer = setTimeout(() => els.shout.classList.remove('on'), ms);
    },
    clearAnnounce() {
      clearTimeout(shoutTimer);
      els.shout.classList.remove('on');
    },
    setPlant(progress, label) {
      if (progress == null) {
        els.plant.hidden = true;
        return;
      }
      els.plant.hidden = false;
      els.plantFill.style.width = `${Math.round(progress * 100)}%`;
      els.plantText.textContent = label;
    },
    setCharge(carrying) {
      els.carrying.hidden = !carrying;
    },
    showBuy(cash, seconds) {
      els.shop.hidden = false;
      els.shopCash.textContent = `$${cash}`;
      els.shopClock.textContent = `Buy phase — ${Math.ceil(seconds)}s — press B or click to close`;
      for (const button of els.shopList.children) {
        button.classList.toggle('poor', Number(button.querySelector('.shop-cost').textContent.slice(1)) > cash);
      }
    },
    hideBuy() {
      els.shop.hidden = true;
    },
    buyFlash(ok) {
      els.shop.classList.remove('ok', 'no');
      void els.shop.offsetWidth;
      els.shop.classList.add(ok ? 'ok' : 'no');
    },
    showOverlay,
    hideOverlay,
    drawMinimap,
  };
}
