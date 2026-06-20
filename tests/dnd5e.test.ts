import test from "node:test";
import assert from "node:assert/strict";
import {
    getLegendaryCombatantsToRecover,
    registerDnd5eIntegration,
    shouldSuppressNativeRecovery
} from "../src/integration/dnd5e.js";

interface ActorOptions {
    id: string;
    legactValue?: number;
    legactMax?: number;
}

function createActor({ id, legactValue, legactMax }: ActorOptions): any {
    return {
        id,
        uuid: `${id}-uuid`,
        name: id,
        system: {
            resources:
                legactMax == null
                    ? {}
                    : { legact: { value: legactValue ?? legactMax, max: legactMax } }
        }
    };
}

function createCombatant({
    id,
    sideId,
    actor,
    defeated = false,
    recoverCombatUses
}: {
    id: string;
    sideId: string;
    actor: any;
    defeated?: boolean;
    recoverCombatUses?: (periods: string[]) => Promise<void>;
}): any {
    return {
        id,
        defeated,
        actor,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "sideId") return sideId;
            return null;
        },
        recoverCombatUses
    };
}

function createCombat(combatants: any[], activeSideId: string, started = true): any {
    return {
        id: "combat-1",
        round: 1,
        started,
        combatants,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "state") {
                return { activeSideId, order: [activeSideId], sides: {}, commanderIds: {} };
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

function installGlobals({ combat, primaryGM = true }: { combat?: any; primaryGM?: boolean } = {}) {
    const original = { game: globalThis.game, Hooks: globalThis.Hooks };
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

/* ------------------------------------------------------------------ */
/* getLegendaryCombatantsToRecover                                     */
/* ------------------------------------------------------------------ */

test("getLegendaryCombatantsToRecover returns only depleted legendary creatures on the side", () => {
    const combat = createCombat(
        [
            createCombatant({ id: "npc-depleted", sideId: "monsters", actor: createActor({ id: "a", legactValue: 0, legactMax: 3 }) }),
            createCombatant({ id: "npc-full", sideId: "monsters", actor: createActor({ id: "b", legactValue: 3, legactMax: 3 }) }),
            createCombatant({ id: "npc-none", sideId: "monsters", actor: createActor({ id: "c" }) }),
            createCombatant({ id: "npc-defeated", sideId: "monsters", actor: createActor({ id: "d", legactValue: 0, legactMax: 3 }), defeated: true }),
            createCombatant({ id: "npc-otherside", sideId: "players", actor: createActor({ id: "e", legactValue: 0, legactMax: 3 }) })
        ],
        "monsters"
    );

    const result = getLegendaryCombatantsToRecover(combat, "monsters").map((c) => c.id);
    assert.deepEqual(result, ["npc-depleted"]);
});

test("getLegendaryCombatantsToRecover is empty before combat starts", () => {
    const combat = createCombat(
        [createCombatant({ id: "npc-1", sideId: "monsters", actor: createActor({ id: "a", legactValue: 0, legactMax: 3 }) })],
        "monsters",
        false
    );
    assert.equal(getLegendaryCombatantsToRecover(combat, "monsters").length, 0);
});

/* ------------------------------------------------------------------ */
/* shouldSuppressNativeRecovery                                        */
/* ------------------------------------------------------------------ */

test("shouldSuppressNativeRecovery suppresses end-of-turn recovery for side combats", () => {
    const sideCombat = createCombat([], "monsters");
    const combatant = { combat: sideCombat };
    assert.equal(shouldSuppressNativeRecovery(combatant as never, ["turnEnd"], false), true);
});

test("shouldSuppressNativeRecovery does not suppress our own guarded recovery", () => {
    const sideCombat = createCombat([], "monsters");
    const combatant = { combat: sideCombat };
    assert.equal(shouldSuppressNativeRecovery(combatant as never, ["turnEnd"], true), false);
});

test("shouldSuppressNativeRecovery leaves non-side combats and non-turnEnd periods alone", () => {
    const sideCombat = createCombat([], "monsters");
    const nonSideCombat: any = { getFlag: () => null };
    assert.equal(shouldSuppressNativeRecovery({ combat: nonSideCombat } as never, ["turnEnd"], false), false);
    assert.equal(shouldSuppressNativeRecovery({ combat: sideCombat } as never, ["encounter"], false), false);
    assert.equal(shouldSuppressNativeRecovery({ combat: sideCombat } as never, ["turnStart"], false), false);
});

/* ------------------------------------------------------------------ */
/* Integration: sideTurnStart drives recovery, preCombatRecovery gates  */
/* ------------------------------------------------------------------ */

test("sideTurnStart calls dnd5e's recoverCombatUses for depleted legendary creatures", async () => {
    const recoverCalls: Array<{ id: string; periods: string[] }> = [];
    const combat = createCombat(
        [
            createCombatant({
                id: "npc-1",
                sideId: "monsters",
                actor: createActor({ id: "aboleth", legactValue: 0, legactMax: 3 }),
                recoverCombatUses: async (periods) => { recoverCalls.push({ id: "npc-1", periods }); }
            }),
            createCombatant({
                id: "npc-2",
                sideId: "monsters",
                actor: createActor({ id: "dragon", legactValue: 3, legactMax: 3 }),
                recoverCombatUses: async (periods) => { recoverCalls.push({ id: "npc-2", periods }); }
            })
        ],
        "monsters"
    );

    const env = installGlobals({ combat });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });

        // Only the depleted legendary creature is recovered; full creature is skipped.
        assert.deepEqual(recoverCalls, [{ id: "npc-1", periods: ["turnEnd"] }]);
    } finally {
        env.restore();
    }
});

test("sideTurnStart does nothing on a non-primary-GM client", async () => {
    const recoverCalls: string[] = [];
    const combat = createCombat(
        [
            createCombatant({
                id: "npc-1",
                sideId: "monsters",
                actor: createActor({ id: "aboleth", legactValue: 0, legactMax: 3 }),
                recoverCombatUses: async () => { recoverCalls.push("npc-1"); }
            })
        ],
        "monsters"
    );

    const env = installGlobals({ combat, primaryGM: false });
    try {
        registerDnd5eIntegration();
        const [sideTurnStart] = env.hooks.get("side-initiative.sideTurnStart");
        await sideTurnStart({ combat, sideId: "monsters" });
        assert.deepEqual(recoverCalls, []);
    } finally {
        env.restore();
    }
});

test("preCombatRecovery handler blocks native end-of-turn recovery for side combats", () => {
    const sideCombat = createCombat([], "monsters");
    const env = installGlobals({ combat: sideCombat });
    try {
        registerDnd5eIntegration();
        const [preCombatRecovery] = env.hooks.get("dnd5e.preCombatRecovery");

        assert.equal(preCombatRecovery({ combat: sideCombat }, ["turnEnd"]), false);
        // Encounter-start and start-of-turn periods are left to dnd5e.
        assert.notEqual(preCombatRecovery({ combat: sideCombat }, ["encounter"]), false);
        assert.notEqual(preCombatRecovery({ combat: sideCombat }, ["turnStart"]), false);
    } finally {
        env.restore();
    }
});

test("preCombatRecovery handler leaves non-side combats alone", () => {
    const nonSideCombat: any = { id: "c", started: true, combatants: [], getFlag: () => null };
    const env = installGlobals({ combat: nonSideCombat });
    try {
        registerDnd5eIntegration();
        const [preCombatRecovery] = env.hooks.get("dnd5e.preCombatRecovery");
        assert.notEqual(preCombatRecovery({ combat: nonSideCombat }, ["turnEnd"]), false);
    } finally {
        env.restore();
    }
});
