# Local Foundry playtesting

This repository has a self-contained playtest runtime under `.playtest/`. The
licensed Foundry application, Foundry user data, downloaded systems, worlds,
logs, and activation data all stay there and are gitignored. The launcher does
not discover or reuse Foundry installations elsewhere on the machine.

The pinned smoke-test matrix is:

- Foundry VTT 14.367, Node.js build
- dnd5e 5.3.3
- Side Initiative from the current working tree

## One-time setup

1. From the Foundry website, download the licensed **Node.js** build for
   version **14.367**.
2. Save it as `.playtest/downloads/foundryvtt.zip`. You can instead pass an
   explicit archive path to the prepare command; the archive is only read and
   is never copied into tracked files.
3. Prepare the runtime:

   ```bash
   npm run playtest:prepare
   ```

   This validates and extracts the Foundry archive, downloads the pinned public
   dnd5e release, and links this repository into the playtest data directory.
4. Start the server:

   ```bash
   npm run playtest:start
   ```

5. Open port 30000 in the T3 collaborative browser. On first launch, accept the
   EULA and activate Foundry, then create a world with these exact values:

   - Title: `Side Initiative Playtest`
   - Data Path: `side-initiative-playtest`
   - Game System: `Dungeons & Dragons Fifth Edition`

6. Enable **Side Initiative** in Manage Modules and reload the world.

Seed the repeatable five-combatant fixture from the T3 browser after entering
the world:

```js
await import("/modules/side-initiative/tools/playtest-fixture.mjs").then((fixture) =>
    fixture.seedSideInitiativePlaytestFixture(),
);
```

The fixture helper refuses to run outside `side-initiative-playtest`. It
creates or repairs the `Player2` user, actors, tokens, and encounter without
deleting unrelated documents. Its status-only entry point is
`getSideInitiativePlaytestStatus()`.

The activation and world survive restarts inside `.playtest/data`. Once the
world exists, `npm run playtest:start` launches it directly. Set
`SIDE_INITIATIVE_PLAYTEST_PORT` to use a port other than 30000.

Check the local runtime without starting it:

```bash
npm run playtest:status
```

## Browser smoke test

Use the T3 collaborative browser so the agent and developer see the same live
Foundry UI. Before testing, open the browser console diagnostics and treat any
Side Initiative exception as a failure.

1. Seed the fixture and confirm it reports two player-owned characters, one
   neutral NPC, two hostile NPCs, and one five-combatant encounter.
2. Confirm the tracker groups combatants into the expected disposition sides.
3. Roll side initiative and verify one visible roll per side, a highlighted
   active side, and matching initiatives for members of each side.
4. Advance forward and backward across every side. Confirm the encounter round
   only changes when wrapping the side order.
5. Change each side commander and verify the crown, active combatant, and
   permissions follow the selected combatant.
6. Exercise standard d20 and weighted-average initiative settings.
7. Enable the combat dock, test every size at desktop and laptop widths, and
   verify start, stop, roll, reset, and advance controls.
8. Join from a second browser tab as a player. Verify an owner on the active
   side can advance, a non-owner cannot, and both clients remain synchronized.

Keep disposable fixtures in the `Side Initiative Playtest` world only. Never
point this harness at a campaign or another Foundry user-data directory.
