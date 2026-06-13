import test from "node:test";
import assert from "node:assert/strict";
import { SideInitiativeAPI } from "../scripts/api.js";
import {
  defaultSideIdForCombatant,
  groupBy,
  normalizeSideId,
  rollSideInitiativeData
} from "../scripts/logic.js";

test("normalizeSideId slugifies values", () => {
  assert.equal(normalizeSideId("  Monster Squad! "), "monster-squad");
  assert.equal(normalizeSideId(""), "side");
});

test("defaultSideIdForCombatant groups by owner and disposition", () => {
  assert.equal(defaultSideIdForCombatant({ hasPlayerOwner: true, disposition: -1 }), "players");
  assert.equal(defaultSideIdForCombatant({ hasPlayerOwner: false, disposition: 1 }), "allies");
  assert.equal(defaultSideIdForCombatant({ hasPlayerOwner: false, disposition: 0 }), "neutral");
  assert.equal(defaultSideIdForCombatant({ hasPlayerOwner: false, disposition: -1 }), "monsters");
});

test("rollSideInitiativeData rerolls tied sides until unique", () => {
  const rng = (() => {
    const values = [
      0.1, 0.5,
      0.1, 0.6,
      0.4, 0.7,
      0.8, 0.2
    ];
    let index = 0;
    return () => values[index++ % values.length];
  })();

  const result = rollSideInitiativeData(
    [{ id: "players" }, { id: "monsters" }, { id: "allies" }],
    rng
  );

  assert.equal(result.order.length, 3);
  assert.equal(new Set(result.order).size, 3);
  const rollById = Object.fromEntries(result.rolls.map((entry) => [entry.id, entry.roll]));
  assert.ok(rollById[result.order[0]] >= rollById[result.order[1]]);
  assert.ok(rollById[result.order[1]] >= rollById[result.order[2]]);
  assert.equal(result.fallbackUsed, false);
  assert.equal(new Set(result.rolls.map((entry) => entry.roll)).size, 3);
});

test("SideInitiativeAPI rolls and writes combat initiatives", async () => {
  const combatants = [
    {
      id: "pc-1",
      name: "PC 1",
      hasPlayerOwner: true,
      disposition: 1,
      getFlag() {
        return null;
      },
      setFlag() {
        return Promise.resolve();
      }
    },
    {
      id: "npc-1",
      name: "NPC 1",
      hasPlayerOwner: false,
      disposition: -1,
      getFlag() {
        return null;
      },
      setFlag() {
        return Promise.resolve();
      }
    },
    {
      id: "npc-2",
      name: "NPC 2",
      hasPlayerOwner: false,
      disposition: -1,
      getFlag() {
        return null;
      },
      setFlag() {
        return Promise.resolve();
      }
    }
  ];

  const updates = [];
  const combat = {
    round: 1,
    turn: 0,
    started: true,
    combatants,
    getFlag() {
      return null;
    },
    setFlag() {
      return Promise.resolve();
    },
    updateEmbeddedDocuments(_type, docs) {
      updates.push(...docs);
      return Promise.resolve();
    },
    update(data) {
      this.lastUpdate = data;
      return Promise.resolve();
    }
  };

  const state = await SideInitiativeAPI.rollSideInitiative(combat, {
    random: (() => {
      const values = [0.9, 0.8, 0.2, 0.3, 0.1, 0.4];
      let index = 0;
      return () => values[index++ % values.length];
    })()
  });

  assert.equal(state.order.length, 2);
  assert.equal(updates.length, 3);
  assert.equal(combat.lastUpdate.turn, 0);
  assert.equal(combat.lastUpdate.round, 1);
});

test("groupBy groups values by key", () => {
  const grouped = groupBy([1, 2, 3, 4], (value) => value % 2);
  assert.deepEqual(grouped.get(0), [2, 4]);
  assert.deepEqual(grouped.get(1), [1, 3]);
});
