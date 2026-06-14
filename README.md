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

## Gambits Premades notes

- Side Initiative patches Gambits Premades Opportunity Attack at runtime for the supported Gambits versions `2.1.43`.
- The patch is guarded: if the installed Gambits version or source shape does not match the supported build, integration is disabled internally and the GM is warned.
- Side-turn hooks are bridged to Gambits region turn events for every combatant on the active side, not just the commander.
- The active side's tokens keep their OA region enabled while their side is active so the side can still make opportunity attacks during that phase.
- If you use side initiative, keep Gambits Premades Opportunity Attack disabled only when the compatibility warning reports an unsupported Gambits build.

## Development

Setup your environment by creating a `foundry-config.yaml` with:
```yml
installPath: "/path/to/your/foundry/installation"
```
And then running:
```bash
npm run createSymlinks
```

Run the logic tests with:

```bash
npm test
```
