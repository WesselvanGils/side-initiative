# Side Initiative

Foundry VTT module for the 2014 DMG side initiative variant.

## What it does

- Rolls one unmodified `1d20` per side.
- Rerolls tied side totals until the tie breaks.
- Keeps combatant side assignments on combatant flags.
- Adds combat tracker controls for side rolling and editing.
- Warns on MidiQOL workflows started by a combatant that is not on the active side.

## Usage

1. Install the module into your Foundry `Data/modules/side-initiative` folder.
2. Enable the module in the world.
3. Open a combat and click the side initiative dice button in the combat tracker.
4. Use the editor to reassign combatants if the defaults need adjustment.

## MidiQOL notes

- The module does not block workflows.
- MidiQOL's `Record AOO` reaction setting should be set to `Do not check` when using side initiative, otherwise reaction consumption can be double-counted.
- The off-side warning is intended to be informative so MidiQOL automation can continue to work.

## Gambits Premades notes

- Gambits Premades Opportunity Attack automation currently keys off the active combat token. It is not side-aware and will not reliably follow grouped side initiative.
- If you use side initiative, disable Gambits Premades Opportunity Attack automation and let your own reaction handling drive it.

## Development

Run the logic tests with:

```bash
npm test
```
