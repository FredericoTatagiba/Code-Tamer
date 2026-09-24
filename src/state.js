// @ts-nocheck
'use strict';

const { DIGIMON }                          = require('./data/digimon');
const { EVOLUTIONS, FRESH_EGGS, JOGRESS, DIVINE } = require('./data/evolutions');
const { XP_PER_NEW_EGG, XP_PER_STAR, XP_PER_DIVINE_EGG } = require('./xp');

const STATE_KEY = 'digimonState_v4';
const STAGE_SIZES = { 'Fresh': 24, 'In-Training': 32, 'Rookie': 48, 'Champion': 56, 'Ultimate': 62, 'Mega': 64 };

function canEvolve(name, xp) {
  const evo = EVOLUTIONS[name];
  return evo && evo.xpToEvolve !== null && xp >= evo.xpToEvolve && evo.evolvesTo.length > 0;
}

const pick = list => list[Math.floor(Math.random() * list.length)];

function makeDigi(name) {
  return { id: Date.now() + Math.floor(Math.random() * 1000), currentName: name, xp: 0, history: [name], visible: true, unhatched: false };
}

// DNA partners for digi present in the collection: [{ result, partnerId, partnerName }]
function fusionsFor(digi, collection) {
  return Object.entries(JOGRESS).flatMap(([result, pair]) => {
    const i = pair.indexOf(digi.currentName);
    if (i < 0) { return []; }
    const partner = collection.find(d => !d.unhatched && d.id !== digi.id && d.currentName === pair[1 - i]);
    return partner ? [{ result, partnerId: partner.id, partnerName: partner.currentName }] : [];
  });
}

function makeEgg() {
  return { id: Date.now() + Math.floor(Math.random() * 1000), currentName: null, xp: 0, history: [], visible: false, unhatched: true };
}

class DigimonState {
  constructor(ctx) {
    this.ctx = ctx;
    this._load();
  }

  // globalState is shared across windows; reload so a stale window can't overwrite a reset
  _load() {
    const saved = this.ctx.globalState.get(STATE_KEY);
    this.d = (saved && saved.collection) ? saved : null;
  }

  get ready()      { return this.d !== null && this.d.collection.length > 0; }
  get collection() { return this.d ? this.d.collection : []; }
  get totalXP()    { return this.d ? this.d.totalXP : 0; }

  hatchFirst() {
    const name = pick(FRESH_EGGS);
    this.d = { collection: [makeDigi(name)], totalXP: 0, eggsEarned: 0, selected: null };
    this._save();
    return name;
  }

  // returns 'divine' | true (new egg) | null
  addXP(n, fromClaude = false) {
    this._load();
    if (!this.ready) { return null; }
    this.d.totalXP += n;
    this.d.collection.forEach(digi => { if (!digi.unhatched) { digi.xp += n; digi.lifeXP = (digi.lifeXP || 0) + n; } });
    // egg progress always counts, even with eggs waiting to hatch
    this.d.eggXP = (this.d.eggXP || 0) + n;
    let newEgg = null;
    while (Math.floor(this.d.eggXP / XP_PER_NEW_EGG) > this.d.eggsEarned) {
      this.d.eggsEarned++;
      this.d.collection.push(makeEgg());
      newEgg = true;
    }
    if (fromClaude) {
      this.d.claudeXP = (this.d.claudeXP || 0) + n;
      while (Math.floor(this.d.claudeXP / XP_PER_DIVINE_EGG) > (this.d.divineEggsEarned || 0)) {
        this.d.divineEggsEarned = (this.d.divineEggsEarned || 0) + 1;
        this.d.collection.push(Object.assign(makeEgg(), { divine: true }));
        newEgg = 'divine';
      }
    }
    this._save();
    return newEgg;
  }

  hatchEgg(id) {
    this._load();
    const egg = this.d.collection.find(d => d.id === id && d.unhatched);
    if (!egg) { return null; }
    const name = pick(egg.divine ? DIVINE : FRESH_EGGS);
    egg.unhatched = false;
    egg.currentName = name;
    egg.history = [name];
    egg.visible = true;
    this._save();
    return name;
  }

  evolve(id, targetName) {
    this._load();
    const digi = this.d.collection.find(d => d.id === id);
    if (!digi || !DIGIMON[targetName]) { return; }
    const cost = (EVOLUTIONS[digi.currentName] || {}).xpToEvolve || 0;
    digi.history.push(targetName);
    digi.currentName = targetName;
    digi.xp = Math.max(0, digi.xp - cost); // keep overflow XP
    this._save();
  }

  resetDigi(id) {
    this._load();
    const digi = this.d.collection.find(d => d.id === id && !d.unhatched);
    if (!digi) { return; }
    digi.currentName = digi.history[0];
    digi.history = [digi.history[0]];
    digi.xp = 0;
    digi.lifeXP = 0;
    this._save();
  }

  toggleVisible(id) {
    this._load();
    const digi = this.d.collection.find(d => d.id === id);
    if (digi) { digi.visible = !digi.visible; this._save(); }
  }

  setSelected(id) {
    this._load();
    this.d.selected = (this.d.selected === id) ? null : id;
    this._save();
  }

  deselect() {
    this._load();
    this.d.selected = null;
    this._save();
  }

  release(id) {
    this._load();
    this.d.collection = this.d.collection.filter(d => d.id !== id);
    if (this.d.selected === id) { this.d.selected = null; }
    this._save();
  }

  // DNA Digivolution: both are consumed, XP is summed into the fused Digimon
  fuse(id, partnerId, result) {
    this._load();
    const a = this.d.collection.find(d => d.id === id && !d.unhatched);
    const b = this.d.collection.find(d => d.id === partnerId && !d.unhatched);
    const pair = JOGRESS[result];
    if (!a || !b || a === b || !pair || [a.currentName, b.currentName].sort().join() !== [...pair].sort().join()) { return false; }
    const fused = Object.assign(makeDigi(result), {
      xp:      a.xp + b.xp,
      lifeXP:  (a.lifeXP || 0) + (b.lifeXP || 0),
      history: [...a.history, result],
    });
    this.d.collection = this.d.collection.filter(d => d !== b).map(d => d === a ? fused : d);
    if (this.d.selected === id || this.d.selected === partnerId) { this.d.selected = null; }
    this._save();
    return true;
  }

  add(name) {
    this._load();
    this.d.collection.push(makeDigi(name));
    this._save();
  }

  reset() { this.d = null; this._save(); }
  _save() { this.ctx.globalState.update(STATE_KEY, this.d); }

  snapshot() {
    this._load();
    if (!this.ready) { return { initialized: false }; }
    const selectedId = this.d.selected;
    const collection = this.d.collection.map(digi => {
      if (digi.unhatched) { return { id: digi.id, unhatched: true, divine: !!digi.divine }; }
      const mon = DIGIMON[digi.currentName];
      const evo = EVOLUTIONS[digi.currentName];
      if (!mon) {
        // Digimon name no longer exists in data — skip it
        return { id: digi.id, unhatched: true };
      }
      const opts = evo ? evo.evolvesTo.filter(n => DIGIMON[n]).map(n => ({ name: n, sprite: DIGIMON[n].sprite, stage: DIGIMON[n].stage })) : [];
      const isMega = !evo || evo.xpToEvolve === null;
      // branches not taken at each past evolution step
      const skipped = digi.history.slice(0, -1).flatMap((n, i) =>
        ((EVOLUTIONS[n] || {}).evolvesTo || []).filter(t => t !== digi.history[i + 1]));
      return {
        stars:       isMega ? Math.floor(digi.xp / XP_PER_STAR) : 0,
        starXP:      isMega ? digi.xp % XP_PER_STAR : 0,
        lifeXP:      digi.lifeXP || 0,
        skipped,
        id:          digi.id,
        size:        (JOGRESS[digi.currentName] || DIVINE.includes(digi.currentName)) ? 80 : (STAGE_SIZES[mon.stage] || 48),
        name:        digi.currentName,
        stage:       mon.stage,
        sprite:      mon.sprite,
        xp:          digi.xp,
        xpToEvolve:  evo ? evo.xpToEvolve : null,
        xpPct:       (evo && evo.xpToEvolve) ? Math.min(100, digi.xp / evo.xpToEvolve * 100) : 100,
        canEvolve:   canEvolve(digi.currentName, digi.xp),
        nextOptions: opts,
        fusions:     fusionsFor(digi, this.d.collection),
        history:     digi.history,
        visible:     digi.visible,
        selected:    digi.id === selectedId,
      };
    });
    const spritesNeeded = new Set();
    collection.filter(d => !d.unhatched).forEach(d => {
      spritesNeeded.add(d.sprite);
      d.nextOptions.forEach(o => spritesNeeded.add(o.sprite));
    });
    return {
      initialized:   true,
      collection,
      totalXP:       this.d.totalXP,
      nextEggXP:     XP_PER_NEW_EGG * (this.d.eggsEarned + 1),
      eggXP:         this.d.eggXP || 0,
      spritesNeeded: [...spritesNeeded],
    };
  }
}

module.exports = { DigimonState, canEvolve, fusionsFor };
