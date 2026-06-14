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

function isPrimaryGMClient() {
    const primaryGMId = game.gps?.getPrimaryGM?.() ?? game.users?.activeGM?.id ?? game.users?.getActiveGM?.()?.id ?? null;
    if (primaryGMId) return game.user?.id === primaryGMId;
    return isActiveGMClient();
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

function getBehaviorSource(behavior) {
    return behavior?.system?.source ?? behavior?.source ?? behavior?.command ?? null;
}

function getBehaviorEvents(behavior) {
    const events = behavior?.system?.events ?? behavior?.events ?? behavior?.data?.events ?? [];
    if (Array.isArray(events)) return events.map(String);
    if (events instanceof Set) return Array.from(events, String);
    if (typeof events === "string") return [events];
    return [];
}

function isBehaviorEnabled(behavior) {
    return !(behavior?.disabled ?? behavior?.system?.disabled ?? behavior?.data?.disabled);
}

function getBehaviorType(behavior) {
    return behavior?.type ?? behavior?.system?.type ?? null;
}

function isTurnEventBehavior(behavior, eventName) {
    return getBehaviorType(behavior) === "executeScript" && isBehaviorEnabled(behavior) && getBehaviorEvents(behavior).includes(eventName);
}

function getCombatantTokenDocuments(combatant) {
    const documents = [];
    const seen = new Set();
    const pushToken = (token) => {
        const tokenDocument = token?.document ?? token ?? null;
        const uuid = tokenDocument?.uuid ?? tokenDocument?.id ?? null;
        if (!tokenDocument || !uuid || seen.has(uuid)) return;
        seen.add(uuid);
        documents.push(tokenDocument);
    };

    pushToken(combatant?.token);
    pushToken(combatant?.tokenDocument);
    pushToken(combatant?.document?.token);
    pushToken(combatant?.document?.object?.document);
    pushToken(combatant?.token?.document);
    pushToken(combatant?.token?.object?.document);
    pushToken(combatant?.actor?.token);
    pushToken(combatant?.actor?.prototypeToken);

    for (const token of combatant?.actor?.getActiveTokens?.() ?? []) {
        pushToken(token);
    }

    return documents;
}

function getTokenIdentifier(token) {
    return token?.uuid ?? token?.id ?? null;
}

function getTokenScene(token) {
    return token?.parent ?? token?.scene ?? token?.document?.parent ?? token?.document?.scene ?? canvas?.scene ?? null;
}

async function tokenIsInsideRegion(tokenDocument, region) {
    if (typeof tokenDocument?.testInsideRegion === "function") {
        try {
            return Boolean(await tokenDocument.testInsideRegion(region, {
                x: tokenDocument.x,
                y: tokenDocument.y,
                width: tokenDocument.width,
                height: tokenDocument.height,
                elevation: tokenDocument.elevation
            }));
        } catch {
            return false;
        }
    }

    if (typeof region?.testToken === "function") {
        try {
            return Boolean(await region.testToken(tokenDocument));
        } catch {
            return false;
        }
    }

    return false;
}

function getBehaviorExecutor() {
    const AsyncFunction = globalThis.foundry?.utils?.AsyncFunction ?? Object.getPrototypeOf(async function asyncFn() {}).constructor;
    return AsyncFunction;
}

async function executeRegionBehaviorScript(behavior, event, region) {
    const source = getBehaviorSource(behavior);
    if (!source) return false;

    const AsyncFunction = getBehaviorExecutor();
    const fn = new AsyncFunction("event", "region", `"use strict";\n${source}`);
    await fn.call(region, event, region);
    return true;
}

async function executeTurnBehaviorsForSide(combat, sideId, eventName) {
    if (!combat?.started || !sideId) return;

    const tokens = new Map();
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        for (const tokenDocument of getCombatantTokenDocuments(combatant)) {
            const tokenId = getTokenIdentifier(tokenDocument) ?? combatant?.id ?? null;
            if (!tokenId || tokens.has(tokenId)) continue;
            tokens.set(tokenId, tokenDocument);
        }
    }

    for (const tokenDocument of tokens.values()) {
        const scene = getTokenScene(tokenDocument);
        const regions = getRegionEntries(scene?.regions ?? []);
        for (const region of regions) {
            if (!(await tokenIsInsideRegion(tokenDocument, region))) continue;
            const matchingBehaviors = getOpportunityAttackRegionBehaviors(region).filter((behavior) => isTurnEventBehavior(behavior, eventName));
            if (!matchingBehaviors.length) continue;

            const event = {
                combat,
                data: {
                    token: tokenDocument
                },
                region,
                user: game.user ?? null
            };

            for (const behavior of matchingBehaviors) {
                await executeRegionBehaviorScript(behavior, event, region);
            }
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
        if (!game.user?.isGM || !isPrimaryGMClient()) return;
        await executeTurnBehaviorsForSide(combat, sideId, "tokenTurnEnd");
    });

    Hooks.on("side-initiative.sideTurnStart", async ({ combat, sideId } = {}) => {
        if (integrationState.status !== "patched") return;
        if (!game.user?.isGM || !isPrimaryGMClient()) return;
        await executeTurnBehaviorsForSide(combat, sideId, "tokenTurnStart");
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
