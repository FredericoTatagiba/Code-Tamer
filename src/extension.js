// @ts-nocheck
'use strict';

const vscode = require('vscode');
const { DIGIMON }                         = require('./data/digimon');
const { DigimonState }                    = require('./state');
const { DigimonSidebarProvider, confirm } = require('./sidebar');
const { watchClaude }                     = require('./claude');
const { XP_SAVE, XP_CLEAN_SAVE, XP_EDIT, XP_TERMINAL, XP_TEST_PASS, XP_COMMIT, isTestCommand } = require('./xp');

function activate(ctx) {
  const state    = new DigimonState(ctx);
  const provider = new DigimonSidebarProvider(ctx, state);

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codeTamer.mainView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const gain = (n, fromClaude) => provider.refresh(state.addXP(n, fromClaude));

  // prompts and edits made with Claude Code in this workspace
  const claude = watchClaude((vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath), n => gain(n, true),
    { enabled: () => vscode.workspace.getConfiguration('codeTamer').get('claudeCode', true) });
  ctx.subscriptions.push(claude);

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
