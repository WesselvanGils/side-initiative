import test from "node:test";
import assert from "node:assert/strict";
import { registerDnd5eIntegration } from "../src/integration/dnd5e.js";

interface ActorState {
    id: string;
    uuid: string;
    legactValue?: number;
    legactMax?: number;
}

function createLegendaryActor({ id, legactValue, legactMax }: ActorState) {
    const updates: Array<{ actorUuid: string; data: Record<string, unknown> }> = [];
    const actor: any = {
        id,
        uuid: `${id}-uuid`,
        name: id,
        get updates() {
            return updates;
        },
        system: {
            resources:
                legactMax == null
                    ? {}
                    : { legact: { value: legactValue ?? legactMax, max: legactMax } }
        },
        async update(data: Record<string, unknown>) {
            updates.push({ actorUuid: this.uuid, data });
        }
    };
    return { actor, updates };
}

function createCombatant({ id, sideId, actor, defeated = false }: { id: string; sideId: string; actor: any; defeated?: boolean }) {
    return {
        id,
        defeated,
        actor,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "sideId") return sideId;
            return null;
        }
    };
}

function createCombat(combatants: any[], activeSideId: string) {
    return {
        id: "combat-1",
        round: 1,
        started: true,
        combatants,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId,
                    order: ["players", "monsters"],
                    sides: {},
                    commanderIds: {}
                };
            }
            return null;
        }
    };
}

function createHooks() {
    const registry = new Map<string, Array<(...args: unknown[]) => unknown>>();
    return {
        on(name: string, handler: (...args: unknown[]) => unknown) {
            (registry.get(name) ?? registry.set(name, []).get(name)!).push(handler);
        },
        once() { /* not used */ },
        get(name: string) {
            return registry.get(name) ?? [];
        }
    };
}

function installGlobals({ combat, primaryGM = true }: { combat: any; primaryGM?: boolean }) {
    const original = {
        game: globalThis.game,
        Hooks: globalThis.Hooks
    };

    const hooks = createHooks();
    globalThis.Hooks = hooks as unknown as typeof Hooks;
    globalThis.game = {
        combat,
        user: { id: primaryGM ? "gm-1" : "other", isGM: true },
        users: { activeGM: { id: "gm-1", isGM: true, active: true }, contents: [{ id: "gm-1", isGM: true, active: true }] }
    } as never;

    return {
        hooks,
        restore() {
            globalThis.game = original.game;
            globalThis.Hooks = original.Hooks;
        }
    };
}

test("legendary actions are recovered for every combatant on the active side at sideTurnStart", async () => {
    const depleted = createLegendaryActor({ id: "aboleth", legactValue: 0, legactMax: 3 });
    const alsoDepleted = createLegendaryActor({ id: "dragon", legactValue: 1, legactMax: 3 });
    const combat = createCombat(
        [
            createCombatant({ id: "npc-1", sideId: "monsters", actor: depleted.actor }),
            createCombatant({ id: "npc-2", sideId: "monsters", actor: alsoDepleted.actor })
        ],
        "monsters"
    );

    const env = installGlobals({ combat });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        assert.deepEqual(depleted.updates, [{ actorUuid: "aboleth-uuid", data: { "system.resources.legact.value": 3 } }]);
        assert.deepEqual(alsoDepleted.updates, [{ actorUuid: "dragon-uuid", data: { "system.resources.legact.value": 3 } }]);
    } finally {
        env.restore();
    }
});

test("combatants on other sides are not recovered", async () => {
    const monster = createLegendaryActor({ id: "aboleth", legactValue: 0, legactMax: 3 });
    const combat = createCombat(
        [createCombatant({ id: "npc-1", sideId: "monsters", actor: monster.actor })],
        "players"
    );

    const env = installGlobals({ combat });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "players" });

        assert.deepEqual(monster.updates, []);
    } finally {
        env.restore();
    }
});

test("defeated combatants are skipped", async () => {
    const defeated = createLegendaryActor({ id: "aboleth", legactValue: 0, legactMax: 3 });
    const combat = createCombat(
        [createCombatant({ id: "npc-1", sideId: "monsters", actor: defeated.actor, defeated: true })],
        "monsters"
    );

    const env = installGlobals({ combat });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        assert.deepEqual(defeated.updates, []);
    } finally {
        env.restore();
    }
});

test("combatants already at max and combatants without legendary actions are left alone", async () => {
    const full = createLegendaryActor({ id: "aboleth", legactValue: 3, legactMax: 3 });
    const player = createLegendaryActor({ id: "fighter" }); // no legact
    const combat = createCombat(
        [
            createCombatant({ id: "npc-1", sideId: "monsters", actor: full.actor }),
            createCombatant({ id: "pc-1", sideId: "monsters", actor: player.actor })
        ],
        "monsters"
    );

    const env = installGlobals({ combat });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        assert.deepEqual(full.updates, []);
        assert.deepEqual(player.updates, []);
    } finally {
        env.restore();
    }
});

test("recovery only runs on the primary GM client", async () => {
    const depleted = createLegendaryActor({ id: "aboleth", legactValue: 0, legactMax: 3 });
    const combat = createCombat(
        [createCombatant({ id: "npc-1", sideId: "monsters", actor: depleted.actor })],
        "monsters"
    );

    const env = installGlobals({ combat, primaryGM: false });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        assert.deepEqual(depleted.updates, []);
    } finally {
        env.restore();
    }
});

test("nothing happens before combat has started", async () => {
    const depleted = createLegendaryActor({ id: "aboleth", legactValue: 0, legactMax: 3 });
    const combat = createCombat(
        [createCombatant({ id: "npc-1", sideId: "monsters", actor: depleted.actor })],
        "monsters"
    );
    combat.started = false;

    const env = installGlobals({ combat });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        assert.deepEqual(depleted.updates, []);
    } finally {
        env.restore();
    }
});
