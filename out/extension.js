// @ts-nocheck
'use strict';

const vscode = require('vscode');
const { DIGIMON }                = require('./data/digimon');
const { EVOLUTIONS, FRESH_EGGS, JOGRESS } = require('./data/evolutions');

const STAGE_SIZES = { 'Fresh': 24, 'In-Training': 32, 'Rookie': 48, 'Champion': 56, 'Ultimate': 62, 'Mega': 64 };
const XP_SAVE        = 5;
const XP_CLEAN_SAVE  = 3;   // bonus: saved with no error diagnostics
const XP_EDIT        = 1;
const XP_TERMINAL    = 3;
const XP_TEST_PASS   = 15;  // bonus: test command exited 0
const XP_COMMIT      = 10;
const XP_PER_NEW_EGG = 500;
const XP_PER_STAR    = 1000; // Mega prestige
const TEST_CMD       = /(^|\s|\/)(pytest|jest|vitest|phpunit|pest|mocha|rspec)(\s|$)|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(artisan|go|cargo|dotnet|mvn|gradle|make)\s+test\b/;

function isTestCommand(cmd) {
  return !/^\s*git\b/.test(cmd) && TEST_CMD.test(cmd);
}
const STATE_KEY      = 'digimonState_v4';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function canEvolve(name, xp) {
  const evo = EVOLUTIONS[name];
  return evo && evo.xpToEvolve !== null && xp >= evo.xpToEvolve && evo.evolvesTo.length > 0;
}

function randomEgg() {
  return FRESH_EGGS[Math.floor(Math.random() * FRESH_EGGS.length)];
}

// modal: Do Not Disturb hides non-modal warnings and their promise never resolves
async function confirm(message) {
  return (await vscode.window.showWarningMessage(message, { modal: true }, 'Yes')) === 'Yes';
}

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

// ─── State ────────────────────────────────────────────────────────────────────

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
    const name = randomEgg();
    this.d = { collection: [makeDigi(name)], totalXP: 0, eggsEarned: 0, selected: null };
    this._save();
    return name;
  }

  addXP(n) {
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
    this._save();
    return newEgg;
  }

  hatchEgg(id) {
    this._load();
    const egg = this.d.collection.find(d => d.id === id && d.unhatched);
    if (!egg) { return null; }
    const name = randomEgg();
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
      if (digi.unhatched) { return { id: digi.id, unhatched: true }; }
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
        size:        JOGRESS[digi.currentName] ? 80 : (STAGE_SIZES[mon.stage] || 48),
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

// ─── Sidebar Provider ─────────────────────────────────────────────────────────

class DigimonSidebarProvider {
  constructor(ctx, state) {
    this.ctx = ctx; this.state = state; this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.ctx.extensionUri, 'sprites'),
        vscode.Uri.joinPath(this.ctx.extensionUri, 'media'),
      ]
    };
    this._buildHtml(); // build full HTML once

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'hatchEgg': {
          const name = this.state.hatchEgg(msg.id);
          if (name) { this._buildHtml(); vscode.window.showInformationMessage('🥚 ' + name + ' has hatched!'); }
          break;
        }
        case 'hatch': {
          const name = this.state.hatchFirst();
          this._buildHtml();
          vscode.window.showInformationMessage('🥚 ' + name + ' has hatched!');
          break;
        }
        case 'evolve': {
          this.state.evolve(msg.id, msg.target);
          this.state.deselect();
          this._buildHtml();
          vscode.window.showInformationMessage('✨ Digivolved into ' + msg.target + '!');
          break;
        }
        case 'toggleVisible': {
          this.state.toggleVisible(msg.id);
          // Full rebuild — arena walkers change
          this._buildHtml();
          break;
        }
        case 'select': {
          this.state.setSelected(msg.id);
          // Only update the UI data, don't rebuild HTML (keeps arena alive)
          this._pushUpdate();
          break;
        }
        case 'release': {
          if (await confirm('Release this Digimon?')) { this.state.release(msg.id); this._buildHtml(); }
          break;
        }
        case 'fuse': {
          const digi = this.state.collection.find(d => d.id === msg.id);
          const opts = digi ? fusionsFor(digi, this.state.collection) : [];
          if (!opts.length) { break; }
          const pick = await vscode.window.showWarningMessage(
            'DNA Digivolve ' + opts.map(o => digi.currentName + ' + ' + o.partnerName + ' → ' + o.result).join(', ') + '? Both Digimon are consumed.',
            { modal: true }, ...opts.map(o => o.result));
          const opt = opts.find(o => o.result === pick);
          if (opt && this.state.fuse(digi.id, opt.partnerId, opt.result)) {
            this._buildHtml();
            vscode.window.showInformationMessage('🧬 DNA Digivolved into ' + opt.result + '!');
          }
          break;
        }
        case 'resetDigi': {
          if (await confirm('Reset this Digimon to its first form?')) { this.state.resetDigi(msg.id); this._buildHtml(); }
          break;
        }
        case 'reset': {
          if (await confirm('Reset everything?')) { this.state.reset(); this._buildHtml(); }
          break;
        }
      }
    });
  }

  // Called on XP events — only push a data update, never touch the HTML
  refresh(newEgg) {
    if (!this._view) { return; }
    if (newEgg) {
      vscode.window.showInformationMessage('🥚 A new egg appeared in your roster!');
      this._buildHtml(); // egg added to roster, need to rebuild
    } else {
      this._pushUpdate(); // XP changed — just update numbers, leave arena alone
    }
  }

  // Send updated state to the already-loaded webview JS
  _pushUpdate() {
    if (!this._view) { return; }
    const snap = this.state.snapshot();
    this._view.webview.postMessage({ command: 'update', snap, uris: this._uris(snap) });
    this._updateBadge();
  }

  // Full HTML rebuild — only for structural changes (new digimon, evolve, hatch)
  _buildHtml() {
    if (!this._view) { return; }
    const snap  = this.state.snapshot();
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const csp   = this._view.webview.cspSource;

    this._view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${csp} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--vscode-sideBar-background); color:var(--vscode-foreground); font-family:var(--vscode-font-family,sans-serif); font-size:12px; padding:10px; display:flex; flex-direction:column; height:100vh; }

.egg-screen { text-align:center; padding:20px 0; }
.egg-screen h2 { font-size:14px; color:#89b4fa; margin-bottom:6px; }
.egg-screen p  { font-size:11px; opacity:.6; margin-bottom:16px; line-height:1.6; }
.egg-icon  { font-size:52px; margin-bottom:16px; display:block; animation:wobble 2s ease-in-out infinite; }
@keyframes wobble { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(8deg)} }
.hatch-btn { background:#89b4fa; color:#11111b; border:none; border-radius:6px; padding:8px 20px; font-size:12px; font-weight:700; cursor:pointer; }
.hatch-btn:hover { opacity:.85; }

.arena { background:var(--vscode-editor-background); border:1px solid var(--vscode-panel-border,#444); border-radius:8px; height:110px; position:relative; overflow:hidden; margin-bottom:10px; }
.walker { image-rendering:pixelated; position:absolute; bottom:10px; animation:walk 12s linear infinite; cursor:pointer; }
@keyframes walk {
  0%    { left:-32px;       transform:scaleX(1);  }
  48%   { left:calc(100%);  transform:scaleX(1);  }
  50%   { left:calc(100%);  transform:scaleX(-1); }
  98%   { left:-32px;       transform:scaleX(-1); }
  100%  { left:-32px;       transform:scaleX(1);  }
}

.xp-section { margin-bottom:10px; }
.row { display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px; }
.lbl { opacity:.6; }
.val { font-weight:700; color:#f9e2af; }
.bar-bg   { background:var(--vscode-panel-border,#444); border-radius:4px; height:6px; overflow:hidden; }
.bar-fill { height:100%; background:linear-gradient(90deg,#89b4fa,#a6e3a1); border-radius:4px; transition:width .4s; }

.evo-box   { background:var(--vscode-editor-background); border:1px solid #a6e3a1; border-radius:6px; padding:8px; margin-bottom:10px; text-align:center; }
.evo-title { font-size:11px; color:#a6e3a1; font-weight:700; margin-bottom:6px; }
.evo-opts  { display:flex; gap:6px; justify-content:center; flex-wrap:wrap; }
.evo-btn   { background:#a6e3a1; color:#11111b; border:none; border-radius:5px; padding:5px 12px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px; }
.evo-btn img { width:24px; height:24px; image-rendering:pixelated; }
.evo-btn:hover { opacity:.8; }
.evo-stage { font-size:8px; opacity:.6; }
.card { background:var(--vscode-editor-background); border:1px solid var(--vscode-panel-border,#444); border-radius:6px; padding:6px 8px; margin-bottom:10px; }
.card-line { font-size:10px; color:#89b4fa; margin-top:3px; line-height:1.5; }
.card-skip { font-size:9px; opacity:.45; margin-top:3px; line-height:1.5; }
.stars { color:#f9e2af; font-size:10px; }
.mega { text-align:center; font-size:11px; color:#f9e2af; background:var(--vscode-editor-background); border:1px solid #f9e2af; border-radius:6px; padding:6px; margin-bottom:10px; }

.roster-label { font-size:9px; opacity:.4; margin-bottom:6px; text-transform:uppercase; letter-spacing:.5px; }
.roster { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; flex:1; overflow-y:auto; padding-right:2px; }
.roster::-webkit-scrollbar { width:4px; }
.roster::-webkit-scrollbar-track { background:transparent; }
.roster::-webkit-scrollbar-thumb { background:var(--vscode-panel-border,#444); border-radius:2px; }
.roster-row { display:flex; align-items:center; gap:6px; background:var(--vscode-editor-background); border:1px solid var(--vscode-panel-border,#444); border-radius:6px; padding:5px 7px; cursor:pointer; }
.roster-row.selected   { border-color:#89b4fa; }
.roster-row.hidden-digi { opacity:.45; }
.roster-row.can-evolve { border-color:#a6e3a1; box-shadow:0 0 6px rgba(166,227,161,0.35); animation:evo-pulse 2s ease-in-out infinite; }
@keyframes evo-pulse { 0%,100%{box-shadow:0 0 4px rgba(166,227,161,0.3)} 50%{box-shadow:0 0 10px rgba(166,227,161,0.6)} }
.roster-sprite { width:28px; height:28px; image-rendering:pixelated; flex-shrink:0; }
.roster-info { flex:1; min-width:0; }
.roster-name  { font-size:11px; font-weight:700; color:#89b4fa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.roster-stage { font-size:9px; opacity:.5; }
.roster-actions { display:flex; gap:4px; flex-shrink:0; }
.icon-btn { background:none; border:1px solid var(--vscode-panel-border,#444); color:var(--vscode-foreground); border-radius:4px; width:22px; height:22px; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; opacity:.6; }
.icon-btn:hover { opacity:1; }
.icon-btn.danger:hover { border-color:#f38ba8; color:#f38ba8; }

.egg-progress { margin-bottom:10px; }
.footer { display:flex; justify-content:space-between; align-items:center; }
.total  { font-size:9px; opacity:.4; }
.rst-btn { background:none; border:1px solid var(--vscode-panel-border,#444); color:var(--vscode-foreground); border-radius:4px; padding:2px 7px; font-size:9px; cursor:pointer; opacity:.45; }
.rst-btn:hover { opacity:1; border-color:#f38ba8; color:#f38ba8; }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">
const vsc      = acquireVsCodeApi();
let   SNAP     = ${JSON.stringify(snap)};
let   URIS     = ${JSON.stringify(this._uris(snap))};
const OFFSETS  = ['0s', '-2.3s', '-4.6s', '-1.1s', '-3.4s'];
const STAR_XP  = ${XP_PER_STAR};
const EGG_XP   = ${XP_PER_NEW_EGG};

function u(f) { return URIS[f] || ''; }

function eggProgress(s) {
  const left = s.nextEggXP - s.eggXP;
  return { pct: (s.eggXP % EGG_XP) / EGG_XP * 100, label: left > 0 ? left + ' XP' : 'Ready!' };
}

// One delegated listener survives every re-render: buttons carry data-cmd, rows select
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-cmd]');
  if (btn) { vsc.postMessage({ command: btn.dataset.cmd, id: btn.dataset.id && +btn.dataset.id, target: btn.dataset.t }); return; }
  const row = e.target.closest('.roster-row:not(.egg-row)');
  if (row) { vsc.postMessage({ command: 'select', id: +row.dataset.id }); }
});

// ── Called on full renders AND on postMessage updates ──────────────────────
function render(s) {
  const app = document.getElementById('app');

  if (!s.initialized) {
    app.innerHTML =
      '<div class="egg-screen">' +
        '<span class="egg-icon">🥚</span>' +
        '<h2>A mystery egg...</h2>' +
        '<p>Something is waiting inside.<br>Click to hatch your partner!</p>' +
        '<button class="hatch-btn" id="hatchBtn" data-cmd="hatch">Hatch Egg</button>' +
      '</div>';
    return;
  }

  // Arena — only rendered on full rebuilds (this function), not on XP updates
  const visible = s.collection.filter(d => !d.unhatched && d.visible);
  const walkers = visible.map((d, i) =>
    '<img class="walker" src="' + u(d.sprite) + '" style="animation-delay:' + OFFSETS[i % OFFSETS.length] + ';height:' + d.size + 'px;width:auto" title="' + d.name + '"/>'
  ).join('');

  // Selected panel
  const sel = s.collection.find(d => !d.unhatched && d.selected) || null;
  const selPanel = buildSelPanel(sel);

  const egg = eggProgress(s);
  app.innerHTML =
    '<div class="arena" id="arena">' + walkers + '</div>' +
    '<div id="selPanel">' + selPanel + '</div>' +
    '<div class="egg-progress">' +
      '<div class="row"><span class="lbl">🥚 Next egg</span><span class="val" id="eggLeft">' + egg.label + '</span></div>' +
      '<div class="bar-bg"><div id="eggBar" class="bar-fill" style="width:' + egg.pct + '%;background:linear-gradient(90deg,#f9e2af,#fab387)"></div></div>' +
    '</div>' +
    '<div style="flex:1;display:flex;flex-direction:column;min-height:0;">' +
    '<div class="roster-label">Your Digimon</div>' +
    '<div class="roster" id="roster">' + buildRoster(s.collection) + '</div>' +
    '</div>' +
    '<div class="footer"><span class="total" id="totalXp">Total XP: ' + s.totalXP + '</span><button class="rst-btn" id="rst" data-cmd="reset">Reset All</button></div>';
}

// ── Only updates XP numbers + roster state, never touches the arena ────────
function updateData(s) {
  if (!s.initialized || !document.getElementById('roster')) { return; }
  const sel = s.collection.find(d => !d.unhatched && d.selected) || null;
  const egg = eggProgress(s);
  document.getElementById('selPanel').innerHTML = buildSelPanel(sel);
  document.getElementById('eggBar').style.width = egg.pct + '%';
  document.getElementById('eggLeft').textContent = egg.label;
  document.getElementById('roster').innerHTML = buildRoster(s.collection);
  document.getElementById('totalXp').textContent = 'Total XP: ' + s.totalXP;
}

function buildSelPanel(sel) {
  if (!sel) { return ''; }
  const away = sel.xpToEvolve ? (sel.xpToEvolve - sel.xp) + ' XP needed' : '–';
  let evoHtml = '';
  if (sel.canEvolve && sel.nextOptions.length > 0) {
    const btns = sel.nextOptions.map(o =>
      '<button class="evo-btn" data-cmd="evolve" data-id="' + sel.id + '" data-t="' + o.name + '">' +
        '<img src="' + u(o.sprite) + '"/>' + o.name +
        '<span class="evo-stage">(' + o.stage + ')</span>' +
      '</button>'
    ).join('');
    evoHtml = '<div class="evo-box"><div class="evo-title">⚡ ' + sel.name + ' is ready to Digivolve!</div><div class="evo-opts">' + btns + '</div></div>';
  } else if (!sel.xpToEvolve) {
    evoHtml = '<div class="mega">🏆 ' + sel.name + ' reached maximum evolution!' +
      (sel.stars ? ' ' + '★'.repeat(Math.min(sel.stars, 5)) + (sel.stars > 5 ? ' ×' + sel.stars : '') : '') + '</div>';
  }
  const xpRows = sel.xpToEvolve
    ? '<div class="row"><span class="lbl">' + sel.name + ' XP</span><span class="val">' + sel.xp + ' / ' + sel.xpToEvolve + '</span></div>' +
      '<div class="row"><span class="lbl">Next evolution</span><span class="val">' + away + '</span></div>' +
      '<div class="bar-bg"><div class="bar-fill" style="width:' + sel.xpPct + '%"></div></div>'
    : '<div class="row"><span class="lbl">Prestige ★' + sel.stars + '</span><span class="val">' + sel.starXP + ' / ' + STAR_XP + '</span></div>' +
      '<div class="bar-bg"><div class="bar-fill" style="width:' + (sel.starXP / STAR_XP * 100) + '%;background:linear-gradient(90deg,#f9e2af,#fab387)"></div></div>';
  const card =
    '<div class="card">' +
      '<div class="row"><span class="lbl">Lifetime XP</span><span class="val">' + sel.lifeXP + '</span></div>' +
      '<div class="card-line">' + sel.history.join(' → ') + '</div>' +
      (sel.skipped.length ? '<div class="card-skip">Paths not taken: ' + sel.skipped.join(', ') + '</div>' : '') +
    '</div>';
  return '<div class="xp-section">' + xpRows + '</div>' + evoHtml + card;
}

function buildRoster(collection) {
  return collection.map(d => {
    if (d.unhatched) {
      return '<div class="roster-row egg-row" data-id="' + d.id + '">' +
        '<span style="font-size:24px;flex-shrink:0">🥚</span>' +
        '<div class="roster-info"><div class="roster-name">Mystery Egg</div><div class="roster-stage">Waiting to hatch...</div></div>' +
        '<div class="roster-actions"><button class="icon-btn" data-cmd="hatchEgg" data-id="' + d.id + '" style="width:auto;padding:0 6px;opacity:1;background:#f9e2af;color:#11111b;border-color:#f9e2af;font-weight:700">Hatch</button></div>' +
      '</div>';
    }
    return '<div class="roster-row' +
      (d.selected    ? ' selected'    : '') +
      (!d.visible    ? ' hidden-digi' : '') +
      (d.canEvolve   ? ' can-evolve'  : '') +
      '" data-id="' + d.id + '">' +
      '<img class="roster-sprite" src="' + u(d.sprite) + '"/>' +
      '<div class="roster-info">' +
        '<div class="roster-name">' + (d.canEvolve ? '⚡ ' : '') + d.name + (d.stars ? ' <span class="stars">★' + d.stars + '</span>' : '') + '</div>' +
        '<div class="roster-stage">' + d.stage + ' · ' + d.history.join(' → ') + '</div>' +
      '</div>' +
      '<div class="roster-actions">' +
        '<button class="icon-btn" data-cmd="toggleVisible" data-id="' + d.id + '">' + (d.visible ? '👁' : '🚫') + '</button>' +
        (d.fusions.length ? '<button class="icon-btn" data-cmd="fuse" data-id="' + d.id + '" title="DNA Digivolve">🧬</button>' : '') +
        '<button class="icon-btn" data-cmd="resetDigi" data-id="' + d.id + '" title="Reset this Digimon">↺</button>' +
        '<button class="icon-btn danger" data-cmd="release" data-id="' + d.id + '">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Listen for updates from extension ─────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.command === 'update') {
    SNAP = msg.snap;
    URIS = msg.uris;
    updateData(SNAP); // patch numbers only — arena untouched
  }
});

render(SNAP);
</script>
</body>
</html>`;
    this._updateBadge();
  }

  _updateBadge() {
    if (!this._view) { return; }
    const collection = this.state.collection;
    const readyToEvolve = collection.filter(d => !d.unhatched && canEvolve(d.currentName, d.xp)).length;
    const unhatched = collection.filter(d => d.unhatched).length;
    const total = readyToEvolve + unhatched;
    this._view.badge = total > 0 ? { value: total, tooltip: total + ' action(s) needed' } : undefined;
  }

  _uris(snap) {
    const uris = {};
    (snap.spritesNeeded || []).forEach(f => {
      uris[f] = this._view.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'sprites', f)).toString();
    });
    return uris;
  }
}

// ─── Activate ─────────────────────────────────────────────────────────────────

function activate(ctx) {
  const state    = new DigimonState(ctx);
  const provider = new DigimonSidebarProvider(ctx, state);

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codeTamer.mainView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const gain = (n) => provider.refresh(state.addXP(n));

  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.uri.scheme !== 'file') { return; }
      const hasErrors = vscode.languages.getDiagnostics(doc.uri)
        .some(d => d.severity === vscode.DiagnosticSeverity.Error);
      gain(XP_SAVE + (hasErrors ? 0 : XP_CLEAN_SAVE));
    })
  );

  // only real edits to files — Output panels and extension logs change constantly
  let lastEdit = 0;
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.scheme !== 'file' || e.contentChanges.length === 0) { return; }
      const now = Date.now();
      if (now - lastEdit > 5000) {
        lastEdit = now;
        gain(XP_EDIT);
      }
    })
  );

  if (vscode.window.onDidEndTerminalShellExecution) {
    ctx.subscriptions.push(
      vscode.window.onDidEndTerminalShellExecution(e => {
        const cmd = (e.execution && e.execution.commandLine && e.execution.commandLine.value) || '';
        gain(XP_TERMINAL + (e.exitCode === 0 && isTestCommand(cmd) ? XP_TEST_PASS : 0));
      })
    );
  }

  // commits from terminal or the Source Control panel, via the built-in git extension
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (gitExt) {
    Promise.resolve(gitExt.isActive ? gitExt.exports : gitExt.activate()).then(exp => {
      const api = exp && exp.getAPI(1);
      if (!api) { return; }
      const watch = repo => { if (repo.onDidCommit) { ctx.subscriptions.push(repo.onDidCommit(() => gain(XP_COMMIT))); } };
      api.repositories.forEach(watch);
      ctx.subscriptions.push(api.onDidOpenRepository(watch));
    }, () => {});
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeTamer.debug.addDigimon', async () => {
      state._load();
      if (!state.ready) { vscode.window.showWarningMessage('Hatch your first egg first.'); return; }
      const pick = await vscode.window.showQuickPick(
        Object.keys(DIGIMON).map(n => ({ label: n, description: DIGIMON[n].stage })),
        { placeHolder: 'Pick a Digimon to add to your collection' }
      );
      if (pick) {
        state.add(pick.label);
        provider._buildHtml();
        vscode.window.showInformationMessage('🐉 Added ' + pick.label + ' to your collection!');
      }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeTamer.debug.addXP', async () => {
      const input = await vscode.window.showInputBox({ prompt: 'How much XP to add?', value: '100' });
      const amount = parseInt(input);
      if (!isNaN(amount) && amount > 0) {
        state.addXP(amount); // same path as real XP: eggs, lifetime XP
        provider._buildHtml();
        vscode.window.showInformationMessage('✨ Added ' + amount + ' XP to all Digimon!');
      }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeTamer.resetPartner', async () => {
      if (await confirm('Reset all Digimon?')) { state.reset(); provider._buildHtml(); }
    })
  );
}

function deactivate() {}
module.exports = { activate, deactivate };
