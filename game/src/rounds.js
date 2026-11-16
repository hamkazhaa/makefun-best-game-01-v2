// The match state machine of Harbour Line. A match runs menu → buy →
// play → round end → buy …, until one team has won 7 rounds. Vanguard
// attacks: it carries the charge and takes a round by planting it and
// letting it blow, or by eliminating Ember. Ember defends and takes a
// round by elimination, by running the clock out, or by defusing a planted
// charge. Kills, plants and round wins pay money; the buy phase spends it;
// losing rounds pay a streak bonus that grows with each loss in a row.
// Every round's winner is remembered, so the HUD can show the match's
// story as a row of pips, and the player's kills are counted for the
// match-end screen.
import * as THREE from 'three';
import { ARENA } from './port.js';
import { GUNS, FRAG, VEST } from './weapons.js';

const ROUND_LEN = 100;
const BUY_LEN = 15;
const PLANT_SECS = 3;
const DEFUSE_SECS = 5;
const FUSE_SECS = 35;
const TARGET_ROUNDS = 7;
const CAP_ROUNDS = 13;

const PAY_KILL = 300;
const PAY_WIN = 3250;
const PAY_LOSS = 1900;
const STREAK_STEP = 500;
const STREAK_CAP = 1500;
const OPENING_CASH = 800;
const DEFUSE_REACH = 2.2;
const END_PAUSE = 2.2;

export function makeMatch(deps) {
  const { player, bots, hud, audio } = deps;
  const state = {
    phase: 'menu',
    round: 1,
    scoreV: 0,
    scoreE: 0,
    cash: OPENING_CASH,
    clock: ROUND_LEN,
    buyClock: BUY_LEN,
    charge: null, // {site, x, z, timer}
    carrier: 'player', // 'player' or a bot id
    streak: 0,
    over: false,
    log: [], // 'V' or 'E', one entry per finished round
    kills: 0, // the player's kills this match
    deaths: 0,
  };
  let current = null; // the player's channel {type, progress, site}
  let endedFor = 0;

  // Everyone still standing on a team, counting the player on Vanguard.
  function teamAlive(team) {
    const botCount = bots.countAlive(team);
    const playerCount = team === 'vanguard' && player.rig.alive ? 1 : 0;
    return botCount + playerCount;
  }

  function openBuy() {
    state.phase = 'buy';
    state.buyClock = BUY_LEN;
    state.clock = ROUND_LEN;
    state.charge = null;
    state.over = false;
    current = null;
    player.respawn(ARENA.vanguardSpawns[0]);
    // The charge goes to the player on odd rounds and to Rook on even ones.
    state.carrier = state.round % 2 === 1 ? 'player' : 'vanguard-0';
    bots.fieldSquad(state.round, state.carrier);
    const carrierBot = bots.chargeCarrier();
    if (state.carrier === 'player') {
      hud.setCharge(true);
      hud.announce('You carry the charge — plant it at Site A or Site B');
    } else {
      hud.setCharge(false);
      if (carrierBot) hud.announce(`${carrierBot.name} carries the charge`);
    }
    hud.setScore(state.scoreV, state.scoreE, state.round);
    hud.setHistory(state.log);
    hud.setMoney(state.cash);
    hud.setTimer(state.clock);
    hud.setPlant(null);
    hud.showBuy(state.cash, state.buyClock);
    audio.tick();
  }

  function beginMatch() {
    state.round = 1;
    state.scoreV = 0;
    state.scoreE = 0;
    state.cash = OPENING_CASH;
    state.streak = 0;
    state.log = [];
    state.kills = 0;
    state.deaths = 0;
    hud.setKills(0);
    openBuy();
  }

  function showResult() {
    const won = state.scoreV > state.scoreE;
    hud.showOverlay('match', {
      title: won ? 'MATCH WON — THE DOCK IS YOURS' : 'MATCH LOST',
      copy: `Final score — Vanguard ${state.scoreV} : ${state.scoreE} Ember. You scored ${state.kills} kill${state.kills === 1 ? '' : 's'} and fell ${state.deaths} time${state.deaths === 1 ? '' : 's'}. ${won ? 'Harbour Line will remember this one.' : 'The Ember team holds the dock. Run it back.'}`,
    });
    if (won) audio.roundWin();
    else audio.roundLose();
  }

  function settleRound(winner, reason) {
    if (state.over) return;
    state.over = true;
    state.phase = 'roundEnd';
    endedFor = 0;
    hud.hideBuy();
    hud.setPlant(null);
    if (winner === 'vanguard') {
      state.scoreV += 1;
      state.cash += PAY_WIN;
      state.streak = 0;
      audio.roundWin();
    } else {
      state.scoreE += 1;
      state.cash += PAY_LOSS + Math.min(STREAK_CAP, state.streak * STREAK_STEP);
      state.streak += 1;
      audio.roundLose();
    }
    state.log.push(winner === 'vanguard' ? 'V' : 'E');
    hud.setHistory(state.log);
    hud.setScore(state.scoreV, state.scoreE, state.round);
    hud.setMoney(state.cash);
    const title = winner === 'vanguard' ? 'ROUND WON' : 'ROUND LOST';
    hud.showOverlay('round', {
      title,
      copy: `${reason} — Vanguard ${state.scoreV} : ${state.scoreE} Ember. $${state.cash} in your pocket.`,
    });
    if (state.scoreV >= TARGET_ROUNDS || state.scoreE >= TARGET_ROUNDS || state.round >= CAP_ROUNDS) {
      state.phase = 'matchEnd';
      showResult();
    }
  }

  function advance() {
    if (state.phase === 'matchEnd') {
      beginMatch();
      return;
    }
    state.round += 1;
    openBuy();
  }

  function checkWipe() {
    if (state.over || state.phase !== 'play') return;
    const vanguard = teamAlive('vanguard');
    const ember = teamAlive('ember');
    hud.setAlive(vanguard, ember);
    if (ember === 0) {
      settleRound('vanguard', state.charge ? 'Charge detonated' : 'Ember team eliminated');
    } else if (vanguard === 0) {
      settleRound('ember', 'Vanguard team eliminated');
    }
  }

  function recordKill(killerTeam, killerName, victimTeam, victimName, headshot) {
    hud.killfeed(killerName, victimName, headshot, killerTeam);
    if (killerName === 'You') {
      state.cash += PAY_KILL;
      state.kills += 1;
      hud.setKills(state.kills);
      hud.setMoney(state.cash);
      audio.kill();
    }
    if (victimName === 'You') state.deaths += 1;
    checkWipe();
  }

  // Spend money in the buy phase. Returns false when the purchase is
  // refused.
  function purchase(itemId) {
    if (state.phase !== 'buy') return false;
    const item = itemId === 'grenade' ? FRAG : itemId === 'armor' ? VEST : GUNS[itemId];
    if (!item || state.cash < item.cost) {
      audio.denied();
      hud.buyFlash(false);
      return false;
    }
    if (itemId === 'grenade') {
      if (deps.loadout.frags >= 2) {
        audio.denied();
        hud.buyFlash(false);
        return false;
      }
      deps.loadout.frags += 1;
    } else if (itemId === 'armor') {
      if (player.rig.armor >= 50) {
        audio.denied();
        hud.buyFlash(false);
        return false;
      }
      player.rig.armor = 50;
    } else {
      deps.swapGun(itemId);
    }
    state.cash -= item.cost;
    hud.setMoney(state.cash);
    hud.showBuy(state.cash, state.buyClock);
    hud.buyFlash(true);
    audio.buy();
    return true;
  }

  // Which channel goal, if any, is available to the player right now?
  function goalAt(playerPos) {
    if (!state.charge) {
      for (const siteKey of ['A', 'B']) {
        const site = ARENA.sites[siteKey];
        const dist = Math.hypot(playerPos.x - site.x, playerPos.z - site.z);
        const inSite = dist < site.radius && state.carrier === 'player';
        if (inSite) return { type: 'plant', site: siteKey, need: PLANT_SECS };
      }
      return null;
    }
    const dist = Math.hypot(playerPos.x - state.charge.x, playerPos.z - state.charge.z);
    if (dist < DEFUSE_REACH) {
      return { type: 'defuse', site: state.charge.site, need: DEFUSE_SECS };
    }
    return null;
  }

  function completeChannel(goal) {
    if (goal.type === 'plant') {
      const site = ARENA.sites[goal.site];
      state.charge = { site: goal.site, x: site.x, z: site.z, timer: FUSE_SECS };
      state.carrier = null;
      hud.setCharge(false);
      hud.announce('Charge planted — defend it!');
      audio.planted();
      state.cash += PAY_KILL;
      hud.setMoney(state.cash);
    } else {
      const site = state.charge.site;
      state.charge = null;
      hud.announce('Charge defused!');
      settleRound('ember', `Charge at Site ${site} defused`);
    }
  }

  // Holding E near a site plants the charge; holding E near a planted
  // charge defuses it. Letting go, or stepping away, cancels the channel.
  function channel(dt, keys, playerPos) {
    if (state.phase !== 'play' || !player.rig.alive) {
      current = null;
      hud.setPlant(null);
      return;
    }
    const holding = keys.has('KeyE');
    const goal = goalAt(playerPos);
    if (!goal || !holding) {
      if (current) audio.denied();
      current = null;
      hud.setPlant(null);
      return;
    }
    if (!current || current.type !== goal.type) {
      current = { type: goal.type, progress: 0, site: goal.site };
    }
    current.progress += dt / goal.need;
    const label = goal.type === 'plant' ? 'PLANTING CHARGE…' : 'DEFUSING CHARGE…';
    hud.setPlant(current.progress, label);
    if (Math.random() < dt * 3) {
      if (goal.type === 'plant') audio.plantBeep();
      else audio.defuseBeep();
    }
    if (current.progress >= 1) {
      completeChannel(goal);
      current = null;
      hud.setPlant(null);
    }
  }

  function tick(dt) {
    if (state.phase === 'buy') {
      state.buyClock -= dt;
      hud.showBuy(state.cash, Math.max(0, state.buyClock));
      if (state.buyClock <= 0) {
        state.phase = 'play';
        state.clock = ROUND_LEN;
        hud.hideBuy();
        hud.announce(`Round ${state.round} — plant the charge or eliminate Ember`);
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      endedFor += dt;
      if (endedFor > END_PAUSE) advance();
      return;
    }
    if (state.phase !== 'play') return;
    state.clock -= dt;
    hud.setTimer(state.clock, state.clock <= 10);
    if (state.clock <= 10.5 && state.clock > 10.4) audio.tick();
    if (state.charge) {
      state.charge.timer -= dt;
      hud.setTimer(state.charge.timer, true);
      if (state.charge.timer <= 0) {
        deps.onDetonate(state.charge);
        state.charge = null;
        settleRound('vanguard', 'Charge detonated at the site');
        return;
      }
    }
    if (state.clock <= 0) {
      settleRound('ember', state.charge ? 'Time expired' : 'Time expired — charge never planted');
    }
  }

  // Find the site a bot is standing in, or null.
  function siteBelow(bot) {
    for (const key of ['A', 'B']) {
      const site = ARENA.sites[key];
      const d = Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z);
      if (d < site.radius) return { key, site };
    }
    return null;
  }

  // The read-only view of the match the bot AI gets every step.
  function scoutView(playerEye, playerSpeed) {
    return {
      sites: ARENA.sites,
      planted: !!state.charge,
      plantSite(bot) {
        // A carrier bot standing inside a site may plant the charge there.
        const found = siteBelow(bot);
        return found ? found.site : null;
      },
      nearSite(bot) {
        const a = ARENA.sites.A;
        const b = ARENA.sites.B;
        const da = Math.hypot(bot.pos.x - a.x, bot.pos.z - a.z);
        const db = Math.hypot(bot.pos.x - b.x, bot.pos.z - b.z);
        return da < db ? a : b;
      },
      enemyLastX: playerEye.x,
      enemyLastZ: playerEye.z,
      enemiesOf(bot) {
        const list = [];
        if (bot.team === 'ember') {
          list.push({ isPlayer: true, alive: player.rig.alive, eyePos: playerEye, speed: playerSpeed });
          for (const ally of bots.roster) {
            if (ally.team === 'vanguard' && ally.alive) {
              list.push({
                isPlayer: false,
                bot: ally,
                alive: true,
                eyePos: new THREE.Vector3(ally.pos.x, ally.pos.y + 1.5, ally.pos.z),
                speed: 0,
              });
            }
          }
        } else {
          for (const enemy of bots.roster) {
            if (enemy.team === 'ember' && enemy.alive) {
              list.push({
                isPlayer: false,
                bot: enemy,
                alive: true,
                eyePos: new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.5, enemy.pos.z),
                speed: 0,
              });
            }
          }
        }
        return list;
      },
    };
  }

  function botPlanted(bot) {
    if (state.phase !== 'play' || state.charge) return;
    // Work out which site the bot is standing in.
    const found = siteBelow(bot);
    if (found) {
      state.charge = { site: found.key, x: found.site.x, z: found.site.z, timer: FUSE_SECS };
      state.carrier = null;
      hud.setCharge(false);
      hud.announce(`Charge planted at Site ${found.key} — defuse it!`);
      audio.planted();
    }
  }

  function botDefused() {
    if (!state.charge) return;
    const site = state.charge.site;
    state.charge = null;
    hud.announce('Charge defused by Ember!');
    settleRound('ember', `Charge at Site ${site} defused`);
  }

  return {
    state,
    beginMatch,
    openBuy,
    settleRound,
    advance,
    recordKill,
    channel,
    purchase,
    tick,
    scoutView,
    teamAlive,
    botPlanted,
    botDefused,
  };
}
