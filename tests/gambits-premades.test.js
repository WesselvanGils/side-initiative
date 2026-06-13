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

function installGlobals({
    version = "2.1.43",
    active = true,
    supportedBySide = new Set(["active-token"]),
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
    const tokens = new Map([
        ["current-token", { id: "current-token", object: { id: "current-token" }, actor: { type: "npc" } }],
        ["active-token", { id: "active-token", object: { id: "active-token" }, actor: { type: "npc" } }],
        ["offside-token", { id: "offside-token", object: { id: "offside-token" }, actor: { type: "npc" } }]
    ]);
    const regionUpdates = [];
    const regions = new Map([
        [
            "region-1",
            {
                id: "region-1",
                uuid: "region-1",
                flags: {
                    "gambits-premades": {
                        actorUuid: "active-token",
                        tokenUuid: "active-token"
                    }
                },
                behaviors: [
                    {
                        name: "onExit",
                        update(data) {
                            regionUpdates.push({ behavior: "onExit", ...data });
                            return Promise.resolve(data);
                        }
                    },
                    {
                        name: "onEnter",
                        update(data) {
                            regionUpdates.push({ behavior: "onEnter", ...data });
                            return Promise.resolve(data);
                        }
                    }
                ],
                getFlag(scope, key) {
                    if (scope === "gambits-premades" && key === "regionDisabled") return false;
                    return null;
                }
            }
        ]
    ]);

    globalThis.game = {
        user: { isGM: true },
        combat: { current: { tokenId: currentTokenId }, started: true },
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
                return supportedBySide.has(token?.object?.id);
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
        tokens: {
            get(id) {
                return tokens.get(id) ?? null;
            }
        }
    };
    globalThis.fromUuid = async (uuid) => tokens.get(uuid) ?? regions.get(uuid) ?? null;
    globalThis.Hooks = {
        once() {},
        on() {}
    };

    return {
        warnings,
        tokens,
        regions,
        regionUpdates,
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

test("Gambits helpers recognize the supported version and source shape", () => {
    const env = installGlobals();
    try {
        assert.equal(getGambitsPremadesVersion(), "2.1.43");
        assert.equal(isSupportedGambitsPremadesVersion(), true);
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
            tokenUuid: "active-token",
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

test("Gambits integration keeps the commander's OA region enabled on turn start", async () => {
    const env = installGlobals({ currentTokenId: "active-token" });
    try {
        registerGambitsPremadesIntegration();

        const result = await game.gps.opportunityAttackScenarios({
            tokenUuid: "active-token",
            regionUuid: "region-1",
            regionScenario: "onTurnStart"
        });

        assert.equal(result, undefined);
        assert.deepEqual(env.regionUpdates, [
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
        assert.match(env.warnings[0], /2\.1\.44/);
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
