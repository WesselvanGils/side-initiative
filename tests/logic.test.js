import test from "node:test";
import assert from "node:assert/strict";
import { SideInitiativeAPI } from "../scripts/api.mjs";
import {
    defaultSideIdForCombatant,
    ensureCombatantSideAssignments,
    getActiveSideId,
    getCombatantFromActor,
    getCombatantInitiativeWeight,
    getSideCommanderCombatant,
    getSideCommanderId,
    getNextSideId,
    getSideRepresentativeCombatant,
    groupBy,
    isCombatantOnActiveSide,
    isActorOnActiveSide,
    isSideCombat,
    isTokenOnActiveSide,
    normalizeSideId,
    normalizeCombatState,
    rollSideInitiativeData,
    rollWeightedSideInitiativeData
} from "../scripts/logic.mjs";

function createCombatant({
    id,
    hasPlayerOwner = false,
    disposition = 0,
    sideId = null,
    sideSource = null,
    ownerIds = [],
    actorXp = null,
    initiativeTotal = 10
}) {
    const flags = new Map();
    if (sideId) flags.set("side-initiative:sideId", sideId);
    if (sideSource) flags.set("side-initiative:sideSource", sideSource);
    const xp = actorXp === null ? null : (typeof actorXp === "object" ? actorXp : { value: actorXp });
    const actor = {
        hasPlayerOwner,
        system: xp ? { details: { xp } } : { details: {} },
        getRollData() {
            return {};
        }
    };

    return {
        id,
        name: id,
        hasPlayerOwner,
        disposition,
        actor,
        token: { actor },
        isOwner: ownerIds.includes("user-1"),
        testUserPermission(user, permission) {
            return (permission === "OWNER") && (user?.isGM || ownerIds.includes(user?.id));
        },
        getInitiativeRoll() {
            return {
                total: initiativeTotal,
                evaluate: async function evaluate() {
                    return this;
                }
            };
        },
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

function createCombat(combatants, state = null, turns = null) {
    let combatState = state;
    return {
        round: 1,
        turn: 0,
        started: true,
        combatants,
        turns: turns ?? combatants,
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
             for (const doc of docs) {
                const combatant = this.combatants instanceof Map ? this.combatants.get(doc._id) : this.combatants.find((entry) => entry.id === doc._id);
                if (combatant) combatant.initiative = doc.initiative;
            }
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

function installCommanderGlobals({
    user = { id: "user-1", isGM: false },
    commanderControl = "side-owners"
} = {}) {
    const original = globalThis.game;
    globalThis.game = {
        user,
        settings: {
            get(namespace, key) {
                if (namespace === "side-initiative" && key === "commanderControl") {
                    return commanderControl;
                }
                return null;
            }
        }
    };
    return {
        restore() {
            globalThis.game = original;
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

test("getCombatantInitiativeWeight uses xp for NPCs and defaults to one", () => {
    const player = createCombatant({ id: "pc-1", hasPlayerOwner: true, actorXp: 500 });
    const lich = createCombatant({ id: "npc-1", hasPlayerOwner: false, actorXp: 3900 });
    const goblin = createCombatant({ id: "npc-2", hasPlayerOwner: false, actorXp: { value: 50 } });
    const unknown = createCombatant({ id: "npc-3", hasPlayerOwner: false, actorXp: 0 });

    assert.equal(getCombatantInitiativeWeight(player), 1);
    assert.equal(getCombatantInitiativeWeight(lich), 3900);
    assert.equal(getCombatantInitiativeWeight(goblin), 50);
    assert.equal(getCombatantInitiativeWeight(unknown), 1);
});

test("isActorOnActiveSide resolves an actor combatant and checks the active side", () => {
    const combatants = [
        createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 }),
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 })
    ];
    const combat = createCombat(combatants, {
        activeSideId: "players",
        order: ["players", "monsters"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] },
            monsters: { id: "monsters", combatantIds: ["npc-1"] }
        }
    });

    const playerActor = { combatant: combatants[0] };
    const monsterActor = { combatant: combatants[1] };

    assert.equal(getCombatantFromActor(playerActor), combatants[0]);
    assert.equal(isActorOnActiveSide(playerActor, combat), true);
    assert.equal(isActorOnActiveSide(monsterActor, combat), false);
});

test("isCombatantOnActiveSide and isTokenOnActiveSide resolve the current side", () => {
    const playerCombatant = createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 });
    const monsterCombatant = createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 });
    const combat = createCombat([playerCombatant, monsterCombatant], {
        activeSideId: "players",
        order: ["players", "monsters"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] },
            monsters: { id: "monsters", combatantIds: ["npc-1"] }
        }
    });

    const playerToken = { combatant: playerCombatant, actor: { combatant: playerCombatant } };
    const monsterToken = { combatant: monsterCombatant, actor: { combatant: monsterCombatant } };

    assert.equal(isSideCombat(combat), true);
    assert.equal(isCombatantOnActiveSide(combat, playerCombatant), true);
    assert.equal(isCombatantOnActiveSide(combat, monsterCombatant), false);
    assert.equal(isTokenOnActiveSide(playerToken, combat), true);
    assert.equal(isTokenOnActiveSide(monsterToken, combat), false);
    assert.equal(SideInitiativeAPI.isSideCombat(combat), true);
    assert.equal(SideInitiativeAPI.isCombatantOnActiveSide(playerCombatant, combat), true);
    assert.equal(SideInitiativeAPI.isTokenOnActiveSide(playerToken, combat), true);
});

test("normalizeCombatState preserves commander assignments", () => {
    const state = normalizeCombatState({
        version: 1,
        commanderIds: {
            Players: "pc-1"
        }
    });

    assert.equal(state.version, 2);
    assert.equal(state.commanderIds.players, "pc-1");
});

test("getSideRepresentativeCombatant prefers the configured commander", () => {
    const playerOne = createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1, sideId: "players" });
    const playerTwo = createCombatant({ id: "pc-2", hasPlayerOwner: true, disposition: 1, sideId: "players" });
    const combat = createCombat(
        [playerOne, playerTwo],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] }
            },
            commanderIds: {
                players: "pc-2"
            }
        },
        [playerOne, playerTwo]
    );

    assert.equal(getSideCommanderId(combat, "players"), "pc-2");
    assert.equal(getSideCommanderCombatant(combat, "players"), playerTwo);
    assert.equal(getSideRepresentativeCombatant(combat, "players"), playerTwo);
});

test("getSideRepresentativeCombatant falls back when the commander is defeated", () => {
    const playerOne = createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1, sideId: "players" });
    const playerTwo = createCombatant({ id: "pc-2", hasPlayerOwner: true, disposition: 1, sideId: "players" });
    playerTwo.defeated = true;
    const combat = createCombat(
        [playerOne, playerTwo],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] }
            },
            commanderIds: {
                players: "pc-2"
            }
        },
        [playerOne, playerTwo]
    );

    assert.equal(getSideCommanderCombatant(combat, "players"), null);
    assert.equal(getSideRepresentativeCombatant(combat, "players"), playerOne);
});

test("setSideCommander updates the commander and active turn for the active side", async () => {
    const playerOne = createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1, sideId: "players" });
    const playerTwo = createCombatant({ id: "pc-2", hasPlayerOwner: true, disposition: 1, sideId: "players" });
    const combat = createCombat(
        [playerOne, playerTwo],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] }
            }
        },
        [playerOne, playerTwo]
    );

    const state = await SideInitiativeAPI.setSideCommander(combat, playerTwo);

    assert.equal(state.commanderIds.players, "pc-2");
    assert.equal(getSideCommanderId(combat, "players"), "pc-2");
    assert.equal(combat.turn, 1);
    assert.equal(combat.lastUpdate.turn, 1);
});

test("commander permissions respect side owners and GM override", () => {
    const playerCombatant = createCombatant({ id: "pc-1", ownerIds: ["user-1"], hasPlayerOwner: true, sideId: "players" });
    const otherCombatant = createCombatant({ id: "pc-2", ownerIds: ["user-2"], hasPlayerOwner: true, sideId: "players" });
    const combat = createCombat(
        [playerCombatant, otherCombatant],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] }
            },
            commanderIds: {
                players: "pc-1"
            }
        },
        [playerCombatant, otherCombatant]
    );

    const userEnv = installCommanderGlobals({ user: { id: "user-1", isGM: false }, commanderControl: "side-owners" });
    try {
        assert.equal(SideInitiativeAPI.canUserSetCommander(playerCombatant), true);
        assert.equal(SideInitiativeAPI.canUserSetCommander(otherCombatant), false);
        assert.equal(SideInitiativeAPI.canUserAdvanceSide(combat), true);
    } finally {
        userEnv.restore();
    }

    const gmEnv = installCommanderGlobals({ user: { id: "gm-1", isGM: true }, commanderControl: "gm-only" });
    try {
        assert.equal(SideInitiativeAPI.canUserSetCommander(otherCombatant), true);
        assert.equal(SideInitiativeAPI.canUserAdvanceSide(combat), true);
    } finally {
        gmEnv.restore();
    }
});

test("advanceSide uses the combat turn order when it differs from combatant order", async () => {
    const p1 = createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 });
    const p2 = createCombatant({ id: "pc-2", hasPlayerOwner: true, disposition: 1 });
    const m1 = createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 });
    const m2 = createCombatant({ id: "npc-2", hasPlayerOwner: false, disposition: -1 });
    const combat = createCombat(
        [p1, p2, m1, m2],
        {
            activeSideId: "players",
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
                monsters: { id: "monsters", combatantIds: ["npc-1", "npc-2"] }
            }
        },
        [p1, m1, p2, m2]
    );

    await SideInitiativeAPI.advanceSide(combat, 1);
    assert.equal(combat.lastUpdate.turn, 1);
    assert.equal(combat.turn, 1);
    assert.equal(getActiveSideId(combat), "monsters");

    await SideInitiativeAPI.advanceSide(combat, 1);
    assert.equal(combat.lastUpdate.turn, 0);
    assert.equal(combat.turn, 0);
    assert.equal(combat.round, 2);
    assert.equal(getActiveSideId(combat), "players");
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

test("rollWeightedSideInitiativeData computes weighted averages by side", () => {
    const result = rollWeightedSideInitiativeData(
        [
            { id: "players", combatantIds: ["pc-1", "pc-2"] },
            { id: "monsters", combatantIds: ["lich", "goblin"] }
        ],
        {
            "pc-1": 10,
            "pc-2": 12,
            lich: 8,
            goblin: 18
        },
        {
            "pc-1": 1,
            "pc-2": 1,
            lich: 3900,
            goblin: 50
        },
        () => 0.5
    );

    assert.equal(result.rolls.find((entry) => entry.id === "players").roll, 11);
    assert.equal(result.rolls.find((entry) => entry.id === "monsters").roll, 8.13);
    assert.equal(result.order[0], "players");
    assert.equal(result.order[1], "monsters");
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

test("SideInitiativeAPI.rollSideInitiative creates visible roll messages", async () => {
    const combatants = [
        createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 }),
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 })
    ];
    const combat = createCombat(
        combatants,
        {
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1"] },
                monsters: { id: "monsters", combatantIds: ["npc-1"] }
            }
        },
        combatants
    );

    const messages = [];
    const originalFoundry = globalThis.foundry;
    const originalChatMessage = globalThis.ChatMessage;
    const originalGame = globalThis.game;

    globalThis.foundry = {
        dice: {
            Roll: {
                create() {
                    const total = [17, 9][messages.length];
                    return {
                        total,
                        async evaluate() {
                            return this;
                        },
                        async toMessage(data) {
                            messages.push({ total: this.total, ...data });
                            return this;
                        }
                    };
                }
            }
        },
        documents: {
            ChatMessage: {
                implementation: {
                    getSpeaker({ alias }) {
                        return { alias };
                    }
                }
            }
        }
    };
    globalThis.ChatMessage = globalThis.foundry.documents.ChatMessage;
    globalThis.game = {
        user: { id: "gm-1", isGM: true },
        settings: {
            get(namespace, key) {
                if (namespace === "side-initiative" && key === "initiativeMethod") return "side-d20";
                if (namespace === "core" && key === "rollMode") return "publicroll";
                return null;
            }
        },
        i18n: {
            format(key, data) {
                return `${key}:${data.name}`;
            }
        }
    };

    try {
        const state = await SideInitiativeAPI.rollSideInitiative(combat, { random: () => 0.5 });

        assert.equal(messages.length, 2);
        assert.deepEqual(messages.map((entry) => entry.total), [17, 9]);
        assert.deepEqual(messages.map((entry) => entry.speaker.alias), ["Players", "Monsters"]);
        assert.equal(combatants[0].initiative, 17);
        assert.equal(combatants[1].initiative, 9);
        assert.equal(state.order[0], "players");
        assert.equal(getActiveSideId(combat), "players");
    } finally {
        globalThis.foundry = originalFoundry;
        globalThis.ChatMessage = originalChatMessage;
        globalThis.game = originalGame;
    }
});

test("SideInitiativeAPI.rollWeightedSideInitiative applies weighted averages to all combatants", async () => {
    const combatants = [
        createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1, sideId: "players", initiativeTotal: 10 }),
        createCombatant({ id: "pc-2", hasPlayerOwner: true, disposition: 1, sideId: "players", initiativeTotal: 12 }),
        createCombatant({ id: "lich", hasPlayerOwner: false, disposition: -1, sideId: "monsters", actorXp: 3900, initiativeTotal: 8 }),
        createCombatant({ id: "goblin", hasPlayerOwner: false, disposition: -1, sideId: "monsters", actorXp: 50, initiativeTotal: 18 })
    ];
    combatants[0].initiative = 10;
    combatants[1].initiative = 12;
    combatants[2].initiative = 8;
    combatants[3].initiative = 18;
    const combat = createCombat(
        combatants,
        {
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
                monsters: { id: "monsters", combatantIds: ["lich", "goblin"] }
            }
        },
        combatants
    );

    const state = await SideInitiativeAPI.rollWeightedSideInitiative(combat, { refresh: false, random: () => 0.25 });

    assert.equal(state.order[0], "players");
    assert.equal(combatants[0].initiative, 11);
    assert.equal(combatants[1].initiative, 11);
    assert.equal(combatants[2].initiative, 8.13);
    assert.equal(combatants[3].initiative, 8.13);
    assert.equal(getActiveSideId(combat), "players");
    assert.equal(combat.turn, 0);
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
