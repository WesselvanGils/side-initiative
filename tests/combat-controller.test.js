import test from "node:test";
import assert from "node:assert/strict";
import { SideInitiativeAPI } from "../scripts/api.mjs";
import { installCombatPatches } from "../scripts/combat-controller.mjs";

test("side combat turn controls are gated by commander permissions", async () => {
    const original = {
        CONFIG: globalThis.CONFIG,
        game: globalThis.game
    };

    class Combat {
        constructor(state) {
            this.state = state;
            this.round = 1;
        }

        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") return this.state;
            return null;
        }

        update() {
            return Promise.resolve(this);
        }
    }

    globalThis.CONFIG = { Combat: { documentClass: Combat } };
    globalThis.game = {
        user: { id: "user-1", isGM: false },
        combat: null,
        settings: {
            get() {
                return "side-owners";
            }
        },
        sideInitiative: SideInitiativeAPI
    };

    const originalAdvanceSide = SideInitiativeAPI.advanceSide;
    const originalCanUserAdvanceSide = SideInitiativeAPI.canUserAdvanceSide;
    let advanceCalls = 0;

    SideInitiativeAPI.advanceSide = async () => {
        advanceCalls += 1;
        return "advanced";
    };

    try {
        installCombatPatches();

        const combat = new Combat({
            activeSideId: "players",
            order: ["players", "monsters"],
            sides: {
                players: { id: "players", combatantIds: ["pc-1"] },
                monsters: { id: "monsters", combatantIds: ["npc-1"] }
            }
        });

        SideInitiativeAPI.canUserAdvanceSide = () => false;
        const blocked = await combat.nextTurn();
        assert.equal(blocked, combat);
        assert.equal(advanceCalls, 0);

        SideInitiativeAPI.canUserAdvanceSide = () => true;
        const advanced = await combat.nextTurn();
        assert.equal(advanced, "advanced");
        assert.equal(advanceCalls, 1);
    } finally {
        SideInitiativeAPI.advanceSide = originalAdvanceSide;
        SideInitiativeAPI.canUserAdvanceSide = originalCanUserAdvanceSide;
        globalThis.CONFIG = original.CONFIG;
        globalThis.game = original.game;
    }
});
