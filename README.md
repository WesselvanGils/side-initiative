# Side Initiative

Foundry VTT module for the 2014 DMG side initiative variant.

## What it does

- Rolls one unmodified `1d20` per side.
- Can optionally roll every combatant at combat start and use a weighted side average instead.
- Rerolls tied side totals until the tie breaks.
- Keeps combatant side assignments on combatant flags.
- Adds combat tracker controls for side rolling and editing.
- Uses a MidiQOL reaction hook to keep same-side actors from being charged a reaction while their side is active.

## Usage

1. Install the module into your Foundry `Data/modules/side-initiative` folder.
2. Enable the module in the world.
3. Open a combat and click the side initiative dice button in the combat tracker.
4. If you want weighted combat starts, set `Initiative method` to `Weighted combatant average` in the module settings.
5. Use the editor to reassign combatants if the defaults need adjustment.
6. Use the crown button in the combat tracker row to assign a commander for a side.
7. Press `Enter` to advance the active side when you are the GM or the current commander.

Commander changes default to side owners and can be restricted to the GM in the module settings.

## MidiQOL notes

- This module uses `midi-qol.preSetReactionUsed` to suppress reaction consumption for actors on the active side.
- Used reactions are cleared again when a side becomes active so characters regain reaction access on their next turn.
- Start of turn and end of turn triggers need special attention because when a side starts their collective turn this doesn't proc individual actors.

## Gambits Premades notes

- Side Initiative patches Gambits Premades Opportunity Attack at runtime for the supported Gambits versions.
- The patch is guarded: if the installed Gambits version or source shape does not match the supported build, integration is disabled internally and the GM is warned.
- Side-turn hooks are bridged to Gambits region turn events for every combatant on the active side, not just the commander.
- The active side's tokens keep their OA region enabled while their side is active so the side can still make opportunity attacks during that phase.
- If you use side initiative, keep Gambits Premades Opportunity Attack disabled only when the compatibility warning reports an unsupported Gambits build.

## Legendary Action Windows

Because every creature on a side acts at once, Chris' Premades' usual end-of-turn legendary-action prompt never fires in side initiative (it relies on the per-creature turn advance that side initiative replaces). Enable **Use Legendary Action Windows** in the module settings to restore it in a side-aware way.

- Whenever a creature on the active side finishes an **Action**, the GM is prompted (through Chris' Premades' own dialog and workflow) whether any opposing legendary monster wants to spend a legendary action. Spending one this way does **not** consume the monster's reaction.
- Only Actions open a window — bonus actions and reactions intentionally do not, to avoid flooding the GM with prompts.
- **Extra Attack** is honoured: a weapon Attack action only opens a window once the actor has made all of its attacks for that action. The expected count is read from the actor's features (`Extra Attack` = 2, `Two Extra Attacks` = 3, `Three Extra Attacks` = 4).
- Requires both Chris' Premades and MidiQOL. Detection runs on MidiQOL's activity workflows; a few utility actions MidiQOL does not workflow may not open a window.

Legendary actions are also recovered at the **start** of a side's turn for every creature on that side, complete with dnd5e's recovery chat card, and dnd5e's native end-of-turn recovery is suppressed for side combats so it only happens once. (dnd5e normally recovers them — with a chat card — at the end of a single creature's turn, which in side initiative only ever reaches the side's representative, so they recovered at the wrong time, posted the card at the wrong time, and other legendary creatures never recovered at all. This is always on for side combats; it is not tied to the Legendary Action Windows setting.)

## Development

The module is written in TypeScript under `src/` and compiled to `scripts/`,
which is the bundle Foundry loads. Build it with:

```bash
npm run build         # one-shot compile src/ -> scripts/
npm run build:watch   # recompile on save
npm run typecheck     # type-check without emitting
```

To develop against a local Foundry install, point `foundry-config.yaml` at your
Foundry user data directory (the folder that contains `Data/`):

```yml
dataPath: "/path/to/FoundryVTT"
```

```bash
npm run build
npm run createSymlinks   # symlinks the repo into <dataPath>/Data/modules/side-initiative
```

Re-run `npm run build` (or keep `build:watch` running) after changing source so
Foundry picks up the new `scripts/` output.

The logic and integration tests run against `src/` via `tsx`:

```bash
npm test
```
