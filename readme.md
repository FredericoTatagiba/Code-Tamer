# Code Tamer 🥚

Raise a digital partner that evolves as you code. Real work earns XP — editing files, clean saves, passing tests, committing — and your partner digivolves from a Fresh egg all the way to Mega, right in your VSCode sidebar.

## How it works

Open the **Code Tamer** panel from the activity bar, hatch your first egg and start coding.

| Action | XP |
|--------|----|
| Edit a file (at most every 5s) | +1 |
| Save a file | +5 |
| Save a file with no errors | +3 bonus |
| Run a terminal command | +3 |
| Tests pass (`npm test`, `pytest`, `phpunit`, `artisan test`, `go test`…) | +15 bonus |
| Commit (terminal or Source Control panel) | +10 |
| Send a prompt to [Claude Code](https://claude.com/claude-code) in this workspace | +2 |
| Claude Code edits or writes a file | +1 |

Only real files count: Output panels and extension logs don't give XP.
Terminal XP needs VSCode shell integration (on by default).

### Claude Code ✨

Code Tamer reads the Claude Code session logs for your workspace (`~/.claude/projects/…`), both from the CLI and the VSCode extension. It only looks at event types and tool names, never at your prompts or code, and only counts what happens after VSCode starts. Turn it off with the `codeTamer.claudeCode` setting.

Every **300 XP** earned with Claude grants a **Divine Egg** ✨, which hatches straight into one of the Four Holy Beasts: Azulongmon, Baihumon, Ebonwumon or Zhuqiaomon.

## Evolution

Every Digimon follows a branching evolution tree across 6 stages:

- 🥚 **Fresh** → **In-Training** (20 XP)
- **In-Training** → **Rookie** (50 XP)
- **Rookie** → **Champion** (150 XP)
- **Champion** → **Ultimate** (400 XP)
- **Ultimate** → **Mega** (800 XP)

XP beyond the requirement carries over to the next form. Click a Digimon in the roster to open its card: current XP, lifetime XP, its evolution line and the paths it didn't take.

## Eggs and prestige

- Every **500 XP** earns a new egg, even while other eggs are still waiting to hatch.
- Megas keep training: every **1000 XP** at Mega earns a prestige star ★.

## DNA Digivolution 🧬

Two Megas can fuse into a stronger one. When both partners are in your roster, a 🧬 button appears on their rows. Both Digimon are consumed, and the new one keeps their combined XP (and stars).

| Fusion | Partners |
|---|---|
| Omnimon | WarGreymon + MetalGarurumon |
| Omnimon Zwart | BlackWarGreymon + MetalGarurumon Black |
| Imperialdramon Paladin | Imperialdramon + Omnimon |
| Chaosmon | BanchoLeomon + Darkdramon |

## Roster controls

- 👁 show/hide in the arena
- 🧬 DNA digivolve with a partner (asks for confirmation)
- ↺ reset that Digimon to its first form
- ✕ release it (asks for confirmation)
- **Reset All** in the footer, or `Code Tamer: Reset All` from the command palette

## Credits

Code Tamer started as a fork of [**Digimon Partner**](https://github.com/amarchanttv/digimon-partner) by **amarchanttv**. The idea, the evolution tree and the pixel-art roster all come from that project — thank you for building such a fun companion for coding and for inspiring this one. 💙

The fusion sprites (Omnimon, Imperialdramon Paladin Mode, Chaosmon, Darkdramon) come from the Digimon Story sprite collection on [DigimonWiki](https://digimon.fandom.com/wiki/DigimonWiki:Digimon_Story_Sprite_project). Omnimon Zwart and MetalGarurumon Black are recolors made for this project.

## Disclaimer

Fan-made, free and non-commercial. Not affiliated with, endorsed or sponsored by Bandai Namco or Toei Animation. Digimon and all related names and characters are trademarks of their respective owners.
