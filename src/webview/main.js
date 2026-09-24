// Sidebar webview (browser side). Initial data comes from the #init JSON the host renders.
'use strict';
const vsc      = acquireVsCodeApi();
const INIT     = JSON.parse(document.getElementById('init').textContent);
const { STAR_XP, EGG_XP } = INIT;
const OFFSETS  = ['0s', '-2.3s', '-4.6s', '-1.1s', '-3.4s'];
let   SNAP     = INIT.snap;
let   URIS     = INIT.uris;

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
