const SUPPORTED_GAMBITS_PREMADES_VERSION = "2.1.43";
const SUPPORTED_OPPORTUNITY_ATTACK_SOURCE_MARKERS = [
    "canvas.tokens.get(game.combat?.current.tokenId)",
    "currentCombatant?.id !== token.object.id",
    "not tokens turn in combat",
    "regionScenario === \"onTurnStart\"",
    "let behaviors = region.behaviors.filter(b => b.name === \"onExit\" || b.name === \"onEnter\")"
];

const integrationState = {
    status: "inactive",
    version: null,
    reason: null,
    originalOpportunityAttackScenarios: null,
    patchedOpportunityAttackScenarios: null,
    warnedKeys: new Set()
};

function getGambitsModule() {
    return game.modules.get("gambits-premades") ?? null;
}

/**
 * Read the installed Gambits Premades version.
 * @returns {string | null}
 */
export function getGambitsPremadesVersion() {
    return getGambitsModule()?.version ?? getGambitsModule()?.data?.version ?? null;
}

/**
 * Determine whether the installed Gambits Premades version is supported.
 * @param {string | null | undefined} [version]
 * @returns {boolean}
 */
export function isSupportedGambitsPremadesVersion(version = getGambitsPremadesVersion()) {
    return String(version ?? "") === SUPPORTED_GAMBITS_PREMADES_VERSION;
}

/**
 * Validate that the installed Gambits AOO function still matches the expected source shape.
 * @param {Function | null | undefined} fn
 * @returns {boolean}
 */
export function validateGambitsOpportunityAttackSource(fn) {
    if (typeof fn !== "function") return false;
    const source = Function.prototype.toString.call(fn);
    return SUPPORTED_OPPORTUNITY_ATTACK_SOURCE_MARKERS.every((marker) => source.includes(marker));
}

/**
 * Return the current integration state for tests and diagnostics.
 * @returns {{ status: string, version: string | null, reason: string | null }}
 */
export function getGambitsPremadesIntegrationState() {
    return {
        status: integrationState.status,
        version: integrationState.version,
        reason: integrationState.reason
    };
}

/**
 * Reset the internal integration state.
 * @returns {void}
 */
export function resetGambitsPremadesIntegrationState() {
    integrationState.status = "inactive";
    integrationState.version = null;
    integrationState.reason = null;
    integrationState.originalOpportunityAttackScenarios = null;
    integrationState.patchedOpportunityAttackScenarios = null;
    integrationState.warnedKeys.clear();
}

function warnOnce(key, message) {
    if (integrationState.warnedKeys.has(key)) return;
    integrationState.warnedKeys.add(key);
    ui.notifications.warn(message);
}

function restoreOriginalOpportunityAttackScenarios() {
    if (!integrationState.originalOpportunityAttackScenarios) return;
    if (game.gps?.opportunityAttackScenarios === integrationState.patchedOpportunityAttackScenarios) {
        game.gps.opportunityAttackScenarios = integrationState.originalOpportunityAttackScenarios;
    }
}

function disableIntegration(status, reason, warningKey = null, warningMessage = null) {
    restoreOriginalOpportunityAttackScenarios();
    integrationState.status = status;
    integrationState.reason = reason;

    if (warningKey && warningMessage) {
        warnOnce(warningKey, warningMessage);
    }
}

function getOpportunityAttackRegionBehaviors(region) {
    const behaviors = region?.behaviors;
    if (!behaviors) return [];
    if (Array.isArray(behaviors)) return behaviors;
    if (typeof behaviors.filter === "function") return behaviors.filter(() => true);
    if (typeof behaviors.values === "function") return Array.from(behaviors.values());
    if (typeof behaviors[Symbol.iterator] === "function") return Array.from(behaviors);
    return [];
}

async function setOpportunityAttackRegionBehaviorsDisabled(region, disabled) {
    const behaviors = getOpportunityAttackRegionBehaviors(region).filter((behavior) => behavior?.name === "onExit" || behavior?.name === "onEnter");
    for (const behavior of behaviors) {
        await behavior.update?.({ disabled });
    }
}

function isTurnBoundaryScenario(regionScenario) {
    return regionScenario === "onTurnStart" || regionScenario === "onTurnEnd";
}

function createPatchedOpportunityAttackScenarios(original) {
    return async function patchedOpportunityAttackScenarios(payload) {
        const tokenUuid = payload?.tokenUuid;
        const regionScenario = payload?.regionScenario ?? null;
        const regionUuid = payload?.regionUuid ?? null;
        const combat = game.combat ?? null;
        const region = regionUuid ? await fromUuid(regionUuid) : null;
        const token = tokenUuid ? await fromUuid(tokenUuid) : null;

        if (!combat || !token?.object?.id) {
            return original.call(this, payload);
        }

        if (isTurnBoundaryScenario(regionScenario) && game.sideInitiative?.isTokenOnActiveSide?.(token, combat)) {
            if (!region) return;
            await setOpportunityAttackRegionBehaviorsDisabled(region, false);
            return;
        }

        const currentTokenId = combat.current?.tokenId;
        const tokenObjectId = token.object.id;
        const bypassGuard = Boolean(
            currentTokenId &&
            currentTokenId !== tokenObjectId &&
            game.sideInitiative?.isTokenOnActiveSide?.(token, combat)
        );

        if (!bypassGuard) {
            return original.call(this, payload);
        }

        const canvasTokens = canvas?.tokens;
        if (!canvasTokens?.get) {
            return original.call(this, payload);
        }

        const originalGet = canvasTokens.get;
        canvasTokens.get = function patchedGet(id, ...rest) {
            if (id === currentTokenId) {
                return token.object ?? token;
            }
            return originalGet.call(this, id, ...rest);
        };

        try {
            return await original.call(this, payload);
        } catch (error) {
            throw error;
        } finally {
            canvasTokens.get = originalGet;
        }
    };
}

function tryPatchGambitsOpportunityAttack() {
    const gps = game.gps;
    if (!getGambitsModule()?.active || !gps) return false;

    if (
        integrationState.status === "patched" &&
        gps.opportunityAttackScenarios === integrationState.patchedOpportunityAttackScenarios
    ) {
        return true;
    }

    const version = getGambitsPremadesVersion();
    integrationState.version = version;

    if (!isSupportedGambitsPremadesVersion(version)) {
        disableIntegration(
            "unsupported",
            `Gambits Premades Opportunity Attack integration is disabled because version ${version ?? "unknown"} is not supported.`,
            "unsupported-version",
            game.i18n.format("SIDE-INITIATIVE.Notifications.GambitsOpportunityAttackUnsupportedVersion", {
                version: version ?? "unknown",
                supported: SUPPORTED_GAMBITS_PREMADES_VERSION
            })
        );
        return false;
    }

    const original = gps.opportunityAttackScenarios;
    if (!validateGambitsOpportunityAttackSource(original)) {
        disableIntegration(
            "unsupported",
            "Gambits Premades Opportunity Attack integration is disabled because the installed source no longer matches the supported shape.",
            "source-mismatch",
            game.i18n.localize("SIDE-INITIATIVE.Notifications.GambitsOpportunityAttackSourceMismatch")
        );
        return false;
    }

    integrationState.originalOpportunityAttackScenarios = original;
    integrationState.patchedOpportunityAttackScenarios = createPatchedOpportunityAttackScenarios(original);
    gps.opportunityAttackScenarios = integrationState.patchedOpportunityAttackScenarios;
    integrationState.status = "patched";
    integrationState.reason = null;
    return true;
}

/**
 * Register Gambits Premades compatibility hooks.
 * @returns {void}
 */
export function registerGambitsPremadesIntegration() {
    if (!getGambitsModule()?.active) return;

    if (tryPatchGambitsOpportunityAttack()) return;

    if (integrationState.status !== "patched") {
        Hooks.once("socketlib.ready", tryPatchGambitsOpportunityAttack);
    }
}
