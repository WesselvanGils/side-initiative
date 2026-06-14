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

function installGlobals({ combat } = {}) {
    const original = {
        Hooks: globalThis.Hooks,
        game: globalThis.game
    };

    const hooks = createHooks();
    globalThis.Hooks = hooks;
    globalThis.game = {
        combat: combat ?? null
    };

    return {
        hooks,
        restore() {
            globalThis.Hooks = original.Hooks;
            globalThis.game = original.game;
        }
    };
}

test("MidiQOL keeps reactions available for same-side actors", async () => {
    const actor = {
        id: "actor-1",
        combatant: null
    };
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

test("MidiQOL clears used reactions when a side becomes active again", async () => {
    const actor = {
        id: "actor-1",
        system: {
            attributes: {
                reaction: {
                    used: true,
                    value: 0,
                    max: 1
                }
            }
        },
        flags: {
            "midi-qol": {
                reactionUsed: true
            }
        },
        updates: [],
        async update(data) {
            this.updates.push(data);
            return this;
        }
    };

    const combatant = createCombatant({ id: "pc-1", sideId: "players", actor });
    actor.combatant = combatant;

    const combat = {
        started: true,
        combatants: [combatant],
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

        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "players" });

        assert.deepEqual(actor.updates, [
            {
                "system.attributes.reaction.used": false,
                "system.attributes.reaction.value": 1,
                "flags.midi-qol.reactionUsed": false
            }
        ]);
    } finally {
        env.restore();
    }
});

test("MidiQOL skips defeated combatants and deduplicates shared actors", async () => {
    const actor = {
        id: "actor-1",
        system: {
            attributes: {
                reaction: {
                    used: true,
                    value: true
                }
            }
        },
        updates: [],
        async update(data) {
            this.updates.push(data);
            return this;
        }
    };

    const sharedOne = createCombatant({ id: "pc-1", sideId: "players", actor });
    const sharedTwo = createCombatant({ id: "pc-2", sideId: "players", actor });
    const defeated = createCombatant({
        id: "pc-3",
        sideId: "players",
        defeated: true,
        actor: {
            id: "actor-2",
            system: {
                attributes: {
                    reaction: {
                        used: true,
                        value: true
                    }
                }
            },
            updates: [],
            async update(data) {
                this.updates.push(data);
                return this;
            }
        }
    });

    const combat = {
        started: true,
        combatants: [sharedOne, sharedTwo, defeated],
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: "players",
                    order: ["players"],
                    sides: {
                        players: { id: "players", combatantIds: ["pc-1", "pc-2", "pc-3"] }
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

        assert.equal(actor.updates.length, 1);
        assert.equal(defeated.actor.updates.length, 0);
    } finally {
        env.restore();
    }
});
