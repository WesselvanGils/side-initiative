import test from "node:test";
import assert from "node:assert/strict";
import {
    shouldWarnAboutGambitsOpportunityAttack,
    warnAboutGambitsOpportunityAttack
} from "../scripts/integration/gambits-premades.mjs";

function installGlobals({ gambitsActive = true, opportunityAttackEnabled = true, sideCombat = true, isGM = true } = {}) {
    const original = {
        game: globalThis.game,
        ui: globalThis.ui
    };

    const warnings = [];
    globalThis.game = {
        user: { isGM },
        combat: null,
        modules: {
            get(moduleId) {
                if (moduleId === "gambits-premades") return gambitsActive ? { active: true } : { active: false };
                return null;
            }
        },
        settings: {
            get(namespace, key) {
                return namespace === "gambits-premades" && key === "Enable Opportunity Attack" ? opportunityAttackEnabled : false;
            }
        },
        sideInitiative: {
            isSideCombat() {
                return sideCombat;
            }
        },
        i18n: {
            localize(key) {
                return key;
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

    return {
        warnings,
        restore() {
            globalThis.game = original.game;
            globalThis.ui = original.ui;
        }
    };
}

test("Gambits warning helper only fires for GM side combat with AOO enabled", () => {
    const env = installGlobals();
    try {
        const combat = { id: "combat-1", started: true };
        assert.equal(shouldWarnAboutGambitsOpportunityAttack(combat), true);
        assert.equal(warnAboutGambitsOpportunityAttack(combat), true);
        assert.equal(env.warnings.length, 1);
        assert.equal(warnAboutGambitsOpportunityAttack(combat), false);
        assert.equal(env.warnings.length, 1);
    } finally {
        env.restore();
    }
});

test("Gambits warning helper stays quiet when the incompatibility is not present", () => {
    const env = installGlobals({ gambitsActive: false });
    try {
        const combat = { id: "combat-2", started: true };
        assert.equal(shouldWarnAboutGambitsOpportunityAttack(combat), false);
        assert.equal(warnAboutGambitsOpportunityAttack(combat), false);
        assert.equal(env.warnings.length, 0);
    } finally {
        env.restore();
    }
});

test("Gambits warning helper stays quiet for non-side combats and non-GMs", () => {
    const sideCombatEnv = installGlobals({ sideCombat: false });
    try {
        const combat = { id: "combat-3", started: true };
        assert.equal(shouldWarnAboutGambitsOpportunityAttack(combat), false);
        assert.equal(warnAboutGambitsOpportunityAttack(combat), false);
        assert.equal(sideCombatEnv.warnings.length, 0);
    } finally {
        sideCombatEnv.restore();
    }

    const nonGmEnv = installGlobals({ isGM: false });
    try {
        const combat = { id: "combat-4", started: true };
        assert.equal(shouldWarnAboutGambitsOpportunityAttack(combat), false);
        assert.equal(warnAboutGambitsOpportunityAttack(combat), false);
        assert.equal(nonGmEnv.warnings.length, 0);
    } finally {
        nonGmEnv.restore();
    }
});
