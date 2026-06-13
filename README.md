# Side Initiative

Foundry VTT module for the 2014 DMG side initiative variant.

## What it does

- Rolls one unmodified `1d20` per side.
- Rerolls tied side totals until the tie breaks.
- Keeps combatant side assignments on combatant flags.
- Adds combat tracker controls for side rolling, editing, and acted-state tracking.
- Warns on MidiQOL workflows started by a combatant that is not on the active side.

## Usage

1. Install the module into your Foundry `Data/modules/side-initiative` folder.
2. Enable the module in the world.
3. Open a combat and click the side initiative dice button in the combat tracker.
4. Use the editor to reassign combatants if the defaults need adjustment.

## MidiQOL notes

- The module does not block workflows.
- Reactions are not warned on by default.
- The warning is intended to be informative so MidiQOL automation can continue to work.

## Development

Run the logic tests with:

```bash
npm test
```
