import test from "node:test";
import assert from "node:assert/strict";
import {
    clearSideTurnEndFlushers,
    getRoundTimeDelta,
    registerSideTurnEndFlusher,
    SideInitiativeAPI,
} from "../src/api.js";
import {
    defaultSideIdForCombatant,
    ensureCombatantSideAssignments,
    getActiveSideId,
    getCombatantFromActor,
    getCombatantInitiativeWeight,
    isCombatantOnActiveSide,
    isUserOnSide,
    getSideCommanderCombatant,
    getSideCommanderId,
    getNextSideId,
    getSideRepresentativeCombatant,
    groupBy,
    isActorOnActiveSide,
    isSideCombat,
    isTokenOnActiveSide,
    normalizeSideId,
    normalizeCombatState,
    rollSideInitiativeData,
    rollWeightedSideInitiativeData,
} from "../src/logic.js";

function createCombatant({
    id,
    hasPlayerOwner = false,
    disposition = 0,
    sideId = null,
    sideSource = null,
    ownerIds = [],
    actorXp = null,
    initiativeTotal = 10,
}) {
    const flags = new Map();
    if (sideId) flags.set("side-initiative:sideId", sideId);
    if (sideSource) flags.set("side-initiative:sideSource", sideSource);
    const xp = actorXp === null ? null : typeof actorXp === "object" ? actorXp : { value: actorXp };
    const actor = {
        hasPlayerOwner,
        system: xp ? { details: { xp } } : { details: {} },
        getRollData() {
            return {};
        },
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
            return permission === "OWNER" && (user?.isGM || ownerIds.includes(user?.id));
        },
        getInitiativeRoll() {
            return {
                total: initiativeTotal,
                evaluate: async function evaluate() {
                    return this;
                },
            };
        },
        getFlag(scope, key) {
            return flags.get(`${scope}:${key}`) ?? null;
        },
        setFlag(scope, key, value) {
            flags.set(`${scope}:${key}`, value);
            return Promise.resolve(value);
        },
        flags,
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
                const combatant =
                    this.combatants instanceof Map
                        ? this.combatants.get(doc._id)
                        : this.combatants.find((entry) => entry.id === doc._id);
                if (combatant) combatant.initiative = doc.initiative;
            }
            return Promise.resolve();
        },
        update(data, options) {
            this.lastUpdate = data;
            this.lastUpdateOptions = options;
            if (typeof data.round === "number") this.round = data.round;
            if (typeof data.turn === "number") this.turn = data.turn;
            return Promise.resolve();
        },
    };
}

function installCommanderGlobals({ user = { id: "user-1", isGM: false }, commanderControl = "side-owners" } = {}) {
    const original = globalThis.game;
    globalThis.game = {
        user,
        settings: {
            get(namespace, key) {
                if (namespace === "side-initiative" && key === "commanderControl") {
                    return commanderControl;
                }
                return null;
            },
        },
    };
    return {
        restore() {
            globalThis.game = original;
        },
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
        createCombatant({
            id: "npc-2",
            hasPlayerOwner: false,
            disposition: 0,
            sideId: "neutral",
            sideSource: "manual",
        }),
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
    const player = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        actorXp: 500,
    });
    const lich = createCombatant({
        id: "npc-1",
        hasPlayerOwner: false,
        actorXp: 3900,
    });
    const goblin = createCombatant({
        id: "npc-2",
        hasPlayerOwner: false,
        actorXp: { value: 50 },
    });
    const unknown = createCombatant({
        id: "npc-3",
        hasPlayerOwner: false,
        actorXp: 0,
    });

    assert.equal(getCombatantInitiativeWeight(player), 1);
    assert.equal(getCombatantInitiativeWeight(lich), 3900);
    assert.equal(getCombatantInitiativeWeight(goblin), 50);
    assert.equal(getCombatantInitiativeWeight(unknown), 1);
});

test("isActorOnActiveSide resolves an actor combatant and checks the active side", () => {
    const combatants = [
        createCombatant({ id: "pc-1", hasPlayerOwner: true, disposition: 1 }),
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 }),
    ];
    const combat = createCombat(combatants, {
        activeSideId: "players",
        order: ["players", "monsters"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] },
            monsters: { id: "monsters", combatantIds: ["npc-1"] },
        },
    });

    const playerActor = { combatant: combatants[0] };
    const monsterActor = { combatant: combatants[1] };

    assert.equal(getCombatantFromActor(playerActor), combatants[0]);
    assert.equal(isActorOnActiveSide(playerActor, combat), true);
    assert.equal(isActorOnActiveSide(monsterActor, combat), false);
});

test("isCombatantOnActiveSide and isTokenOnActiveSide resolve the current side", () => {
    const playerCombatant = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
    });
    const monsterCombatant = createCombatant({
        id: "npc-1",
        hasPlayerOwner: false,
        disposition: -1,
    });
    const combat = createCombat([playerCombatant, monsterCombatant], {
        activeSideId: "players",
        order: ["players", "monsters"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] },
            monsters: { id: "monsters", combatantIds: ["npc-1"] },
        },
    });

    const playerToken = {
        combatant: playerCombatant,
        actor: { combatant: playerCombatant },
    };
    const monsterToken = {
        combatant: monsterCombatant,
        actor: { combatant: monsterCombatant },
    };

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
            Players: "pc-1",
        },
    });

    assert.equal(state.version, 2);
    assert.equal(state.commanderIds.players, "pc-1");
});

test("getSideRepresentativeCombatant prefers the configured commander", () => {
    const playerOne = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
        sideId: "players",
    });
    const playerTwo = createCombatant({
        id: "pc-2",
        hasPlayerOwner: true,
        disposition: 1,
        sideId: "players",
    });
    const combat = createCombat(
        [playerOne, playerTwo],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
            },
            commanderIds: {
                players: "pc-2",
            },
        },
        [playerOne, playerTwo],
    );

    assert.equal(getSideCommanderId(combat, "players"), "pc-2");
    assert.equal(getSideCommanderCombatant(combat, "players"), playerTwo);
    assert.equal(getSideRepresentativeCombatant(combat, "players"), playerTwo);
});

test("getSideRepresentativeCombatant falls back when the commander is defeated", () => {
    const playerOne = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
        sideId: "players",
    });
    const playerTwo = createCombatant({
        id: "pc-2",
        hasPlayerOwner: true,
        disposition: 1,
        sideId: "players",
    });
    playerTwo.defeated = true;
    const combat = createCombat(
        [playerOne, playerTwo],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
            },
            commanderIds: {
                players: "pc-2",
            },
        },
        [playerOne, playerTwo],
    );

    assert.equal(getSideCommanderCombatant(combat, "players"), null);
    assert.equal(getSideRepresentativeCombatant(combat, "players"), playerOne);
});

test("getSideRepresentativeCombatant picks the highest-weight member when no commander is set", () => {
    const goblin = createCombatant({
        id: "goblin",
        disposition: -1,
        sideId: "monsters",
        actorXp: 50,
    });
    const warlord = createCombatant({
        id: "warlord",
        disposition: -1,
        sideId: "monsters",
        actorXp: 2300,
    });
    const orc = createCombatant({
        id: "orc",
        disposition: -1,
        sideId: "monsters",
        actorXp: 450,
    });
    const combat = createCombat(
        [goblin, warlord, orc],
        {
            activeSideId: "monsters",
            order: ["monsters"],
            sides: {
                monsters: {
                    id: "monsters",
                    combatantIds: ["goblin", "warlord", "orc"],
                },
            },
        },
        [goblin, warlord, orc],
    );

    assert.equal(getSideRepresentativeCombatant(combat, "monsters"), warlord);
});

test("setSideCommander updates the commander and active turn for the active side", async () => {
    const playerOne = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
        sideId: "players",
    });
    const playerTwo = createCombatant({
        id: "pc-2",
        hasPlayerOwner: true,
        disposition: 1,
        sideId: "players",
    });
    const combat = createCombat(
        [playerOne, playerTwo],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
            },
        },
        [playerOne, playerTwo],
    );

    const state = await SideInitiativeAPI.setSideCommander(combat, playerTwo);

    assert.equal(state.commanderIds.players, "pc-2");
    assert.equal(getSideCommanderId(combat, "players"), "pc-2");
    assert.equal(combat.turn, 1);
    assert.equal(combat.lastUpdate.turn, 1);
});

test("commander permissions respect side owners and GM override", () => {
    // pc-1 is the configured commander (the side representative); user-1 owns pc-1.
    // pc-2 is a non-commander side member; user-2 owns pc-2.
    const playerCombatant = createCombatant({
        id: "pc-1",
        ownerIds: ["user-1"],
        hasPlayerOwner: true,
        sideId: "players",
    });
    const otherCombatant = createCombatant({
        id: "pc-2",
        ownerIds: ["user-2"],
        hasPlayerOwner: true,
        sideId: "players",
    });
    const combat = createCombat(
        [playerCombatant, otherCombatant],
        {
            activeSideId: "players",
            order: ["players"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
            },
            commanderIds: {
                players: "pc-1",
            },
        },
        [playerCombatant, otherCombatant],
    );

    // Bug 2: user-1 owns a side member (pc-1) and may crown a DIFFERENT same-side ally (pc-2).
    // Previously the gate tested ownership of pc-2 itself, blocking user-1.
    const userEnv = installCommanderGlobals({
        user: { id: "user-1", isGM: false },
        commanderControl: "side-owners",
    });
    try {
        assert.equal(SideInitiativeAPI.canUserSetCommander(playerCombatant, undefined, combat), true);
        assert.equal(SideInitiativeAPI.canUserSetCommander(otherCombatant, undefined, combat), true);
        assert.equal(SideInitiativeAPI.canUserAdvanceSide(combat), true);
    } finally {
        userEnv.restore();
    }

    // Bug 1: user-2 owns a NON-representative side member (pc-2) and may advance the side,
    // even though the representative (pc-1) is owned by user-1.
    const user2Env = installCommanderGlobals({
        user: { id: "user-2", isGM: false },
        commanderControl: "side-owners",
    });
    try {
        assert.equal(SideInitiativeAPI.canUserAdvanceSide(combat), true);
        assert.equal(SideInitiativeAPI.canUserSetCommander(otherCombatant, undefined, combat), true);
    } finally {
        user2Env.restore();
    }

    // gm-only blocks players at every gate; GMs always pass.
    const gmEnv = installCommanderGlobals({
        user: { id: "gm-1", isGM: true },
        commanderControl: "gm-only",
    });
    try {
        assert.equal(SideInitiativeAPI.canUserSetCommander(otherCombatant, undefined, combat), true);
        assert.equal(SideInitiativeAPI.canUserAdvanceSide(combat), true);
    } finally {
        gmEnv.restore();
    }

    const blockedEnv = installCommanderGlobals({
        user: { id: "user-1", isGM: false },
        commanderControl: "gm-only",
    });
    try {
        assert.equal(SideInitiativeAPI.canUserSetCommander(otherCombatant, undefined, combat), false);
        assert.equal(SideInitiativeAPI.canUserAdvanceSide(combat), false);
    } finally {
        blockedEnv.restore();
    }
});

test("isUserOnSide reports per-user side membership", () => {
    const pc1 = createCombatant({
        id: "pc-1",
        ownerIds: ["user-1"],
        hasPlayerOwner: true,
        sideId: "players",
    });
    const pc2 = createCombatant({
        id: "pc-2",
        ownerIds: ["user-2"],
        hasPlayerOwner: true,
        sideId: "players",
    });
    const npc = createCombatant({
        id: "npc-1",
        hasPlayerOwner: false,
        disposition: -1,
        sideId: "monsters",
    });
    const combat = createCombat([pc1, pc2, npc], {
        activeSideId: "players",
        order: ["players", "monsters"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
            monsters: { id: "monsters", combatantIds: ["npc-1"] },
        },
    });

    const user1 = { id: "user-1", isGM: false };
    const user2 = { id: "user-2", isGM: false };
    const user3 = { id: "user-3", isGM: false };

    assert.equal(isUserOnSide(combat, "players", user1), true);
    assert.equal(isUserOnSide(combat, "players", user2), true);
    assert.equal(isUserOnSide(combat, "players", user3), false);
    assert.equal(isUserOnSide(combat, "monsters", user1), false);

    // Defeated members do not count toward membership.
    pc1.defeated = true;
    assert.equal(isUserOnSide(combat, "players", user1), false);
});

test("advanceSide uses the combat turn order when it differs from combatant order", async () => {
    const p1 = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
    });
    const p2 = createCombatant({
        id: "pc-2",
        hasPlayerOwner: true,
        disposition: 1,
    });
    const m1 = createCombatant({
        id: "npc-1",
        hasPlayerOwner: false,
        disposition: -1,
    });
    const m2 = createCombatant({
        id: "npc-2",
        hasPlayerOwner: false,
        disposition: -1,
    });
    const combat = createCombat(
        [p1, p2, m1, m2],
        {
            activeSideId: "players",
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
                monsters: { id: "monsters", combatantIds: ["npc-1", "npc-2"] },
            },
        },
        [p1, m1, p2, m2],
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

test("getRoundTimeDelta maps round deltas to CONFIG.time.roundTime seconds", () => {
    const configHolder = globalThis as {
        CONFIG?: { time?: { roundTime?: number } };
    };
    const originalConfig = configHolder.CONFIG;
    configHolder.CONFIG = { time: { roundTime: 6 } };
    try {
        assert.equal(getRoundTimeDelta(0), 0);
        assert.equal(getRoundTimeDelta(1), 6);
        assert.equal(getRoundTimeDelta(2), 12);
        assert.equal(getRoundTimeDelta(-1), -6);
    } finally {
        configHolder.CONFIG = originalConfig;
    }
});

test("getRoundTimeDelta is 0 when round time is unset (no Foundry)", () => {
    const configHolder = globalThis as {
        CONFIG?: { time?: { roundTime?: number } };
    };
    const originalConfig = configHolder.CONFIG;
    configHolder.CONFIG = undefined;
    try {
        assert.equal(getRoundTimeDelta(1), 0);
    } finally {
        configHolder.CONFIG = originalConfig;
    }
});

test("advanceSide advances world time only when a round elapses (Detect Magic timer)", async () => {
    const p1 = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
    });
    const p2 = createCombatant({
        id: "pc-2",
        hasPlayerOwner: true,
        disposition: 1,
    });
    const m1 = createCombatant({
        id: "npc-1",
        hasPlayerOwner: false,
        disposition: -1,
    });
    const m2 = createCombatant({
        id: "npc-2",
        hasPlayerOwner: false,
        disposition: -1,
    });
    const combat = createCombat(
        [p1, p2, m1, m2],
        {
            activeSideId: "players",
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
                monsters: { id: "monsters", combatantIds: ["npc-1", "npc-2"] },
            },
        },
        [p1, m1, p2, m2],
    );

    const configHolder = globalThis as {
        CONFIG?: { time?: { roundTime?: number } };
    };
    const originalConfig = configHolder.CONFIG;
    configHolder.CONFIG = { time: { roundTime: 6 } };
    try {
        // players -> monsters: same round, so world time must not advance.
        await SideInitiativeAPI.advanceSide(combat, 1);
        assert.equal(combat.lastUpdateOptions, undefined);

        // monsters -> players: the round wraps, so combat.update carries a
        // worldTime delta (one round = 6s) so seconds-based effect durations tick.
        await SideInitiativeAPI.advanceSide(combat, 1);
        assert.deepEqual(combat.lastUpdateOptions, { worldTime: { delta: 6 } });
        assert.equal(combat.round, 2);
    } finally {
        configHolder.CONFIG = originalConfig;
    }
});

test("advanceSide emits side turn lifecycle hooks and setActiveSide does not re-emit them for the current side", async () => {
    const p1 = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
    });
    const m1 = createCombatant({
        id: "npc-1",
        hasPlayerOwner: false,
        disposition: -1,
    });
    const combat = createCombat(
        [p1, m1],
        {
            activeSideId: "players",
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1"] },
                monsters: { id: "monsters", combatantIds: ["npc-1"] },
            },
        },
        [p1, m1],
    );

    const events = [];
    const originalHooks = globalThis.Hooks;
    const originalSetFlag = combat.setFlag.bind(combat);
    const originalUpdate = combat.update.bind(combat);
    globalThis.Hooks = {
        callAll(name, payload) {
            events.push({ name, payload });
        },
    };
    combat.setFlag = async function setFlag(scope, key, value) {
        if (scope === "side-initiative" && key === "state") {
            events.push({ name: "combat.setFlag", value });
        }
        return originalSetFlag(scope, key, value);
    };
    combat.update = async function update(data) {
        events.push({ name: "combat.update", data });
        return originalUpdate(data);
    };

    try {
        await SideInitiativeAPI.setActiveSide(combat, "players");
        assert.equal(
            events.some(
                (event) =>
                    event.name === "side-initiative.sideTurnEnd" || event.name === "side-initiative.sideTurnStart",
            ),
            false,
        );

        events.length = 0;
        await SideInitiativeAPI.advanceSide(combat, 1);

        assert.deepEqual(events[0], {
            name: "side-initiative.sideTurnEnd",
            payload: {
                combat,
                sideId: "players",
                nextSideId: "monsters",
            },
        });
        assert.deepEqual(events.at(-1), {
            name: "side-initiative.sideTurnStart",
            payload: {
                combat,
                sideId: "monsters",
                previousSideId: "players",
            },
        });
        assert.ok(events.some((event) => event.name === "combat.setFlag"));
        assert.ok(events.some((event) => event.name === "combat.update"));
    } finally {
        globalThis.Hooks = originalHooks;
        combat.setFlag = originalSetFlag;
        combat.update = originalUpdate;
    }
});

test("advanceSide awaits sideTurnEnd flushers before the turn advances (combat.update)", async () => {
    const p1 = createCombatant({
        id: "pc-1",
        hasPlayerOwner: true,
        disposition: 1,
    });
    const m1 = createCombatant({
        id: "npc-1",
        hasPlayerOwner: false,
        disposition: -1,
    });
    const combat = createCombat(
        [p1, m1],
        {
            activeSideId: "players",
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1"] },
                monsters: { id: "monsters", combatantIds: ["npc-1"] },
            },
        },
        [p1, m1],
    );

    const events: string[] = [];
    const originalHooks = globalThis.Hooks;
    const originalUpdate = combat.update.bind(combat);
    globalThis.Hooks = {
        callAll(name: string) {
            events.push(`hook:${name}`);
        },
    };
    combat.update = async function update(data) {
        events.push("combat.update");
        return originalUpdate(data);
    };

    const flusher = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push("flusher-done");
    };
    registerSideTurnEndFlusher(flusher);

    try {
        await SideInitiativeAPI.advanceSide(combat, 1);

        // The flusher must finish before combat.update fires — end-of-turn work
        // (e.g. the CPR bridge's turnEnd workflows) has to complete before the
        // advancing update triggers midi-qol's end-of-turn auto-untarget.
        const flusherAt = events.indexOf("flusher-done");
        const updateAt = events.indexOf("combat.update");
        assert.notEqual(flusherAt, -1, "flusher was not awaited");
        assert.ok(flusherAt < updateAt, `expected flusher-done before combat.update, got [${events.join(", ")}]`);
    } finally {
        clearSideTurnEndFlushers();
        globalThis.Hooks = originalHooks;
        combat.update = originalUpdate;
    }
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
            { id: "monsters", combatantIds: ["lich", "goblin"] },
        ],
        {
            "pc-1": 10,
            "pc-2": 12,
            lich: 8,
            goblin: 18,
        },
        {
            "pc-1": 1,
            "pc-2": 1,
            lich: 3900,
            goblin: 50,
        },
        () => 0.5,
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
        createCombatant({ id: "npc-2", hasPlayerOwner: false, disposition: -1 }),
    ];
    const combat = createCombat(combatants);

    const state = await SideInitiativeAPI.rollSideInitiative(combat, {
        random: (() => {
            const values = [0.9, 0.8, 0.2, 0.3, 0.1, 0.4];
            let index = 0;
            return () => values[index++ % values.length];
        })(),
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
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 }),
    ];
    const combat = createCombat(
        combatants,
        {
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1"] },
                monsters: { id: "monsters", combatantIds: ["npc-1"] },
            },
        },
        combatants,
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
                        },
                    };
                },
            },
        },
        documents: {
            ChatMessage: {
                implementation: {
                    getSpeaker({ alias }) {
                        return { alias };
                    },
                },
            },
        },
    };
    globalThis.ChatMessage = globalThis.foundry.documents.ChatMessage;
    globalThis.game = {
        user: { id: "gm-1", isGM: true },
        settings: {
            get(namespace, key) {
                if (namespace === "side-initiative" && key === "initiativeMethod") return "side-d20";
                if (namespace === "core" && key === "rollMode") return "publicroll";
                return null;
            },
        },
        i18n: {
            format(key, data) {
                return `${key}:${data.name}`;
            },
        },
    };

    try {
        const state = await SideInitiativeAPI.rollSideInitiative(combat, {
            random: () => 0.5,
        });

        assert.equal(messages.length, 2);
        assert.deepEqual(
            messages.map((entry) => entry.total),
            [17, 9],
        );
        assert.deepEqual(
            messages.map((entry) => entry.speaker.alias),
            ["Players", "Monsters"],
        );
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
        createCombatant({
            id: "pc-1",
            hasPlayerOwner: true,
            disposition: 1,
            sideId: "players",
            initiativeTotal: 10,
        }),
        createCombatant({
            id: "pc-2",
            hasPlayerOwner: true,
            disposition: 1,
            sideId: "players",
            initiativeTotal: 12,
        }),
        createCombatant({
            id: "lich",
            hasPlayerOwner: false,
            disposition: -1,
            sideId: "monsters",
            actorXp: 3900,
            initiativeTotal: 8,
        }),
        createCombatant({
            id: "goblin",
            hasPlayerOwner: false,
            disposition: -1,
            sideId: "monsters",
            actorXp: 50,
            initiativeTotal: 18,
        }),
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
                monsters: { id: "monsters", combatantIds: ["lich", "goblin"] },
            },
        },
        combatants,
    );

    const state = await SideInitiativeAPI.rollWeightedSideInitiative(combat, {
        refresh: false,
        random: () => 0.25,
    });

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
        createCombatant({ id: "npc-1", hasPlayerOwner: false, disposition: -1 }),
    ];
    const combat = createCombat(combatants, {
        activeSideId: "players",
        order: ["players", "allies", "neutral", "monsters"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] },
            monsters: { id: "monsters", combatantIds: ["npc-1"] },
        },
    });

    assert.equal(getNextSideId(combat, 1), "monsters");
});

test("groupBy groups values by key", () => {
    const grouped = groupBy([1, 2, 3, 4], (value) => value % 2);
    assert.deepEqual(grouped.get(0), [2, 4]);
    assert.deepEqual(grouped.get(1), [1, 3]);
});
