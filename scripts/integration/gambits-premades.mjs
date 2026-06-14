import { getCombatantsForSide } from "../logic.mjs";

const SUPPORTED_GAMBITS_PREMADES_VERSIONS = new Set(["2.1.42", "2.1.43"]);
const SUPPORTED_OPPORTUNITY_ATTACK_SOURCE_MARKERS = [
    "canvas.tokens.get(game.combat?.current.tokenId)",
    "currentCombatant?.id !== token.object.id",
    "not tokens turn in combat",
    "regionScenario === \"onTurnStart\"",
    "regionScenario === \"onTurnEnd\"",
    "let behaviors = region.behaviors.filter(b => b.name === \"onExit\" || b.name === \"onEnter\")"
];

const integrationState = {
    status: "inactive",
    version: null,
    reason: null,
    originalOpportunityAttackScenarios: null,
    patchedOpportunityAttackScenarios: null,
    warnedKeys: new Set(),
    hooksRegistered: false
};

function getGambitsModule() {
    return game.modules.get("gambits-premades") ?? null;
}

function getCollectionEntries(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (collection instanceof Map) return Array.from(collection.values());
    if (Array.isArray(collection.contents)) return collection.contents;
    if (typeof collection.values === "function") return Array.from(collection.values());
    if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
    return [];
}

function isActiveGMClient() {
    const activeGM = game.users?.activeGM ?? game.users?.getActiveGM?.() ?? Array.from(game.users?.contents ?? []).find((user) => user?.isGM && user?.active) ?? null;
    if (activeGM) return activeGM.id === game.user?.id;
    return Boolean(game.user?.isGM);
}

function getSupportedVersionsLabel() {
    return Array.from(SUPPORTED_GAMBITS_PREMADES_VERSIONS).join(" or ");
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
    return SUPPORTED_GAMBITS_PREMADES_VERSIONS.has(String(version ?? ""));
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
    integrationState.hooksRegistered = false;
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

function getCombatantTokenDocument(combatant) {
    const candidates = [
        combatant?.token,
        combatant?.tokenDocument,
        combatant?.document?.token,
        combatant?.token?.document,
        combatant?.token?.object?.document,
        combatant?.document?.object?.document,
        combatant?.actor?.prototypeToken
    ];

    for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") return candidate;
    }
    return null;
}

function getTokenIdentifier(token) {
    return token?.id ?? token?.uuid ?? token?.document?.id ?? token?.document?.uuid ?? null;
}

function getSceneForToken(token) {
    return token?.parent ?? token?.scene ?? token?.document?.parent ?? token?.document?.scene ?? canvas?.scene ?? null;
}

function tokenIsInsideRegion(token, region) {
    const tokenDocument = token?.document ?? token;
    if (typeof tokenDocument?.testInsideRegion === "function") {
        try {
            return Boolean(tokenDocument.testInsideRegion(region));
        } catch {
            return false;
        }
    }

    if (typeof region?.testToken === "function") {
        try {
            return Boolean(region.testToken(tokenDocument));
        } catch {
            return false;
        }
    }

    return false;
}

function getRegionDispatchTarget(region) {
    if (typeof region?._triggerEvent === "function") return region;
    if (typeof region?.triggerEvent === "function") return region;
    if (typeof region?.dispatchEvent === "function") return region;
    if (typeof region?.document?._triggerEvent === "function") return region.document;
    if (typeof region?.document?.triggerEvent === "function") return region.document;
    if (typeof region?.document?.dispatchEvent === "function") return region.document;
    return null;
}

async function dispatchRegionTurnEvent(region, eventName, token) {
    const target = getRegionDispatchTarget(region);
    const dispatcher = target?._triggerEvent ?? target?.triggerEvent ?? target?.dispatchEvent;
    if (typeof dispatcher !== "function") return false;

    const scene = getSceneForToken(token);
    const payload = {
        combat: game.combat ?? null,
        data: {
            token
        },
        eventName,
        region,
        scene,
        token,
        tokenDocument: token,
        user: game.user ?? null
    };

    await dispatcher.call(target, eventName, payload);
    return true;
}

async function triggerTurnEventsForSide(combat, sideId, eventName) {
    if (!combat?.started || !sideId) return;

    const tokens = new Map();
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        const token = getCombatantTokenDocument(combatant);
        const tokenId = getTokenIdentifier(token) ?? combatant?.id ?? null;
        if (!token || !tokenId || tokens.has(tokenId)) continue;
        tokens.set(tokenId, token);
    }

    for (const token of tokens.values()) {
        const scene = getSceneForToken(token);
        const regions = getRegionEntries(scene?.regions ?? []);
        for (const region of regions) {
            if (!tokenIsInsideRegion(token, region)) continue;
            await dispatchRegionTurnEvent(region, eventName, token);
        }
    }
}

function getRegionEntries(regions) {
    return getCollectionEntries(regions);
}

function createPatchedOpportunityAttackScenarios(original) {
    return async function patchedOpportunityAttackScenarios(payload) {
        const tokenUuid = payload?.tokenUuid;
        const regionScenario = payload?.regionScenario ?? null;
        const regionUuid = payload?.regionUuid ?? null;
        const combat = game.combat ?? null;
        const region = regionUuid ? await fromUuid(regionUuid) : null;
        const token = tokenUuid ? await fromUuid(tokenUuid) : null;
        const tokenObjectId = token?.object?.id ?? token?.id ?? null;

        if (!combat || !tokenObjectId) {
            return original.call(this, payload);
        }

        if (isTurnBoundaryScenario(regionScenario) && game.sideInitiative?.isTokenOnActiveSide?.(token, combat)) {
            if (!region) return;
            await setOpportunityAttackRegionBehaviorsDisabled(region, false);
            return;
        }

        const currentTokenId = combat.current?.tokenId;
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
                supported: getSupportedVersionsLabel()
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

function registerGambitsTurnHooks() {
    if (integrationState.hooksRegistered) return;
    integrationState.hooksRegistered = true;

    Hooks.on("side-initiative.sideTurnEnd", async ({ combat, sideId } = {}) => {
        if (integrationState.status !== "patched") return;
        if (!game.user?.isGM || !isActiveGMClient()) return;
        await triggerTurnEventsForSide(combat, sideId, "tokenTurnEnd");
    });

    Hooks.on("side-initiative.sideTurnStart", async ({ combat, sideId } = {}) => {
        if (integrationState.status !== "patched") return;
        if (!game.user?.isGM || !isActiveGMClient()) return;
        await triggerTurnEventsForSide(combat, sideId, "tokenTurnStart");
    });
}

/**
 * Register Gambits Premades compatibility hooks.
 * @returns {void}
 */
export function registerGambitsPremadesIntegration() {
    if (!getGambitsModule()?.active) return;

    registerGambitsTurnHooks();

    if (tryPatchGambitsOpportunityAttack()) return;

    if (integrationState.status !== "patched") {
        Hooks.once("socketlib.ready", tryPatchGambitsOpportunityAttack);
    }
}
