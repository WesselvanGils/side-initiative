import test from "node:test";
import assert from "node:assert/strict";
import { addCombatantContextOptions } from "../scripts/ui/tracker.mjs";

function createCombatant({ id, sideId, name = id }) {
    const flags = new Map();
    flags.set("side-initiative:sideId", sideId);
    return {
        id,
        name,
        getFlag(scope, key) {
            return flags.get(`${scope}:${key}`) ?? null;
        }
    };
}

test("combat tracker context menu can assign a commander for a side", async () => {
    const original = globalThis.game;
    const commanderMap = new Map([["players", "pc-1"]]);
    const playerOne = createCombatant({ id: "pc-1", sideId: "players" });
    const playerTwo = createCombatant({ id: "pc-2", sideId: "players" });
    const combat = {
        combatants: new Map([
            ["pc-1", playerOne],
            ["pc-2", playerTwo]
        ])
    };
    const app = {
        viewed: combat,
        renderCalls: 0,
        render() {
            this.renderCalls += 1;
        }
    };
    const menuItems = [{ name: "update" }, { name: "remove" }];

    globalThis.game = {
        user: { isGM: false },
        combat,
        sideInitiative: {
            canUserSetCommander(combatant) {
                return combatant.id === "pc-2";
            },
            getSideCommander(_combat, sideId) {
                return commanderMap.get(sideId) ?? null;
            },
            setSideCommander(_combat, combatant) {
                commanderMap.set("players", combatant.id);
                return Promise.resolve(combatant);
            }
        }
    };

    try {
        addCombatantContextOptions(app, menuItems);

        assert.equal(menuItems.length, 3);
        assert.equal(menuItems[1].name, "SIDE-INITIATIVE.UI.MakeCommander");
        assert.equal(menuItems[1].condition({ dataset: { combatantId: "pc-1" } }), false);
        assert.equal(menuItems[1].condition({ dataset: { combatantId: "pc-2" } }), true);

        await menuItems[1].callback({ dataset: { combatantId: "pc-2" } });

        assert.equal(commanderMap.get("players"), "pc-2");
        assert.equal(app.renderCalls, 1);
    } finally {
        globalThis.game = original;
    }
});
