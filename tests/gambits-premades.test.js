import test from "node:test";
import assert from "node:assert/strict";
import {
    getGambitsPremadesIntegrationState,
    getGambitsPremadesVersion,
    isSupportedGambitsPremadesVersion,
    registerGambitsPremadesIntegration,
    resetGambitsPremadesIntegrationState,
    validateGambitsOpportunityAttackSource
} from "../scripts/integration/gambits-premades.mjs";

function createOriginalOpportunityAttackScenarios() {
    return async function opportunityAttackScenarios({ tokenUuid, regionUuid, regionScenario }) {
        const token = await fromUuid(tokenUuid);
        const region = await fromUuid(regionUuid);
        if (!token || !region || !regionScenario) return null;

        if (regionScenario === "onTurnStart") {
            let behaviors = region.behaviors.filter(b => b.name === "onExit" || b.name === "onEnter");
            for (let behavior of behaviors) {
                await behavior.update({"disabled": true});
            }
            return "disabled";
        }

        if (regionScenario === "onTurnEnd") {
            let behaviors = region.behaviors.filter(b => b.name === "onExit" || b.name === "onEnter");
            for (let behavior of behaviors) {
                await behavior.update({"disabled": false});
            }
            return "enabled";
        }

        let currentCombatant = canvas.tokens.get(game.combat?.current.tokenId);
        if (currentCombatant?.id !== token.object.id) {
            if (game.settings.get("gambits-premades", "debugEnabled")) {
                game.gps.logInfo("Opportunity Attack for test failed due to not tokens turn in combat");
            }
            return "blocked";
        }

        return "allowed";
    };
}

function createHooks() {
    const registry = new Map();
    return {
        on(name, handler) {
            if (!registry.has(name)) registry.set(name, []);
            registry.get(name).push(handler);
        },
        once(name, handler) {
            if (!registry.has(name)) registry.set(name, []);
            registry.get(name).push(handler);
        },
        get(name) {
            return registry.get(name) ?? [];
        }
    };
}

function installGlobals({
    version = "2.1.42",
    active = true,
    supportedBySide = new Set(["active-commander", "active-member"]),
    currentTokenId = "current-token"
} = {}) {
    const original = {
        game: globalThis.game,
        ui: globalThis.ui,
        Hooks: globalThis.Hooks,
        canvas: globalThis.canvas,
        fromUuid: globalThis.fromUuid
    };

    const warnings = [];
    const turnEvents = [];
    const tokens = new Map();
    const scene = { id: "scene-1", regions: new Map() };
    const combatants = [];

    function createToken(id) {
        const token = {
            id,
            uuid: id,
            object: { id },
            parent: scene,
            scene,
            testInsideRegion(region) {
                return region.tokenIds.has(id);
            }
        };
        tokens.set(id, token);
        return token;
    }

    createToken("current-token");
    createToken("active-commander");
    createToken("active-member");
    createToken("offside-token");

    function createCombatant(id, sideId, tokenId) {
        const combatant = {
            id,
            actor: { id: `${id}-actor` },
            token: tokens.get(tokenId),
            getFlag(scope, key) {
                if (scope === "side-initiative" && key === "sideId") return sideId;
                return null;
            }
        };
        combatants.push(combatant);
        return combatant;
    }

    createCombatant("combatant-commander", "players", "active-commander");
    createCombatant("combatant-member", "players", "active-member");
    createCombatant("combatant-offside", "monsters", "offside-token");

    const region = {
        id: "region-1",
        uuid: "region-1",
        tokenIds: new Set(["active-commander", "active-member"]),
        flags: {
            "gambits-premades": {
                actorUuid: "active-commander",
                tokenUuid: "active-commander"
            }
        },
        behaviors: [
            {
                name: "onExit",
                update(data) {
                    return Promise.resolve(data);
                }
            },
            {
                name: "onEnter",
                update(data) {
                    return Promise.resolve(data);
                }
            }
        ],
        async _triggerEvent(eventName, payload) {
            turnEvents.push({
                eventName,
                regionId: this.id,
                tokenId: payload?.token?.id ?? payload?.data?.token?.id ?? null
            });
        },
        getFlag(scope, key) {
            if (scope === "gambits-premades" && key === "regionDisabled") return false;
            return null;
        }
    };
    scene.regions.set(region.id, region);

    globalThis.game = {
        user: { isGM: true, id: "gm-1" },
        users: {
            activeGM: { id: "gm-1", isGM: true, active: true }
        },
        combat: { current: { tokenId: currentTokenId }, started: true, combatants },
        modules: {
            get(moduleId) {
                if (moduleId === "gambits-premades") {
                    return active ? { active: true, version, data: { version } } : { active: false, version, data: { version } };
                }
                return null;
            }
        },
        settings: {
            get(namespace, key) {
                return namespace === "gambits-premades" && key === "Enable Opportunity Attack";
            }
        },
        sideInitiative: {
            isTokenOnActiveSide(token) {
                return supportedBySide.has(token?.object?.id ?? token?.id);
            }
        },
        gps: {
            opportunityAttackScenarios: createOriginalOpportunityAttackScenarios(),
            logInfo() {}
        },
        i18n: {
            localize(key) {
                return key;
            },
            format(key, data) {
                return `${key} ${JSON.stringify(data)}`;
            }
        }
    };
    globalThis.ui = {
        notifications: {
            warn(message) {
                warnings.push(message);
            }
        }
    };
    globalThis.canvas = {
        scene,
        tokens: {
            get(id) {
                return tokens.get(id) ?? null;
            }
        }
    };
    globalThis.fromUuid = async (uuid) => tokens.get(uuid) ?? scene.regions.get(uuid) ?? null;
    globalThis.Hooks = createHooks();

    return {
        Hooks: globalThis.Hooks,
        warnings,
        turnEvents,
        region,
        tokens,
        restore() {
            globalThis.game = original.game;
            globalThis.ui = original.ui;
            globalThis.Hooks = original.Hooks;
            globalThis.canvas = original.canvas;
            globalThis.fromUuid = original.fromUuid;
            resetGambitsPremadesIntegrationState();
        }
    };
}

test("Gambits helpers recognize the supported versions and source shape", () => {
    const env = installGlobals();
    try {
        assert.equal(getGambitsPremadesVersion(), "2.1.42");
        assert.equal(isSupportedGambitsPremadesVersion("2.1.42"), true);
        assert.equal(isSupportedGambitsPremadesVersion("2.1.43"), true);
        assert.equal(validateGambitsOpportunityAttackSource(game.gps.opportunityAttackScenarios), true);
    } finally {
        env.restore();
    }
});

test("Gambits integration patches the active-side bypass and preserves the original guard otherwise", async () => {
    const env = installGlobals();
    try {
        const original = game.gps.opportunityAttackScenarios;
        registerGambitsPremadesIntegration();

        assert.equal(getGambitsPremadesIntegrationState().status, "patched");
        assert.notEqual(game.gps.opportunityAttackScenarios, original);

        const activeSideResult = await game.gps.opportunityAttackScenarios({
            tokenUuid: "active-commander",
            regionUuid: "region-1",
            regionScenario: "onExit"
        });
        const offSideResult = await game.gps.opportunityAttackScenarios({
            tokenUuid: "offside-token",
            regionUuid: "region-1",
            regionScenario: "onExit"
        });

        assert.equal(activeSideResult, "allowed");
        assert.equal(offSideResult, "blocked");
        assert.equal(canvas.tokens.get("current-token").id, "current-token");
        assert.equal(env.warnings.length, 0);

        const patched = game.gps.opportunityAttackScenarios;
        registerGambitsPremadesIntegration();
        assert.equal(game.gps.opportunityAttackScenarios, patched);
    } finally {
        env.restore();
    }
});

test("Gambits integration bridges side turn hooks to every token on the side", async () => {
    const env = installGlobals();
    try {
        registerGambitsPremadesIntegration();

        const [sideTurnEnd] = globalThis.Hooks.get("side-initiative.sideTurnEnd");
        const [sideTurnStart] = globalThis.Hooks.get("side-initiative.sideTurnStart");

        await sideTurnEnd({ combat: game.combat, sideId: "players" });
        await sideTurnStart({ combat: game.combat, sideId: "players" });

        assert.deepEqual(env.turnEvents, [
            { eventName: "tokenTurnEnd", regionId: "region-1", tokenId: "active-commander" },
            { eventName: "tokenTurnEnd", regionId: "region-1", tokenId: "active-member" },
            { eventName: "tokenTurnStart", regionId: "region-1", tokenId: "active-commander" },
            { eventName: "tokenTurnStart", regionId: "region-1", tokenId: "active-member" }
        ]);
    } finally {
        env.restore();
    }
});

test("Gambits integration disables itself on unsupported versions", () => {
    const env = installGlobals({ version: "2.1.44" });
    try {
        const original = game.gps.opportunityAttackScenarios;
        registerGambitsPremadesIntegration();

        const state = getGambitsPremadesIntegrationState();
        assert.equal(state.status, "unsupported");
        assert.equal(game.gps.opportunityAttackScenarios, original);
        assert.equal(env.warnings.length, 1);
        assert.match(env.warnings[0], /2\.1\.42 or 2\.1\.43/);
    } finally {
        env.restore();
    }
});

test("Gambits integration disables itself when the source shape changes", () => {
    const env = installGlobals();
    try {
        game.gps.opportunityAttackScenarios = async function changedScenario() {
            return "changed";
        };

        registerGambitsPremadesIntegration();

        const state = getGambitsPremadesIntegrationState();
        assert.equal(state.status, "unsupported");
        assert.equal(env.warnings.length, 1);
        assert.match(env.warnings[0], /source/i);
    } finally {
        env.restore();
    }
});
