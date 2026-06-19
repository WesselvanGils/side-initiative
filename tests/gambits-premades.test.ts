import test from "node:test";
import assert from "node:assert/strict";
import {
    getGambitsPremadesIntegrationState,
    getGambitsPremadesVersion,
    isSupportedGambitsPremadesVersion,
    registerGambitsPremadesIntegration,
    resetGambitsPremadesIntegrationState,
    validateGambitsOpportunityAttackSource
} from "../src/integration/gambits-premades.js";

function createOriginalOpportunityAttackScenarios() {
    return async function opportunityAttackScenarios({ tokenUuid, regionUuid, regionScenario }) {
        const token = await fromUuid(tokenUuid);
        const region = await fromUuid(regionUuid);
        if (!token || !region || !regionScenario) return null;

        if (regionScenario === "onTurnStart") {
            let behaviors = region.behaviors.filter(b => b.name === "onExit" || b.name === "onEnter");
            for (let behavior of behaviors) {
                await behavior.update({ "disabled": true });
            }
            return "disabled";
        }

        if (regionScenario === "onTurnEnd") {
            let behaviors = region.behaviors.filter(b => b.name === "onExit" || b.name === "onEnter");
            for (let behavior of behaviors) {
                await behavior.update({ "disabled": false });
            }
            return "enabled";
        }

        const currentCombatant = canvas.tokens.get(game.combat?.current.tokenId);
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
    version = "2.1.43",
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
    const behaviorUpdates = [];
    const gpsCalls = [];
    const tokens = new Map();
    const actors = new Map();
    const regions = new Map();
    const scene = { id: "scene-1", regions };
    const combatants = [];

    function createActor(id) {
        const actor = {
            id,
            uuid: `${id}-uuid`,
            type: "npc",
            name: id
        };
        actors.set(actor.uuid, actor);
        return actor;
    }

    function createToken(id) {
        const actor = createActor(`${id}-actor`);
        const token = {
            id,
            uuid: `${id}-uuid`,
            object: { id },
            parent: scene,
            scene,
            x: 100,
            y: 100,
            width: 1,
            height: 1,
            elevation: 0,
            actor,
            testInsideRegion(region) {
                return region.tokenIds.has(id);
            }
        };
        tokens.set(token.uuid, token);
        return token;
    }

    const currentToken = createToken("current-token");
    const activeCommander = createToken("active-commander");
    const activeMember = createToken("active-member");
    const offsideToken = createToken("offside-token");

    function createCombatant(id, sideId, token) {
        const combatant = {
            id,
            actor: token.actor,
            token,
            getFlag(scope, key) {
                if (scope === "side-initiative" && key === "sideId") return sideId;
                return null;
            }
        };
        combatants.push(combatant);
        return combatant;
    }

    createCombatant("combatant-commander", "players", activeCommander);
    createCombatant("combatant-member", "players", activeMember);
    createCombatant("combatant-offside", "monsters", offsideToken);

    const turnStartSource = `if (game.user.id !== game.gps.getPrimaryGM()) return;
await game.gps.web({ tokenUuid: event.data.token.uuid, regionUuid: region.uuid, regionScenario: "tokenTurnStart", userId: event.user.id });`;
    const turnEndSource = `if (game.user.id !== game.gps.getPrimaryGM()) return;
await game.gps.cloudOfDaggers2024({ tokenUuid: event.data.token.uuid, regionUuid: region.uuid, regionScenario: "tokenTurnEnd", movementScenario: event.data?.movement, userId: event.user.id });`;
    const oaExitSource = `let oaDisabled = await region.getFlag("gambits-premades", "regionDisabled"); if(oaDisabled) return; if(region.flags["gambits-premades"].actorUuid === event.data.token.actor.uuid) return; await game.gps.opportunityAttackScenarios({tokenUuid: event.data.token.uuid, regionUuid: region.uuid, regionScenario: "onExit", isTeleport: event.data.movement?.passed?.waypoints?.[0]?.action === "displace" ? true : false, waypoints: event.data.movement?.passed?.waypoints, userId: event.user.id});`;
    const oaEnterSource = `let oaDisabled = await region.getFlag("gambits-premades", "regionDisabled"); if(oaDisabled) return; if(region.flags["gambits-premades"].actorUuid === event.data.token.actor.uuid) return; await game.gps.opportunityAttackScenarios({tokenUuid: event.data.token.uuid, regionUuid: region.uuid, regionScenario: "onEnter", isTeleport: event.data.movement?.passed?.waypoints?.[0]?.action === "displace" ? true : false, waypoints: event.data.movement?.passed?.waypoints, userId: event.user.id});`;

    const region = {
        id: "region-1",
        uuid: "region-1",
        tokenIds: new Set(["active-commander", "active-member"]),
        flags: {
            "gambits-premades": {
                actorUuid: activeCommander.actor.uuid,
                tokenUuid: activeCommander.uuid
            }
        },
        behaviors: [
            {
                type: "executeScript",
                name: "onExit",
                disabled: false,
                system: {
                    events: ["tokenMoveOut"],
                    source: oaExitSource
                },
                async update(data) {
                    behaviorUpdates.push({ behavior: "onExit", ...data });
                    return data;
                }
            },
            {
                type: "executeScript",
                name: "onEnter",
                disabled: false,
                system: {
                    events: ["tokenMoveIn"],
                    source: oaEnterSource
                },
                async update(data) {
                    behaviorUpdates.push({ behavior: "onEnter", ...data });
                    return data;
                }
            },
            {
                type: "executeScript",
                name: "onTurnStart",
                disabled: false,
                system: {
                    events: ["tokenTurnStart"],
                    source: turnStartSource
                }
            },
            {
                type: "executeScript",
                name: "onTurnEnd",
                disabled: false,
                system: {
                    events: ["tokenTurnEnd"],
                    source: turnEndSource
                }
            }
        ],
        getFlag(scope, key) {
            if (scope === "gambits-premades" && key === "regionDisabled") return false;
            return null;
        }
    };
    regions.set(region.uuid, region);

    globalThis.game = {
        user: { id: "gm-1", isGM: true, active: true },
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
            getPrimaryGM() {
                return "gm-1";
            },
            opportunityAttackScenarios: createOriginalOpportunityAttackScenarios(),
            web(payload) {
                gpsCalls.push({ behavior: "tokenTurnStart", ...payload });
            },
            cloudOfDaggers2024(payload) {
                gpsCalls.push({ behavior: "tokenTurnEnd", ...payload });
            },
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
                if (id === currentTokenId) return currentToken.object;
                return tokens.get(`${id}-uuid`)?.object ?? null;
            }
        }
    };
    globalThis.fromUuid = async (uuid) => actors.get(uuid) ?? tokens.get(uuid) ?? regions.get(uuid) ?? null;
    globalThis.Hooks = createHooks();

    return {
        behaviorUpdates,
        warnings,
        gpsCalls,
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
        assert.equal(getGambitsPremadesVersion(), "2.1.43");
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
            tokenUuid: "active-commander-uuid",
            regionUuid: "region-1",
            regionScenario: "onExit"
        });
        const offSideResult = await game.gps.opportunityAttackScenarios({
            tokenUuid: "offside-token-uuid",
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

        assert.deepEqual(env.gpsCalls, [
            {
                behavior: "tokenTurnEnd",
                tokenUuid: "active-commander-uuid",
                regionUuid: "region-1",
                regionScenario: "tokenTurnEnd",
                movementScenario: undefined,
                userId: "gm-1"
            },
            {
                behavior: "tokenTurnEnd",
                tokenUuid: "active-member-uuid",
                regionUuid: "region-1",
                regionScenario: "tokenTurnEnd",
                movementScenario: undefined,
                userId: "gm-1"
            },
            {
                behavior: "tokenTurnStart",
                tokenUuid: "active-commander-uuid",
                regionUuid: "region-1",
                regionScenario: "tokenTurnStart",
                userId: "gm-1"
            },
            {
                behavior: "tokenTurnStart",
                tokenUuid: "active-member-uuid",
                regionUuid: "region-1",
                regionScenario: "tokenTurnStart",
                userId: "gm-1"
            }
        ]);
    } finally {
        env.restore();
    }
});

test("Gambits integration keeps an active-side token's OA region enabled on turn start", async () => {
    const env = installGlobals();
    try {
        registerGambitsPremadesIntegration();

        const result = await game.gps.opportunityAttackScenarios({
            tokenUuid: "active-commander-uuid",
            regionUuid: "region-1",
            regionScenario: "onTurnStart"
        });

        assert.equal(result, "disabled");
        assert.deepEqual(env.behaviorUpdates, [
            { behavior: "onExit", disabled: true },
            { behavior: "onEnter", disabled: true }
        ]);
    } finally {
        env.restore();
    }
});

test("Gambits integration keeps an active-side token's OA region enabled on turn end", async () => {
    const env = installGlobals();
    try {
        registerGambitsPremadesIntegration();

        const result = await game.gps.opportunityAttackScenarios({
            tokenUuid: "active-commander-uuid",
            regionUuid: "region-1",
            regionScenario: "onTurnEnd"
        });

        assert.equal(result, "enabled");
        assert.deepEqual(env.behaviorUpdates, [
            { behavior: "onExit", disabled: false },
            { behavior: "onEnter", disabled: false }
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
