// @ts-nocheck
'use strict';

const vscode = require('vscode');
const { canEvolve, fusionsFor }         = require('./state');
const { XP_PER_NEW_EGG, XP_PER_STAR }   = require('./xp');

// modal: Do Not Disturb hides non-modal warnings and their promise never resolves
async function confirm(message) {
  return (await vscode.window.showWarningMessage(message, { modal: true }, 'Yes')) === 'Yes';
}

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
        vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'webview'),
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

    const init  = JSON.stringify({ snap, uris: this._uris(snap), STAR_XP: XP_PER_STAR, EGG_XP: XP_PER_NEW_EGG }).replace(/</g, '\\u003c');
    const asset = f => this._view.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'webview', f));

    this._view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${csp} data:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('style.css')}">
</head>
<body>
<div id="app"></div>
<script type="application/json" id="init">${init}</script>
<script nonce="${nonce}" src="${asset('main.js')}"></script>
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

module.exports = { DigimonSidebarProvider, confirm };
