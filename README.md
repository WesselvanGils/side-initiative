# Side Initiative

Foundry VTT module for the 2014 DMG side initiative variant.

## What it does

- Rolls one unmodified `1d20` per side.
- Rerolls tied side totals until the tie breaks.
- Keeps combatant side assignments on combatant flags.
- Adds combat tracker controls for side rolling and editing.
- Uses a MidiQOL reaction hook to keep same-side actors from being charged a reaction while their side is active.

## Usage

1. Install the module into your Foundry `Data/modules/side-initiative` folder.
2. Enable the module in the world.
3. Open a combat and click the side initiative dice button in the combat tracker.
4. Use the editor to reassign combatants if the defaults need adjustment.
5. Use the crown button in the combat tracker row to assign a commander for a side.

Commander changes default to side owners and can be restricted to the GM in the module settings.

## MidiQOL notes

- This module uses `midi-qol.preSetReactionUsed` to suppress reaction consumption for actors on the active side.

## Gambits Premades notes

- Side Initiative patches Gambits Premades Opportunity Attack at runtime for the supported Gambits version `2.1.43`.
- The patch is guarded: if the installed Gambits version or source shape does not match the supported build, integration is disabled internally and the GM is warned.
- The commander token keeps its OA region enabled while its side is active so the side can still make opportunity attacks during that phase.
- Click the crown button in a combatant row to assign the commander for that side.
- Press `Enter` to advance the active side when you are the GM or the current commander.
- If you use side initiative, keep Gambits Premades Opportunity Attack disabled only when the compatibility warning reports an unsupported Gambits build.

## Development

Run the logic tests with:

```bash
npm test
```
