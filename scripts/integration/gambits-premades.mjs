const warnedCombatIds = new Set();

/**
 * Determine whether Gambits Premades opportunity attacks are enabled.
 * @returns {boolean}
 */
function isGambitsOpportunityAttackEnabled() {
    return Boolean(
        game.modules.get("gambits-premades")?.active &&
        game.settings.get("gambits-premades", "Enable Opportunity Attack")
    );
}

/**
 * Determine whether the current setup should warn about Gambits opportunity attacks.
 * @param {object | null | undefined} combat
 * @returns {boolean}
 */
export function shouldWarnAboutGambitsOpportunityAttack(combat = game.combat) {
    if (!game.user?.isGM) return false;
    if (!combat?.started) return false;
    if (!isGambitsOpportunityAttackEnabled()) return false;
    return Boolean(game.sideInitiative?.isSideCombat?.(combat));
}

/**
 * Show the Gambits compatibility warning once per combat.
 * @param {object | null | undefined} combat
 * @returns {boolean}
 */
export function warnAboutGambitsOpportunityAttack(combat = game.combat) {
    if (!shouldWarnAboutGambitsOpportunityAttack(combat)) return false;
    const combatId = combat?.id ?? null;
    if (!combatId || warnedCombatIds.has(combatId)) return false;

    warnedCombatIds.add(combatId);
    ui.notifications.warn(game.i18n.localize("SIDE-INITIATIVE.Notifications.GambitsOpportunityAttackIncompatible"));
    return true;
}

/**
 * Register Gambits Premades compatibility hooks.
 * @returns {void}
 */
export function registerGambitsPremadesIntegration() {
    if (!game.modules.get("gambits-premades")?.active) return;

    Hooks.on("createCombat", (combat) => {
        warnAboutGambitsOpportunityAttack(combat);
    });

    Hooks.on("updateCombat", (combat, changed) => {
        if (changed?.started) {
            warnAboutGambitsOpportunityAttack(combat);
        }
    });

    Hooks.on("updateSetting", (setting) => {
        if (setting?.config?.namespace === "gambits-premades" && setting?.config?.key === "Enable Opportunity Attack") {
            warnAboutGambitsOpportunityAttack(game.combat);
        }
    });

    Hooks.on("deleteCombat", (combat) => {
        if (combat?.id) warnedCombatIds.delete(combat.id);
    });

    warnAboutGambitsOpportunityAttack(game.combat);
}
