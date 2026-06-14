import test from "node:test";
import assert from "node:assert/strict";
import { registerMidiQolIntegration } from "../scripts/integration/midi-qol.mjs";

function createCombatant({ id, sideId, actor, defeated = false }) {
    return {
        id,
        defeated,
        actor,
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "sideId") return sideId;
            return null;
        }
    };
}

function createReactionActor({ id, uuid = `${id}-uuid`, deletes, updates, deleteError = null } = {}) {
    const reactionEffectId = "dnd5ereaction000";
    return {
        id,
        uuid,
        effects: new Map([
            [
                reactionEffectId,
                {
                    async delete() {
                        if (deleteError) throw deleteError;
                        deletes?.push({ actorUuid: uuid, effectId: reactionEffectId });
                    }
                }
            ]
        ]),
        async update(data) {
            updates?.push({ actorUuid: uuid, data });
        }
    };
}

function createHooks() {
    const registry = new Map();
    return {
        on(name, handler) {
            if (!registry.has(name)) registry.set(name, []);
            registry.get(name).push(handler);
        },
        once() {},
        get(name) {
            return registry.get(name) ?? [];
        }
    };
}

function installGlobals({ combat, midiQol = {} } = {}) {
    const original = {
        Hooks: globalThis.Hooks,
        game: globalThis.game,
        MidiQOL: globalThis.MidiQOL,
        midiQOL: globalThis.midiQOL
    };

    const hooks = createHooks();
    globalThis.Hooks = hooks;
    globalThis.game = {
        combat: combat ?? null,
        user: { id: "gm-1", isGM: true },
        users: {
            activeGM: { id: "gm-1", isGM: true, active: true }
        }
    };
    globalThis.MidiQOL = midiQol;
    globalThis.midiQOL = midiQol;

    return {
        hooks,
        restore() {
            globalThis.Hooks = original.Hooks;
            globalThis.game = original.game;
            globalThis.MidiQOL = original.MidiQOL;
            globalThis.midiQOL = original.midiQOL;
        }
    };
}

test("MidiQOL blocks reaction consumption for actors on the active side", async () => {
    const actor = { id: "actor-1", combatant: null };
    const activeCombatant = createCombatant({ id: "pc-1", sideId: "players", actor });
    actor.combatant = activeCombatant;

    const combat = {
        started: true,
        combatants: [activeCombatant],
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: "players",
                    order: ["players"],
                    sides: {
                        players: { id: "players", combatantIds: ["pc-1"] }
                    },
                    commanderIds: {}
                };
            }
            return null;
        }
    };

    const env = installGlobals({ combat });
    try {
        registerMidiQolIntegration();

        const [preSetReactionUsed] = env.hooks.get("midi-qol.preSetReactionUsed");
        assert.equal(await preSetReactionUsed(actor), false);
    } finally {
        env.restore();
    }
});

test("MidiQOL clears used reactions for all actors on the side when it becomes active again", async () => {
    const deletes = [];
    const updates = [];
    const actorOne = createReactionActor({ id: "actor-1", deletes, updates });
    const actorTwo = createReactionActor({ id: "actor-2", deletes, updates });
    const defeatedActor = createReactionActor({ id: "actor-3", deletes, updates });
    const combat = {
        started: true,
        combatants: [
            createCombatant({ id: "pc-1", sideId: "players", actor: actorOne }),
            createCombatant({ id: "pc-2", sideId: "players", actor: actorOne }),
            createCombatant({ id: "pc-3", sideId: "players", actor: actorTwo }),
            createCombatant({ id: "pc-4", sideId: "players", actor: defeatedActor, defeated: true })
        ],
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: "monsters",
                    order: ["players", "monsters"],
                    sides: {
                        players: { id: "players", combatantIds: ["pc-1", "pc-2", "pc-3", "pc-4"] },
                        monsters: { id: "monsters", combatantIds: [] }
                    },
                    commanderIds: {}
                };
            }
            return null;
        }
    };

    const env = installGlobals({ combat });
    try {
        registerMidiQolIntegration();

        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "players" });

        assert.deepEqual(deletes, [
            { actorUuid: "actor-1-uuid", effectId: "dnd5ereaction000" },
            { actorUuid: "actor-2-uuid", effectId: "dnd5ereaction000" }
        ]);
        assert.deepEqual(updates, [
            {
                actorUuid: "actor-1-uuid",
                data: {
                    flags: {
                        "midi-qol": {
                            actions: {
                                reactionUsed: 0,
                                reactionsUsed: 0,
                                "-=reactionCombatRound": null
                            }
                        }
                    }
                }
            },
            {
                actorUuid: "actor-2-uuid",
                data: {
                    flags: {
                        "midi-qol": {
                            actions: {
                                reactionUsed: 0,
                                reactionsUsed: 0,
                                "-=reactionCombatRound": null
                            }
                        }
                    }
                }
            }
        ]);
    } finally {
        env.restore();
    }
});

test("MidiQOL clears used reactions for distinct monster token actors even when the base actor id matches", async () => {
    const deletes = [];
    const updates = [];
    const baseActor = createReactionActor({ id: "monster-base", uuid: "monster-base-uuid", deletes, updates });
    const monsterOneActor = createReactionActor({ id: "monster-base", uuid: "monster-one-uuid", deletes, updates });
    const monsterTwoActor = createReactionActor({ id: "monster-base", uuid: "monster-two-uuid", deletes, updates });

    const combat = {
        started: true,
        combatants: [
            {
                id: "npc-1",
                actor: baseActor,
                token: {
                    id: "token-1",
                    uuid: "token-1-uuid",
                    actor: monsterOneActor
                },
                getFlag(scope, key) {
                    if (scope === "side-initiative" && key === "sideId") return "monsters";
                    return null;
                }
            },
            {
                id: "npc-2",
                actor: baseActor,
                token: {
                    id: "token-2",
                    uuid: "token-2-uuid",
                    actor: monsterTwoActor
                },
                getFlag(scope, key) {
                    if (scope === "side-initiative" && key === "sideId") return "monsters";
                    return null;
                }
            }
        ],
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: "players",
                    order: ["players", "monsters"],
                    sides: {
                        players: { id: "players", combatantIds: [] },
                        monsters: { id: "monsters", combatantIds: ["npc-1", "npc-2"] }
                    },
                    commanderIds: {}
                };
            }
            return null;
        }
    };

    const env = installGlobals({ combat });
    try {
        registerMidiQolIntegration();

        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        assert.deepEqual(deletes, [
            { actorUuid: "monster-one-uuid", effectId: "dnd5ereaction000" },
            { actorUuid: "monster-two-uuid", effectId: "dnd5ereaction000" }
        ]);
        assert.deepEqual(updates, [
            {
                actorUuid: "monster-one-uuid",
                data: {
                    flags: {
                        "midi-qol": {
                            actions: {
                                reactionUsed: 0,
                                reactionsUsed: 0,
                                "-=reactionCombatRound": null
                            }
                        }
                    }
                }
            },
            {
                actorUuid: "monster-two-uuid",
                data: {
                    flags: {
                        "midi-qol": {
                            actions: {
                                reactionUsed: 0,
                                reactionsUsed: 0,
                                "-=reactionCombatRound": null
                            }
                        }
                    }
                }
            }
        ]);
    } finally {
        env.restore();
    }
});

test("MidiQOL continues clearing side reactions when one actor has a stale reaction effect", async () => {
    const deletes = [];
    const updates = [];
    const actorOne = createReactionActor({
        id: "actor-1",
        deletes,
        updates,
        deleteError: new Error('ActiveEffect "dnd5ereaction000" does not exist!')
    });
    const actorTwo = createReactionActor({ id: "actor-2", deletes, updates });
    const combat = {
        started: true,
        combatants: [
            createCombatant({ id: "npc-1", sideId: "monsters", actor: actorOne }),
            createCombatant({ id: "npc-2", sideId: "monsters", actor: actorTwo })
        ],
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: "players",
                    order: ["players", "monsters"],
                    sides: {
                        players: { id: "players", combatantIds: [] },
                        monsters: { id: "monsters", combatantIds: ["npc-1", "npc-2"] }
                    },
                    commanderIds: {}
                };
            }
            return null;
        }
    };

    const env = installGlobals({ combat });
    try {
        registerMidiQolIntegration();

        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        assert.deepEqual(deletes, [
            { actorUuid: "actor-2-uuid", effectId: "dnd5ereaction000" }
        ]);
        assert.deepEqual(updates.map((entry) => entry.actorUuid), ["actor-1-uuid", "actor-2-uuid"]);
    } finally {
        env.restore();
    }
});

test("MidiQOL clears a single used reaction effect when the API is unavailable", async () => {
    const deletes = [];
    const updates = [];
    const reactionEffectId = "dnd5ereaction000";
    const actor = {
        id: "actor-1",
        effects: new Map([
            [
                reactionEffectId,
                {
                    async delete() {
                        deletes.push(reactionEffectId);
                    }
                }
            ]
        ]),
        async update(data) {
            updates.push(data);
        }
    };

    const combat = {
        started: true,
        combatants: [
            createCombatant({ id: "pc-1", sideId: "players", actor })
        ],
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: "monsters",
                    order: ["players", "monsters"],
                    sides: {
                        players: { id: "players", combatantIds: ["pc-1"] },
                        monsters: { id: "monsters", combatantIds: [] }
                    },
                    commanderIds: {}
                };
            }
            return null;
        }
    };

    const env = installGlobals({ combat, midiQol: {} });
    try {
        registerMidiQolIntegration();

        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "players" });

        assert.deepEqual(deletes, [reactionEffectId]);
        assert.deepEqual(updates, [
            {
                flags: {
                    "midi-qol": {
                        actions: {
                            reactionUsed: 0,
                            reactionsUsed: 0,
                            "-=reactionCombatRound": null
                        }
                    }
                }
            }
        ]);
    } finally {
        env.restore();
    }
});
