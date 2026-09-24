// @ts-nocheck
'use strict';

// XP rules: see the table in CLAUDE.md
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

module.exports = { XP_SAVE, XP_CLEAN_SAVE, XP_EDIT, XP_TERMINAL, XP_TEST_PASS, XP_COMMIT, XP_PER_NEW_EGG, XP_PER_STAR, isTestCommand };
