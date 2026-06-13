import test from "node:test";
import assert from "node:assert/strict";
import { SideInitiativeAPI } from "../scripts/api.mjs";
import {
    defaultSideIdForCombatant,
    ensureCombatantSideAssignments,
    getActiveSideId,
    getNextSideId,
    groupBy,
    normalizeSideId,
    rollSideInitiativeData
} from "../scripts/logic.mjs";

function createCombatant({ id, hasPlayerOwner = false, disposition = 0, sideId = null, sideSource = null }) {
    const flags = new Map();
    if (sideId) flags.set("side-initiative:sideId", sideId);
    if (sideSource) flags.set("side-initiative:sideSource", sideSource);

    return {
        id,
        name: id,
        hasPlayerOwner,
        disposition,
        getFlag(scope, key) {
            return flags.get(`${scope}:${key}`) ?? null;
        },
        setFlag(scope, key, value) {
            flags.set(`${scope}:${key}`, value);
            return Promise.resolve(value);
        },
        flags
    };
}

function createCombat(combatants, state = null) {
    let combatState = state;
    return {
        round: 1,
        turn: 0,
        started: true,
        combatants,
        lastUpdate: null,
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") return combatState;
            return null;
        },
        setFlag(scope, key, value) {
            if (scope === "side-initiative" && key === "state") {
                combatState = value;
            }
            return Promise.resolve(value);
        },
        updateEmbeddedDocuments(_type, docs) {
            this.lastEmbedded = docs;
            return Promise.resolve();
        },
        update(data) {
            this.lastUpdate = data;
            if (typeof data.round === "number") this.round = data.round;
            if (typeof data.turn === "number") this.turn = data.turn;
            return Promise.resolve();
        }
    };
}

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

test("ensureCombatantSideAssignments writes auto groups and preserves manual overrides", async () => {
    const combatants = [
        createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 }),
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 }),
        createCombatant({ id: "npc-2", hasPlayerOwner: false, disposition: 0, sideId: "neutral", sideSource: "manual" })
    ];
    const combat = createCombat(combatants);

    await ensureCombatantSideAssignments(combat);

    assert.equal(combatants[0].getFlag("side-initiative", "sideId"), "players");
    assert.equal(combatants[0].getFlag("side-initiative", "sideSource"), "auto");
    assert.equal(combatants[1].getFlag("side-initiative", "sideId"), "monsters");
    assert.equal(combatants[1].getFlag("side-initiative", "sideSource"), "auto");
    assert.equal(combatants[2].getFlag("side-initiative", "sideId"), "neutral");
    assert.equal(combatants[2].getFlag("side-initiative", "sideSource"), "manual");
});

test("rollSideInitiativeData rerolls tied sides until unique", () => {
    const rng = (() => {
        const values = [0.1, 0.5, 0.1, 0.6, 0.4, 0.7, 0.8, 0.2];
        let index = 0;
        return () => values[index++ % values.length];
    })();

    const result = rollSideInitiativeData([{ id: "players" }, { id: "monsters" }, { id: "allies" }], rng);

    assert.equal(result.order.length, 3);
    assert.equal(new Set(result.order).size, 3);
    const rollById = Object.fromEntries(result.rolls.map((entry) => [entry.id, entry.roll]));
    assert.ok(rollById[result.order[0]] >= rollById[result.order[1]]);
    assert.ok(rollById[result.order[1]] >= rollById[result.order[2]]);
    assert.equal(result.fallbackUsed, false);
    assert.equal(new Set(result.rolls.map((entry) => entry.roll)).size, 3);
});

test("SideInitiativeAPI rolls and advances by side", async () => {
    const combatants = [
        createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 }),
        createCombatant({ id: "pc-2", hasPlayerOwner: true, disposition: 1 }),
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 }),
        createCombatant({ id: "npc-2", hasPlayerOwner: false, disposition: -1 })
    ];
    const combat = createCombat(combatants);

    const state = await SideInitiativeAPI.rollSideInitiative(combat, {
        random: (() => {
            const values = [0.9, 0.8, 0.2, 0.3, 0.1, 0.4];
            let index = 0;
            return () => values[index++ % values.length];
        })()
    });

    assert.equal(state.order.length, 2);
    assert.equal(getActiveSideId(combat), state.order[0]);
    assert.equal(combat.round, 1);
    assert.equal(typeof combat.lastUpdate.turn, "number");

    await SideInitiativeAPI.advanceSide(combat, 1);
    assert.equal(getActiveSideId(combat), state.order[1]);

    await SideInitiativeAPI.advanceSide(combat, 1);
    assert.equal(getActiveSideId(combat), state.order[0]);
    assert.equal(combat.round, 2);
});

test("getNextSideId skips empty sides", () => {
    const combatants = [
        createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 }),
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 })
    ];
    const combat = createCombat(combatants, {
        activeSideId: "players",
        order: ["players", "allies", "neutral", "monsters"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] },
            monsters: { id: "monsters", combatantIds: ["npc-1"] }
        }
    });

    assert.equal(getNextSideId(combat, 1), "monsters");
});

test("groupBy groups values by key", () => {
    const grouped = groupBy([1, 2, 3, 4], (value) => value % 2);
    assert.deepEqual(grouped.get(0), [2, 4]);
    assert.deepEqual(grouped.get(1), [1, 3]);
});
