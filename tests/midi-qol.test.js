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

test("MidiQOL clears used reactions through the public API when a side becomes active again", async () => {
    const calls = [];
    const midiQol = {
        async removeReactionUsed(actor, force) {
            calls.push({ method: "removeReactionUsed", actorId: actor.id, force });
        }
    };

    const actorOne = { id: "actor-1" };
    const actorTwo = { id: "actor-2" };
    const defeatedActor = { id: "actor-3" };
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

    const env = installGlobals({ combat, midiQol });
    try {
        registerMidiQolIntegration();

        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "players" });

        assert.deepEqual(calls, [
            { method: "removeReactionUsed", actorId: "actor-1", force: true },
            { method: "removeReactionUsed", actorId: "actor-2", force: true }
        ]);
    } finally {
        env.restore();
    }
});

test("MidiQOL falls back to a direct reaction clear when the API is unavailable", async () => {
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
