import test from "node:test";
import assert from "node:assert/strict";
import { SideInitiativeAPI } from "../src/api.js";
import { installCombatPatches } from "../src/controller/combat-controller.js";

type TestCombatState = Record<string, unknown>;

const testGlobal = globalThis as unknown as { CONFIG: unknown; game: unknown };

test("side combat turn methods route to the side initiative API based on advance permissions", async () => {
    const original = {
        CONFIG: testGlobal.CONFIG,
        game: testGlobal.game,
    };

    class Combat {
        state: TestCombatState;
        round = 1;
        declare nextTurn: () => Promise<unknown>;
        constructor(state: TestCombatState) {
            this.state = state;
        }

        getFlag(scope: string, key: string): unknown {
            if (scope === "side-initiative" && key === "state") return this.state;
            return null;
        }

        update(): Promise<this> {
            return Promise.resolve(this);
        }
    }

    testGlobal.CONFIG = { Combat: { documentClass: Combat } };
    testGlobal.game = {
        user: { id: "user-1", isGM: false },
        combat: null,
        settings: {
            get() {
                return "side-owners";
            },
        },
        sideInitiative: SideInitiativeAPI,
    };

    const originalRequestAdvanceSide = SideInitiativeAPI.requestAdvanceSide;
    const originalCanUserAdvanceSide = SideInitiativeAPI.canUserAdvanceSide;
    let requestCalls = 0;

    SideInitiativeAPI.requestAdvanceSide = async () => {
        requestCalls += 1;
        return true;
    };

    try {
        installCombatPatches();

        const combat = new Combat({
            activeSideId: "players",
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1"] },
                monsters: { id: "monsters", combatantIds: ["npc-1"] },
            },
        });

        SideInitiativeAPI.canUserAdvanceSide = () => false;
        SideInitiativeAPI.canUserAdvanceSide = () => false;
        const blocked = await combat.nextTurn();
        assert.equal(blocked, combat);
        assert.equal(requestCalls, 0);

        SideInitiativeAPI.canUserAdvanceSide = () => true;
        const advanced = await combat.nextTurn();
        assert.equal(advanced, combat);
        assert.equal(requestCalls, 1);
    } finally {
        SideInitiativeAPI.requestAdvanceSide = originalRequestAdvanceSide;
        SideInitiativeAPI.canUserAdvanceSide = originalCanUserAdvanceSide;
        testGlobal.CONFIG = original.CONFIG;
        testGlobal.game = original.game;
    }
});
