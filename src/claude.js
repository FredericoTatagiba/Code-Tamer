// @ts-nocheck
'use strict';

// Claude Code writes one JSONL transcript per session to
// ~/.claude/projects/<workspace path with non-alphanumerics as '-'>/<session>.jsonl.
// We only read event types and tool names; no content is kept.
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { XP_CLAUDE_PROMPT, XP_CLAUDE_EDIT } = require('./xp');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function lineXP(o) {
  if (!o || o.isSidechain || o.isMeta) { return 0; } // sidechain = subagent
  const a = o.attachment;
  if (o.type === 'attachment' && a && a.type === 'queued_command') { // prompt sent while Claude was busy
    return a.commandMode === 'prompt' && !a.isMeta && (!a.origin || a.origin.kind === 'human') ? XP_CLAUDE_PROMPT : 0;
  }
  if (!o.message) { return 0; }
  const c = o.message.content;
  if (o.type === 'user') {
    const typed = typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text') && !c.some(b => b.type === 'tool_result'));
    return typed ? XP_CLAUDE_PROMPT : 0;
  }
  if (o.type === 'assistant' && Array.isArray(c)) {
    return c.filter(b => b.type === 'tool_use' && EDIT_TOOLS.has(b.name)).length * XP_CLAUDE_EDIT;
  }
  return 0;
}

// ponytail: two windows on the same folder both count the same transcript; dedupe via globalState offsets if it matters
function watchClaude(folders, onXP, { root = path.join(os.homedir(), '.claude', 'projects'), enabled = () => true, interval = 5000 } = {}) {
  const dirs = folders.map(f => path.join(root, f.replace(/[^a-zA-Z0-9]/g, '-')));
  const offsets = new Map(); // file -> bytes already read

  const files = () => dirs.flatMap(d => {
    try { return fs.readdirSync(d).filter(f => f.endsWith('.jsonl')).map(f => path.join(d, f)); } catch { return []; }
  });

  // skip history: only what is written after activation counts
  files().forEach(f => { try { offsets.set(f, fs.statSync(f).size); } catch {} });

  function scan() {
    let xp = 0;
    for (const f of files()) {
      let size, from = offsets.get(f) || 0;
      try { size = fs.statSync(f).size; } catch { continue; }
      if (size < from) { from = 0; }       // file rewritten
      if (size === from) { continue; }
      const buf = Buffer.alloc(size - from);
      const fd = fs.openSync(f, 'r');
      try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
      const end = buf.lastIndexOf(0x0a) + 1; // keep a half-written line for the next scan
      offsets.set(f, from + end);
      buf.subarray(0, end).toString('utf8').split('\n').forEach(l => {
        if (l) { try { xp += lineXP(JSON.parse(l)); } catch {} }
      });
    }
    if (xp > 0 && enabled()) { onXP(xp); }
  }

  const timer = setInterval(scan, interval);
  if (timer.unref) { timer.unref(); } // never keep the process alive on our account
  return { scan, dispose: () => clearInterval(timer) };
}

module.exports = { lineXP, watchClaude };
