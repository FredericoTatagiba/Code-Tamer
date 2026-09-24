// Smoke test: runs the extension against a minimal vscode mock. `npm test`
'use strict';
const assert = require('assert');
const Module = require('module');

const store = {}, handlers = {}, commands = {};
let diagnostics = [], onCommit, provider, send;
const on = name => fn => { handlers[name] = fn; return { dispose() {} }; };
const vscode = {
  Uri: { joinPath: (...a) => ({ fsPath: a.join('/') }) },
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  window: {
    showWarningMessage: async (...a) => (a[1] && a[1].modal ? a[2] : undefined), // DND hides non-modal; picks first button
    showInformationMessage: async () => {},
    registerWebviewViewProvider: (id, p) => { assert.strictEqual(id, 'codeTamer.mainView'); provider = p; return { dispose() {} }; },
    onDidEndTerminalShellExecution: on('term'),
  },
  workspace: { onDidSaveTextDocument: on('save'), onDidChangeTextDocument: on('change') },
  languages: { getDiagnostics: () => diagnostics },
  commands: { registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; } },
  extensions: { getExtension: () => ({ isActive: true, exports: { getAPI: () => ({
    repositories: [{ onDidCommit: fn => { onCommit = fn; return { dispose() {} }; } }],
    onDidOpenRepository: () => ({ dispose() {} }),
  }) } }) },
};
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : load.call(this, req, ...rest); };

const vm = require('vm'), fs = require('fs');
const { EVOLUTIONS } = require('../src/data/evolutions');
const ext = require('../src/extension.js');
const KEY = 'digimonState_v4';
const ctx = { globalState: { get: k => store[k], update: async (k, v) => { store[k] = v; } }, subscriptions: [], extensionUri: { fsPath: '/x' } };
ext.activate(ctx);
const view = { webview: { cspSource: '', asWebviewUri: u => u, onDidReceiveMessage: h => { send = h; }, postMessage() {} } };
provider.resolveWebviewView(view);

const base = Object.keys(EVOLUTIONS).find(n => EVOLUTIONS[n].xpToEvolve && EVOLUTIONS[n].evolvesTo.length > 1);
const mega = Object.keys(EVOLUTIONS).find(n => EVOLUTIONS[n].xpToEvolve === null);
const cost = EVOLUTIONS[base].xpToEvolve, [target, other] = EVOLUTIONS[base].evolvesTo;
const fresh = () => { store[KEY] = { collection: [{ id: 1, currentName: base, xp: 0, history: [base], visible: true, unhatched: false }], totalXP: 0, eggsEarned: 0, selected: null }; };
const digi = () => store[KEY].collection[0];
const file = { uri: { scheme: 'file' } };

(async () => {
  await new Promise(r => setImmediate(r)); // git API hookup is async
  // XP events
  fresh();
  handlers.change({ document: { uri: { scheme: 'output' } }, contentChanges: [{}] });
  assert.strictEqual(digi().xp, 0, 'output panel gives no XP');
  handlers.change({ document: file, contentChanges: [{}] });
  assert.strictEqual(digi().xp, 1, 'real edit');
  handlers.save(file);                                     // +5 +3 clean
  diagnostics = [{ severity: 0 }]; handlers.save(file);    // +5
  assert.strictEqual(digi().xp, 1 + 8 + 5, 'save / clean save');
  handlers.term({ exitCode: 0, execution: { commandLine: { value: 'npm test' } } });            // +18
  handlers.term({ exitCode: 1, execution: { commandLine: { value: 'npm test' } } });            // +3
  handlers.term({ exitCode: 0, execution: { commandLine: { value: 'git commit -m "fix test"' } } }); // +3
  onCommit();                                                                                   // +10
  assert.strictEqual(digi().xp, 14 + 18 + 3 + 3 + 10, 'terminal / tests / commit');
  assert.strictEqual(digi().lifeXP, digi().xp, 'lifetime XP');

  // eggs keep coming while one is waiting, and big gains give all of them
  fresh(); store[KEY].collection.push({ id: 2, unhatched: true, history: [] });
  vscode.window.showInputBox = async () => '1200';
  await commands['codeTamer.debug.addXP']();
  assert.strictEqual(store[KEY].collection.filter(d => d.unhatched).length, 3, 'eggs with egg pending');

  // overflow on evolve, skipped branches, per-Digimon reset
  fresh(); digi().xp = cost + 37;
  await send({ command: 'evolve', id: 1, target });
  assert.deepStrictEqual([digi().currentName, digi().xp], [target, 37], 'overflow carried');
  const snap = provider.state.snapshot().collection[0];
  assert(snap.skipped.includes(other), 'skipped branch listed');
  await send({ command: 'resetDigi', id: 1 });
  assert.deepStrictEqual([digi().currentName, digi().xp, digi().history], [base, 0, [base]], 'resetDigi');

  // Mega prestige
  store[KEY].collection[0] = { id: 1, currentName: mega, xp: 2500, history: [mega], visible: true, unhatched: false };
  const m = provider.state.snapshot().collection[0];
  assert.deepStrictEqual([m.stars, m.starXP], [2, 500], 'prestige stars');

  // DNA Digivolution: both consumed, XP summed, chains into another fusion
  const mk = (id, name, xp) => ({ id, currentName: name, xp, lifeXP: xp, history: ['Koromon', name], visible: true, unhatched: false });
  store[KEY].collection = [mk(1, 'Wargreymon', 1200), mk(2, 'Imperialdramon', 300), mk(3, 'Metalgarurumon', 900)];
  const fz = () => provider.state.snapshot().collection.map(d => [d.name, d.fusions.map(f => f.result)]);
  assert.deepStrictEqual(fz(), [['Wargreymon', ['Omnimon']], ['Imperialdramon', []], ['Metalgarurumon', ['Omnimon']]], 'fusions offered');
  await send({ command: 'fuse', id: 3 });
  const o = store[KEY].collection;
  assert.deepStrictEqual(o.map(d => d.currentName), ['Imperialdramon', 'Omnimon'], 'both consumed');
  assert.deepStrictEqual([o[1].xp, o[1].lifeXP, o[1].history], [2100, 2100, ['Koromon', 'Metalgarurumon', 'Omnimon']], 'XP summed');
  assert.strictEqual(provider.state.snapshot().collection[1].stars, 2, 'stars carry over');
  await send({ command: 'fuse', id: 2 });
  assert.deepStrictEqual(store[KEY].collection.map(d => [d.currentName, d.xp]), [['Imperialdramon Paladin', 2400]], 'chained fusion');
  assert.strictEqual(provider.state.fuse(store[KEY].collection[0].id, 999, 'Omnimon'), false, 'no partner, no fusion');

  // every fusion ingredient/result exists and has a sprite
  const { DIGIMON } = require('../src/data/digimon');
  const { JOGRESS } = require('../src/data/evolutions');
  Object.entries(JOGRESS).flatMap(([r, p]) => [r, ...p]).forEach(n =>
    assert(DIGIMON[n] && require('fs').existsSync(__dirname + '/../sprites/' + DIGIMON[n].sprite), 'fusion data: ' + n));

  // reset all: button and command
  await send({ command: 'reset' });
  assert.strictEqual(store[KEY], null, 'reset button');
  fresh(); await commands['codeTamer.resetPartner']();
  assert.strictEqual(store[KEY], null, 'reset command');
  assert(view.webview.html.includes('"initialized":false'), 'egg screen after reset');

  // webview script: render, patch, and delegated clicks
  store[KEY] = { collection: [mk(1, 'Wargreymon', 0), mk(2, 'Metalgarurumon', 0)], totalXP: 0, eggsEarned: 0, selected: null };
  provider._buildHtml();
  const els = {}, posted = [];
  const el = id => els[id] || (els[id] = { innerHTML: '', textContent: '', style: {} });
  el('init').textContent = view.webview.html.match(/<script type="application\/json" id="init">(.*?)<\/script>/)[1];
  let onClick;
  const win = { document: { getElementById: el, addEventListener: (t, f) => { onClick = f; } },
    window: { addEventListener() {} }, acquireVsCodeApi: () => ({ postMessage: m => posted.push(m) }) };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../src/webview/main.js', 'utf8'), win);
  assert.strictEqual((els.app.innerHTML.match(/data-cmd="fuse"/g) || []).length, 2, 'fuse buttons rendered');
  vm.runInNewContext('updateData(SNAP)', win);
  assert(els.roster.innerHTML.includes('data-cmd="fuse"') && els.eggLeft.textContent, 'updateData patches roster and egg bar');
  const click = (btn, row) => onClick({ target: { closest: q => q === '[data-cmd]' ? btn : row } });
  click({ dataset: { cmd: 'fuse', id: '1' } }); click(null, { dataset: { id: '2' } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(posted)), [{ command: 'fuse', id: 1 }, { command: 'select', id: 2 }], 'delegated clicks');

  console.log('smoke OK');
})().catch(e => { console.error(e); process.exit(1); });
