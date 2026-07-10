import test from "node:test";
import assert from "node:assert/strict";
import { INITIATIVE_METHOD_OPTIONS } from "../src/constants.js";

async function loadModuleUnderTest(game) {
    const original = {
        Hooks: globalThis.Hooks,
        game: globalThis.game,
    };

    globalThis.Hooks = {
        once() {},
        on() {},
    };
    globalThis.game = game;

    const module = await import("../src/module.js");
    return {
        module,
        restore() {
            globalThis.Hooks = original.Hooks;
            globalThis.game = original.game;
        },
    };
}

test("handleCombatStartedUpdate rolls weighted initiative when enabled", async () => {
    const calls = [];
    const { module, restore } = await loadModuleUnderTest({
        users: {
            activeGM: { id: "gm-1", isGM: true, active: true },
            get() {
                return null;
            },
            contents: [],
        },
        user: { id: "gm-1", isGM: true },
        settings: {
            get(namespace, key) {
                if (namespace === "side-initiative" && key === "initiativeMethod") {
                    return INITIATIVE_METHOD_OPTIONS.weightedAverage;
                }
                return null;
            },
        },
        sideInitiative: {
            refreshCombatantSides: async (combat) => {
                calls.push(["refresh", combat.id]);
            },
            getSideState: () => ({ lastRolledRound: null }),
            rollWeightedSideInitiative: async (combat, options) => {
                calls.push(["weighted", combat.id, options]);
                return { id: combat.id };
            },
        },
    });

    try {
        await module.handleCombatStartedUpdate({ id: "combat-1", round: 1 }, { started: true });
        assert.deepEqual(calls, [
            ["refresh", "combat-1"],
            ["weighted", "combat-1", { refresh: false }],
        ]);
    } finally {
        restore();
    }
});

test("handleCombatStartedUpdate skips weighted rolling when the mode is side d20", async () => {
    const calls = [];
    const { module, restore } = await loadModuleUnderTest({
        users: {
            activeGM: { id: "gm-1", isGM: true, active: true },
            get() {
                return null;
            },
            contents: [],
        },
        user: { id: "gm-1", isGM: true },
        settings: {
            get(namespace, key) {
                if (namespace === "side-initiative" && key === "initiativeMethod") {
                    return INITIATIVE_METHOD_OPTIONS.sideD20;
                }
                return null;
            },
        },
        sideInitiative: {
            refreshCombatantSides: async (combat) => {
                calls.push(["refresh", combat.id]);
            },
            getSideState: () => ({ lastRolledRound: null }),
            rollWeightedSideInitiative: async (combat, options) => {
                calls.push(["weighted", combat.id, options]);
                return { id: combat.id };
            },
        },
    });

    try {
        await module.handleCombatStartedUpdate({ id: "combat-2", round: 1 }, { started: true });
        assert.deepEqual(calls, [["refresh", "combat-2"]]);
    } finally {
        restore();
    }
});
