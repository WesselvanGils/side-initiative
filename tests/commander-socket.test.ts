import test from "node:test";
import assert from "node:assert/strict";
import { handleCommanderSocketRequest, SideInitiativeAPI } from "../src/api.js";

function createCombatant({ id, sideId, hasPlayerOwner = true, ownerIds = ["user-1"] }) {
    const flags = new Map();
    flags.set("side-initiative:sideId", sideId);
    return {
        id,
        name: id,
        hasPlayerOwner,
        isOwner: ownerIds.includes("user-1"),
        testUserPermission(user, permission) {
            return permission === "OWNER" && (user?.isGM || ownerIds.includes(user?.id));
        },
        getFlag(scope, key) {
            return flags.get(`${scope}:${key}`) ?? null;
        },
        setFlag(scope, key, value) {
            flags.set(`${scope}:${key}`, value);
            return Promise.resolve(value);
        }
    };
}

function createCombat(combatants, state = null) {
    let combatState = state;
    return {
        id: "combat-1",
        round: 1,
        turn: 0,
        started: true,
        combatants: new Map(combatants.map((combatant) => [combatant.id, combatant])),
        update(data) {
            if (typeof data.round === "number") this.round = data.round;
            if (typeof data.turn === "number") this.turn = data.turn;
            return Promise.resolve(this);
        },
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") return combatState;
            return null;
        },
        setFlag(scope, key, value) {
            if (scope === "side-initiative" && key === "state") {
                combatState = value;
            }
            return Promise.resolve(value);
        }
    };
}

test("handleCommanderSocketRequest applies commander changes for the active GM", async () => {
    const combatant = createCombatant({ id: "pc-1", sideId: "players" });
    const combat = createCombat([combatant], {
        activeSideId: "players",
        order: ["players"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] }
        },
        commanderIds: {}
    });
    const requester = { id: "user-1", isGM: false };
    const activeGM = { id: "gm-1", isGM: true, active: true };
    const original = {
        game: globalThis.game
    };

    globalThis.game = {
        user: activeGM,
        users: {
            activeGM,
            get(id) {
                if (id === requester.id) return requester;
                if (id === activeGM.id) return activeGM;
                return null;
            },
            contents: [requester, activeGM]
        },
        combats: {
            get(id) {
                return id === combat.id ? combat : null;
            }
        },
        i18n: {
            localize(key) {
                return key;
            }
        },
        settings: {
            get() {
                return "side-owners";
            }
        },
        sideInitiative: SideInitiativeAPI
    };

    try {
        const result = await handleCommanderSocketRequest({
            module: "side-initiative",
            action: "setCommander",
            combatId: combat.id,
            combatantId: combatant.id,
            userId: requester.id
        }, requester.id);

        assert.ok(result);
        assert.equal(SideInitiativeAPI.getSideCommander(combat, "players")?.id, "pc-1");
    } finally {
        globalThis.game = original.game;
    }
});

test("handleCommanderSocketRequest ignores unauthorized commander requests", async () => {
    const combatant = createCombatant({ id: "pc-1", sideId: "players", ownerIds: [] });
    const combat = createCombat([combatant], {
        activeSideId: "players",
        order: ["players"],
        sides: {
            players: { id: "players", combatantIds: ["pc-1"] }
        },
        commanderIds: {}
    });
    const requester = { id: "user-2", isGM: false };
    const activeGM = { id: "gm-1", isGM: true, active: true };
    const original = {
        game: globalThis.game
    };

    globalThis.game = {
        user: activeGM,
        users: {
            activeGM,
            get(id) {
                if (id === requester.id) return requester;
                if (id === activeGM.id) return activeGM;
                return null;
            },
            contents: [requester, activeGM]
        },
        combats: {
            get(id) {
                return id === combat.id ? combat : null;
            }
        },
        i18n: {
            localize(key) {
                return key;
            }
        },
        settings: {
            get() {
                return "side-owners";
            }
        },
        sideInitiative: SideInitiativeAPI
    };

    try {
        const result = await handleCommanderSocketRequest({
            module: "side-initiative",
            action: "setCommander",
            combatId: combat.id,
            combatantId: combatant.id,
            userId: requester.id
        }, requester.id);

        assert.equal(result, null);
        assert.equal(SideInitiativeAPI.getSideCommander(combat, "players"), null);
    } finally {
        globalThis.game = original.game;
    }
});
