import { getCombatantsForSide } from "../logic.js";
import { getGps, getPrimaryGMId, getSideInitiative, hooks, isPrimaryGMClient } from "../runtime.js";
import type { CombatLike, SideTurnPayload, TokenLike } from "../types.js";

const SUPPORTED_GAMBITS_PREMADES_VERSIONS = ["2.1.42", "2.1.43"];
const SUPPORTED_OPPORTUNITY_ATTACK_SOURCE_MARKERS = [
    "canvas.tokens.get(game.combat?.current.tokenId)",
    "currentCombatant?.id !== token.object.id",
    "not tokens turn in combat",
    'regionScenario === "onTurnStart"',
    'let behaviors = region.behaviors.filter(b => b.name === "onExit" || b.name === "onEnter")',
];

type OpportunityAttackFn = (payload: Record<string, unknown>) => Promise<unknown>;

interface GambitsIntegrationState {
    status: "inactive" | "patched" | "unsupported";
    version: string | null;
    reason: string | null;
    originalOpportunityAttackScenarios: OpportunityAttackFn | null;
    patchedOpportunityAttackScenarios: OpportunityAttackFn | null;
    warnedKeys: Set<string>;
    bridgeRegistered: boolean;
}

const integrationState: GambitsIntegrationState = {
    status: "inactive",
    version: null,
    reason: null,
    originalOpportunityAttackScenarios: null,
    patchedOpportunityAttackScenarios: null,
    warnedKeys: new Set(),
    bridgeRegistered: false,
};

function getGambitsModule(): { active?: boolean; version?: string; data?: { version?: string } } | null {
    return game?.modules?.get?.("gambits-premades") ?? null;
}

/**
 * Read the installed Gambits Premades version.
 */
export function getGambitsPremadesVersion(): string | null {
    return getGambitsModule()?.version ?? getGambitsModule()?.data?.version ?? null;
}

/**
 * Determine whether the installed Gambits Premades version is supported.
 */
export function isSupportedGambitsPremadesVersion(
    version: string | null | undefined = getGambitsPremadesVersion(),
): boolean {
    return SUPPORTED_GAMBITS_PREMADES_VERSIONS.includes(String(version ?? ""));
}

/**
 * Validate that the installed Gambits AOO function still matches the expected source shape.
 * Acts as a type guard so callers can narrow to {@link OpportunityAttackFn}.
 *
 * Comparison is whitespace-insensitive so it holds against both the authored
 * Gambits source and minified/bundled builds (and the transpiled test fixtures).
 */
function squashWhitespace(value: string): string {
    return value.replace(/\s+/g, "");
}

export function validateGambitsOpportunityAttackSource(fn: unknown): fn is OpportunityAttackFn {
    if (typeof fn !== "function") return false;
    const source = squashWhitespace(Function.prototype.toString.call(fn));
    return SUPPORTED_OPPORTUNITY_ATTACK_SOURCE_MARKERS.every((marker) => source.includes(squashWhitespace(marker)));
}

/**
 * Return the current integration state for tests and diagnostics.
 */
export function getGambitsPremadesIntegrationState(): {
    status: string;
    version: string | null;
    reason: string | null;
} {
    return {
        status: integrationState.status,
        version: integrationState.version,
        reason: integrationState.reason,
    };
}

/**
 * Reset the internal integration state.
 */
export function resetGambitsPremadesIntegrationState(): void {
    integrationState.status = "inactive";
    integrationState.version = null;
    integrationState.reason = null;
    integrationState.originalOpportunityAttackScenarios = null;
    integrationState.patchedOpportunityAttackScenarios = null;
    integrationState.warnedKeys.clear();
    integrationState.bridgeRegistered = false;
}

function warnOnce(key: string, message: string): void {
    if (integrationState.warnedKeys.has(key)) return;
    integrationState.warnedKeys.add(key);
    ui?.notifications?.warn?.(message);
}

function restoreOriginalOpportunityAttackScenarios(): void {
    const gps = getGps();
    if (!integrationState.originalOpportunityAttackScenarios || !gps) return;
    if (gps.opportunityAttackScenarios === integrationState.patchedOpportunityAttackScenarios) {
        gps.opportunityAttackScenarios = integrationState.originalOpportunityAttackScenarios;
    }
}

function disableIntegration(
    status: GambitsIntegrationState["status"],
    reason: string,
    warningKey: string | null = null,
    warningMessage: string | null = null,
): void {
    restoreOriginalOpportunityAttackScenarios();
    integrationState.status = status;
    integrationState.reason = reason;

    if (warningKey && warningMessage) {
        warnOnce(warningKey, warningMessage);
    }
}

interface RegionBehaviorLike {
    name?: string;
    disabled?: boolean;
    system?: { source?: string; events?: string[] };
    update?(data: Record<string, unknown>): Promise<unknown> | unknown;
}

interface RegionLike {
    uuid?: string;
    id?: string;
    flags?: Record<string, unknown>;
    behaviors?:
        | RegionBehaviorLike[]
        | {
              filter?(pred: (b: RegionBehaviorLike) => boolean): RegionBehaviorLike[];
              values?(): IterableIterator<RegionBehaviorLike>;
              [Symbol.iterator]?(): IterableIterator<RegionBehaviorLike>;
          };
    object?: { containsToken?(token: unknown): boolean };
}

function getRegionBehaviors(region: RegionLike | null | undefined): RegionBehaviorLike[] {
    const behaviors = region?.behaviors;
    if (!behaviors) return [];
    if (Array.isArray(behaviors)) return behaviors;
    if (typeof (behaviors as { filter?: unknown }).filter === "function")
        return (behaviors as { filter: (pred: (b: RegionBehaviorLike) => boolean) => RegionBehaviorLike[] }).filter(
            () => true,
        );
    if (typeof (behaviors as { values?: unknown }).values === "function")
        return Array.from((behaviors as { values: () => IterableIterator<RegionBehaviorLike> }).values());
    if (typeof (behaviors as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function")
        return Array.from(behaviors as Iterable<RegionBehaviorLike>);
    return [];
}

function getRegionBehaviorsByName(region: RegionLike | null | undefined, name: string): RegionBehaviorLike[] {
    return getRegionBehaviors(region).filter((behavior) => behavior?.name === name);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AsyncFunction = (
    Object.getPrototypeOf(async () => {}) as {
        constructor: new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
    }
).constructor;

function runRegionBehaviorScript(
    behavior: RegionBehaviorLike,
    event: Record<string, unknown>,
    region: RegionLike,
): Promise<unknown> {
    const source = behavior?.system?.source;
    if (typeof source !== "string") return Promise.resolve();
    const fn = new AsyncFunction("event", "region", source);
    return fn(event, region);
}

function getSceneRegions(): RegionLike[] {
    const regions = canvas?.scene?.regions;
    if (!regions) return [];
    if (regions instanceof Map) return Array.from((regions as Map<string, RegionLike>).values());
    if (Array.isArray(regions)) return regions as RegionLike[];
    if (typeof (regions as { values?: unknown }).values === "function")
        return Array.from((regions as { values: () => IterableIterator<RegionLike> }).values());
    if (typeof (regions as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function")
        return Array.from(regions as Iterable<RegionLike>);
    return [];
}

function isGambitsRegion(region: RegionLike | null | undefined): boolean {
    return Boolean(region?.flags?.["gambits-premades"]);
}

function isTokenInRegion(token: TokenLike | null | undefined, region: RegionLike | null | undefined): boolean {
    if (!token || !region) return false;
    if (typeof token.testInsideRegion === "function") return Boolean(token.testInsideRegion(region));
    if (token.regions instanceof Set) return token.regions.has(region);
    if (typeof region.object?.containsToken === "function")
        return Boolean(region.object.containsToken(token.object ?? token));
    return false;
}

async function bridgeSideTurn(payload: SideTurnPayload, behaviorName: string): Promise<void> {
    if (!isPrimaryGMClient()) return;
    const combat = payload?.combat ?? null;
    const sideId = payload?.sideId ?? null;
    if (!combat || !sideId) return;
    const userId = getPrimaryGMId();
    if (!userId) return;

    const regions = getSceneRegions();
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        const token = (combatant.token ?? null) as TokenLike | null;
        if (!token) continue;
        for (const region of regions) {
            if (!isGambitsRegion(region) || !isTokenInRegion(token, region)) continue;
            for (const behavior of getRegionBehaviorsByName(region, behaviorName)) {
                await runRegionBehaviorScript(
                    behavior,
                    { data: { token, movement: undefined }, user: { id: userId } },
                    region,
                );
            }
        }
    }
}

function registerSideTurnBridge(): void {
    if (integrationState.bridgeRegistered) return;
    integrationState.bridgeRegistered = true;
    hooks()?.on("side-initiative.sideTurnStart", (payload: SideTurnPayload) =>
        bridgeSideTurn(payload ?? {}, "onTurnStart"),
    );
    hooks()?.on("side-initiative.sideTurnEnd", (payload: SideTurnPayload) =>
        bridgeSideTurn(payload ?? {}, "onTurnEnd"),
    );
}

function createPatchedOpportunityAttackScenarios(original: OpportunityAttackFn): OpportunityAttackFn {
    return async function patchedOpportunityAttackScenarios(
        this: unknown,
        payload: Record<string, unknown>,
    ): Promise<unknown> {
        const tokenUuid = payload?.tokenUuid as string | undefined;
        const regionUuid = payload?.regionUuid as string | undefined;
        const combat = (game?.combat as CombatLike | null) ?? null;
        const region = regionUuid ? await fromUuid(regionUuid) : null;
        const token = tokenUuid ? await fromUuid(tokenUuid) : null;

        const tokenObject = (token as { object?: { id?: string } } | null)?.object;
        if (!combat || !tokenObject?.id) {
            return original.call(this, payload);
        }

        const currentTokenId = combat.current?.tokenId ?? null;
        const tokenObjectId = tokenObject.id;
        const bypassGuard = Boolean(
            currentTokenId &&
                currentTokenId !== tokenObjectId &&
                getSideInitiative()?.isTokenOnActiveSide?.(token as TokenLike, combat),
        );

        if (!bypassGuard) {
            return original.call(this, payload);
        }

        const canvasTokens = canvas?.tokens as { get?: (id: string, ...rest: unknown[]) => unknown } | null;
        if (!canvasTokens?.get) {
            return original.call(this, payload);
        }

        // Gambits' only call to canvas.tokens.get is the "is it the mover's turn"
        // guard near the top of the OA flow. Serve that single lookup with the
        // active-side mover so the guard passes, then delegate to the real lookup.
        // This prevents the override from staying live across Gambits' async OA
        // dialog (which would resolve the current token — e.g. the commander — to
        // the mover and mis-target it) and from stacking across overlapping calls.
        const realGet = canvasTokens.get!.bind(canvasTokens);
        let guardServed = false;
        canvasTokens.get = function patchedGet(id: string, ...rest: unknown[]): unknown {
            if (!guardServed && id === currentTokenId) {
                guardServed = true;
                return tokenObject ?? token;
            }
            return realGet(id, ...rest);
        };

        try {
            return await original.call(this, payload);
        } finally {
            canvasTokens.get = realGet;
        }
    };
}

function tryPatchGambitsOpportunityAttack(): boolean {
    const gps = getGps();
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
            game?.i18n?.format?.("SIDE-INITIATIVE.Notifications.GambitsOpportunityAttackUnsupportedVersion", {
                version: version ?? "unknown",
                supported: SUPPORTED_GAMBITS_PREMADES_VERSIONS.join(" or "),
            }) ?? "",
        );
        return false;
    }

    const original = gps.opportunityAttackScenarios;
    if (!validateGambitsOpportunityAttackSource(original)) {
        disableIntegration(
            "unsupported",
            "Gambits Premades Opportunity Attack integration is disabled because the installed source no longer matches the supported shape.",
            "source-mismatch",
            game?.i18n?.localize?.("SIDE-INITIATIVE.Notifications.GambitsOpportunityAttackSourceMismatch") ?? "",
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
 * Register Gambits Premades compatibility hooks: bridge side-turn events to the
 * Gambits region turn behaviors for every combatant on the active side, and
 * monkeypatch the Opportunity Attack handler so active-side tokens can still
 * make opportunity attacks during their side's turn.
 */
export function registerGambitsPremadesIntegration(): void {
    if (!getGambitsModule()?.active) return;

    registerSideTurnBridge();

    if (tryPatchGambitsOpportunityAttack()) return;

    if (integrationState.status !== "patched") {
        hooks()?.once("socketlib.ready", tryPatchGambitsOpportunityAttack);
    }
}
