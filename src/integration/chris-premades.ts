import { getCombatantsForSide } from "../logic.js";
import { hooks, isPrimaryGMClient } from "../runtime.js";
import type { CombatLike, SideTurnPayload, TokenLike } from "../types.js";

/**
 * Chris' Premades (CPR) compatibility bridge.
 *
 * CPR routes turn-based area triggers — e.g. Hunger of Hadar's start/end-of-turn
 * damage, Wall of Fire's end-of-turn damage — through `combatEvents.updateCombat`
 * in `libs/chris-premades/scripts/events/combat.js`. That handler runs the
 * `turnStart`/`turnEnd` template and region macro passes for the SINGLE current
 * combatant only (`executeMacroPass([currentToken], 'turnStart')`). In
 * side-initiative the current combatant is the side's commander, so every other
 * token on the side silently misses those passes and never takes the damage.
 *
 * CPR does not expose its dispatch on `globalThis.chrisPremades`, but it does
 * expose the macro objects (`chrisPremades.macros.<name>`, each with a
 * `.template`/`.region` array of `{pass, macro, priority}`) and
 * `chrisPremades.utils.templateUtils.getTemplatesInToken`. This bridge reuses
 * those public surfaces to fire the missing `turnStart`/`turnEnd` passes for the
 * non-commander tokens on the active side — mirroring how the Gambits bridge
 * reuses Gambits' stored region scripts.
 *
 * Movement-based passes (`enter`/`left`) are driven by CPR's own movement events
 * and are unaffected, so they are intentionally not bridged here.
 */

type TurnPass = "turnStart" | "turnEnd";
type EntityKind = "template" | "region";

interface CprMacroArg {
    trigger: SortedTrigger;
}

interface CprPassEntry {
    pass?: string;
    priority?: number;
    macro?: (arg: CprMacroArg) => unknown;
}

interface CprMacroExport {
    template?: CprPassEntry[];
    region?: CprPassEntry[];
}

interface CprTemplateUtils {
    getTemplatesInToken?(token: unknown): Set<unknown> | unknown[];
}

interface CprApi {
    macros?: Record<string, CprMacroExport>;
    utils?: { templateUtils?: CprTemplateUtils };
}

interface CombatTurnRef {
    tokenId?: string | null;
    turn?: number;
    round?: number;
}

interface TurnDetails {
    currentTurn: number;
    previousTurn: number;
    currentRound: number;
    previousRound: number;
}

/** A macro invocation ready to hand to `macro({ trigger })`, matching combat.js. */
interface SortedTrigger extends TurnDetails {
    entity: unknown;
    token: unknown;
    castData: { castLevel: number; saveDC: number };
    macro: (arg: CprMacroArg) => unknown;
    priority: number;
    name: string;
    macroName: string;
}

/** One entity's matching macros, before per-name dedup. */
interface EntityTriggerCandidate extends TurnDetails {
    entity: unknown;
    token: unknown;
    name: string;
    castData: { castLevel: number; saveDC: number };
    macros: Array<{ macro: SortedTrigger["macro"]; priority: number; macroName: string }>;
}

interface ChrisPremadesIntegrationState {
    status: "inactive" | "active" | "unsupported";
    version: string | null;
    reason: string | null;
    warnedKeys: Set<string>;
    bridgeRegistered: boolean;
}

const integrationState: ChrisPremadesIntegrationState = {
    status: "inactive",
    version: null,
    reason: null,
    warnedKeys: new Set(),
    bridgeRegistered: false
};

function getCprModule(): { active?: boolean; version?: string; data?: { version?: string } } | null {
    return game?.modules?.get?.("chris-premades") ?? null;
}

/**
 * Read the installed Chris' Premades version (diagnostics only — the bridge
 * shape-checks the API rather than pinning a version).
 */
export function getCprPremadesVersion(): string | null {
    return getCprModule()?.version ?? getCprModule()?.data?.version ?? null;
}

function getCprApi(): CprApi | null {
    return (globalThis as unknown as { chrisPremades?: CprApi }).chrisPremades ?? null;
}

/**
 * Defensive shape check. The macro objects and `templateUtils.getTemplatesInToken`
 * are public-ish utilities CPR uses across its own modules, so reading their
 * shape degrades gracefully across CPR releases — no monkeypatch, no version pin.
 */
export function validateCprShape(): boolean {
    const api = getCprApi();
    return Boolean(api && typeof api === "object" && api.macros && typeof api.utils?.templateUtils?.getTemplatesInToken === "function");
}

/**
 * Return the current integration state for tests and diagnostics.
 */
export function getCprPremadesIntegrationState(): { status: string; version: string | null; reason: string | null } {
    return { status: integrationState.status, version: integrationState.version, reason: integrationState.reason };
}

/**
 * Reset the internal integration state.
 */
export function resetCprPremadesIntegrationState(): void {
    integrationState.status = "inactive";
    integrationState.version = null;
    integrationState.reason = null;
    integrationState.warnedKeys.clear();
    integrationState.bridgeRegistered = false;
}

function warnOnce(key: string, message: string): void {
    if (integrationState.warnedKeys.has(key)) return;
    integrationState.warnedKeys.add(key);
    ui?.notifications?.warn?.(message);
}

function disableIntegration(status: ChrisPremadesIntegrationState["status"], reason: string, warningKey: string | null = null, warningMessage: string | null = null): void {
    integrationState.status = status;
    integrationState.reason = reason;
    if (warningKey && warningMessage) warnOnce(warningKey, warningMessage);
}

function slugify(value: unknown): string {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function getEntityName(entity: unknown, kind: EntityKind): string {
    const cprFlags = (entity as { flags?: Record<string, Record<string, unknown>> })?.flags?.["chris-premades"];
    if (kind === "template") {
        const templateName = cprFlags?.template as { name?: string } | undefined;
        return templateName?.name ?? (entity as { name?: string })?.name ?? "template";
    }
    return (entity as { name?: string })?.name ?? "region";
}

function getEntityCastData(entity: unknown): { castLevel: number; saveDC: number } {
    // CPR builds castData with -1 sentinels (see combat.js getSortedTriggers);
    // macros such as Hunger of Hadar read castData.castLevel and break on
    // undefined, so we normalise here rather than forwarding the raw flag.
    const castData = (entity as { flags?: Record<string, Record<string, unknown>> })?.flags?.["chris-premades"]?.castData as
        | { castLevel?: unknown; saveDC?: unknown }
        | undefined;
    const { castLevel, saveDC } = castData ?? {};
    return {
        castLevel: typeof castLevel === "number" && Number.isFinite(castLevel) ? castLevel : -1,
        saveDC: typeof saveDC === "number" && Number.isFinite(saveDC) ? saveDC : -1
    };
}

/**
 * Resolve the macro pass entries declared on an entity (template or region).
 * CPR stores macro names on `flags['chris-premades'].macros` and resolves them to
 * exports on `globalThis.chrisPremades.macros`, each with a `.template`/`.region`
 * array of `{pass, macro, priority}`. Embedded (string) macros are intentionally
 * skipped — first-party spells use named exports.
 */
function collectEntityTriggers(entity: unknown, kind: EntityKind, pass: TurnPass, tokenPlaceable: unknown, details: TurnDetails): EntityTriggerCandidate | null {
    const macros = getCprApi()?.macros;
    if (!macros) return null;

    const flagMacros = (entity as { flags?: Record<string, Record<string, { template?: unknown[]; region?: unknown[] }>> })?.flags?.["chris-premades"]?.macros;
    const names = flagMacros?.[kind] ?? [];
    if (!Array.isArray(names) || names.length === 0) return null;

    const entries: EntityTriggerCandidate["macros"] = [];
    for (const name of names) {
        if (typeof name !== "string") continue;
        const exportEntries = (macros[name]?.[kind] ?? []) as CprPassEntry[];
        for (const entry of exportEntries) {
            if (entry?.pass !== pass || typeof entry.macro !== "function") continue;
            entries.push({ macro: entry.macro, priority: Number(entry.priority ?? 50), macroName: entry.macro.name || name });
        }
    }
    if (entries.length === 0) return null;

    return {
        entity,
        token: tokenPlaceable,
        name: slugify(getEntityName(entity, kind)),
        castData: getEntityCastData(entity),
        macros: entries,
        ...details
    };
}

/**
 * Replicate CPR's `getSortedTriggers` dedup (combat.js): group candidates by
 * name, keep one per name preferring max save DC then max cast level, then sort
 * the surviving macros by priority ascending. Prevents overlapping same-name
 * areas (two Cloudkills) from double-firing.
 */
function dedupeAndSort(candidates: EntityTriggerCandidate[]): SortedTrigger[] {
    const byName = new Map<string, EntityTriggerCandidate[]>();
    for (const candidate of candidates) {
        const list = byName.get(candidate.name) ?? [];
        list.push(candidate);
        byName.set(candidate.name, list);
    }

    const sorted: SortedTrigger[] = [];
    for (const list of byName.values()) {
        const maxLevel = Math.max(...list.map((candidate) => candidate.castData.castLevel));
        const maxDC = Math.max(...list.map((candidate) => candidate.castData.saveDC));
        const maxDCCandidate = list.find((candidate) => candidate.castData.saveDC === maxDC) ?? list[0];
        const winner = maxDCCandidate.castData.castLevel === maxLevel
            ? maxDCCandidate
            : list.find((candidate) => candidate.castData.castLevel === maxLevel) ?? maxDCCandidate;
        for (const macro of winner.macros) {
            sorted.push({
                entity: winner.entity,
                token: winner.token,
                castData: winner.castData,
                macro: macro.macro,
                priority: macro.priority,
                name: winner.name,
                macroName: macro.macroName,
                currentTurn: winner.currentTurn,
                previousTurn: winner.previousTurn,
                currentRound: winner.currentRound,
                previousRound: winner.previousRound
            });
        }
    }
    return sorted.sort((a, b) => a.priority - b.priority);
}

function getTemplatesForToken(tokenPlaceable: unknown): unknown[] {
    const templates = getCprApi()?.utils?.templateUtils?.getTemplatesInToken?.(tokenPlaceable);
    if (!templates) return [];
    if (templates instanceof Set) return Array.from(templates);
    if (Array.isArray(templates)) return templates;
    return Array.from(templates as Iterable<unknown>);
}

function getRegionsForToken(tokenDocument: TokenLike | null | undefined): unknown[] {
    // CPR reads `token.regions` from the token document (combat.js), which on a
    // Foundry TokenDocument is the Set of regions the token currently occupies.
    const regions = tokenDocument?.regions;
    if (!regions) return [];
    if (regions instanceof Set || Array.isArray(regions)) return Array.from(regions as Iterable<unknown>);
    if (typeof (regions as { values?: unknown }).values === "function") return Array.from((regions as { values: () => Iterable<unknown> }).values());
    return [];
}

function collectTriggersForToken(tokenDocument: TokenLike | null | undefined, tokenPlaceable: unknown, pass: TurnPass, details: TurnDetails): SortedTrigger[] {
    const candidates: EntityTriggerCandidate[] = [];
    for (const template of getTemplatesForToken(tokenPlaceable)) {
        const candidate = collectEntityTriggers(template, "template", pass, tokenPlaceable, details);
        if (candidate) candidates.push(candidate);
    }
    for (const region of getRegionsForToken(tokenDocument)) {
        const candidate = collectEntityTriggers(region, "region", pass, tokenPlaceable, details);
        if (candidate) candidates.push(candidate);
    }
    return dedupeAndSort(candidates);
}

async function invokeTriggers(triggers: SortedTrigger[]): Promise<void> {
    for (const trigger of triggers) {
        try {
            await trigger.macro({ trigger });
        } catch (error) {
            console?.error?.(error);
        }
    }
}

function getCombatTurnRef(combat: CombatLike | null | undefined, key: "current" | "previous"): CombatTurnRef | null {
    const ref = (combat as Record<string, unknown> | null)?.[key];
    return ref && typeof ref === "object" ? (ref as CombatTurnRef) : null;
}

async function bridgeSideTurn(payload: SideTurnPayload, pass: TurnPass): Promise<void> {
    if (!isPrimaryGMClient()) return;
    const combat = payload?.combat ?? null;
    const sideId = payload?.sideId ?? null;
    if (!combat || !sideId || !validateCprShape()) return;

    // The bridge always fires for the side that is `combat.current` at emit time:
    // `sideTurnEnd` is emitted BEFORE the turn advances (the ending side is still
    // current), and `sideTurnStart` is emitted AFTER (the starting side is now
    // current). CPR fires the native pass for that side's commander in both cases,
    // so skip `combat.current.tokenId` to avoid double-processing it. This is also
    // robust to mid-mutation state (more so than re-deriving the side rep).
    const skipTokenId = getCombatTurnRef(combat, "current")?.tokenId ?? null;

    const current = getCombatTurnRef(combat, "current");
    const previous = getCombatTurnRef(combat, "previous");
    const details: TurnDetails = {
        currentTurn: current?.turn ?? -1,
        previousTurn: previous?.turn ?? -1,
        currentRound: current?.round ?? -1,
        previousRound: previous?.round ?? -1
    };

    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        const tokenDocument = combatant.token ?? null;
        const tokenPlaceable = tokenDocument?.object ?? tokenDocument;
        const tokenId = tokenDocument?.id ?? null;
        if (!tokenPlaceable || (skipTokenId && tokenId === skipTokenId)) continue;

        const triggers = collectTriggersForToken(tokenDocument, tokenPlaceable, pass, details);
        if (triggers.length === 0) continue;
        // Await sequentially — macros mutate world state and create workflows.
        await invokeTriggers(triggers);
    }
}

function registerSideTurnBridge(): void {
    if (integrationState.bridgeRegistered) return;
    integrationState.bridgeRegistered = true;
    hooks()?.on("side-initiative.sideTurnStart", (payload: SideTurnPayload) => bridgeSideTurn(payload ?? {}, "turnStart"));
    hooks()?.on("side-initiative.sideTurnEnd", (payload: SideTurnPayload) => bridgeSideTurn(payload ?? {}, "turnEnd"));
}

/**
 * Register the Chris' Premades compatibility bridge: fire CPR `turnStart`/
 * `turnEnd` template and region macro passes for every non-commander token on the
 * active side so area spells (Hunger of Hadar, Wall of Fire, ...) affect all
 * tokens, not just the commander.
 */
export function registerChrisPremadesIntegration(): void {
    if (!getCprModule()?.active) return;

    integrationState.version = getCprPremadesVersion();
    registerSideTurnBridge();

    if (validateCprShape()) {
        integrationState.status = "active";
        integrationState.reason = null;
        return;
    }

    // CPR populates `globalThis.chrisPremades` during its own ready (`cprReady`),
    // which may run after this module's ready. The bridge re-checks the shape on
    // every fire, so this only reports status accurately once CPR is available.
    integrationState.status = "inactive";
    integrationState.reason = "Chris' Premades API not yet available.";
    hooks()?.once("cprReady", () => {
        if (validateCprShape()) {
            integrationState.status = "active";
            integrationState.reason = null;
        } else {
            disableIntegration(
                "unsupported",
                "Chris' Premades API shape is not supported.",
                "cpr-shape-mismatch",
                "Side Initiative: Chris' Premades area triggers are disabled because the installed Chris' Premades API is not supported."
            );
        }
    });
}
