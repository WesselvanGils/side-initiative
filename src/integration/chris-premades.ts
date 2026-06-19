import { getCombatantsForSide, isSideCombat } from "../logic.js";
import { hooks, isPrimaryGMClient } from "../runtime.js";
import type { CombatLike, CombatantLike, SideTurnPayload, TokenLike } from "../types.js";

/**
 * Opt-in bridge diagnostics. In the Foundry console (F12) run
 * `globalThis.SIDE_INITIATIVE_DEBUG_CPR = true` then reproduce to trace which
 * combatants are processed/skipped and which token each macro targets. The bridge
 * runs only on side turns, so this is not noisy.
 */
function debug(...parts: unknown[]): void {
    if (!(globalThis as { SIDE_INITIATIVE_DEBUG_CPR?: boolean }).SIDE_INITIATIVE_DEBUG_CPR) return;
    console.log("[side-initiative/cpr]", ...parts);
}

/**
 * Chris' Premades (CPR) compatibility bridge.
 *
 * CPR routes turn-based area triggers — e.g. Hunger of Hadar's start/end-of-turn
 * damage, Wall of Fire's end-of-turn damage — through `combatEvents.updateCombat`
 * in `libs/chris-premades/scripts/events/combat.js`. That handler runs the
 * `turnStart`/`turnEnd` template and region macro passes for the SINGLE current
 * combatant only (`executeMacroPass([currentToken], 'turnStart')`). In
 * side-initiative the current combatant is the side's commander, so the model is
 * fundamentally incompatible: CPR only ever fires for one token, and its native
 * `updateCombat` runs as an un-awaited hook handler — so its commander workflow
 * overlaps the bridge's per-token workflows. midi-qol cannot run concurrent
 * programmatic damage workflows (they clobber the shared target selection, made
 * worse by Dice So Nice's delayed rolls), so damage lands on the wrong token.
 *
 * Two mechanisms fix this:
 *
 * 1. Update-combat wrap: fully suppress CPR's native `updateCombat` for
 *    side-initiative combats, so it never launches a concurrent workflow. The
 *    handler is found in the Foundry hook registry by source shape and its
 *    `HookedFunction.fn` is wrapped in place.
 *
 * 2. Side-turn bridge: on `side-initiative.sideTurnStart`/`sideTurnEnd`, fire the
 *    CPR `turnStart`/`turnEnd` (and `everyTurn`) passes for EVERY token on the
 *    active side — no skip, since there is no native fire to dedup against. All
 *    workflows go through a serialized queue (mutex) so `sideTurnEnd` and
 *    `sideTurnStart` (and every token within) fire one at a time. CPR does not
 *    expose its dispatch on `globalThis.chrisPremades`, so this reuses the public
 *    macro objects (`chrisPremades.macros.<name>`) and `templateUtils.getTemplatesInToken`.
 *
 * Movement-based passes (`enter`/`left`) are driven by CPR's own movement events
 * and are unaffected, so they are intentionally not bridged here. The
 * `turnStartSource`/`turnEndSource`/`turnStartNear`/`turnEndNear` passes are not
 * bridged (niche; lost when CPR's native updateCombat is suppressed for side combats).
 */

type TurnPass = "turnStart" | "turnEnd" | "everyTurn";
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
    combatantId?: string | null;
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
    updateCombatWrapped: boolean;
    originalUpdateCombat: ((...args: unknown[]) => unknown) | null;
    wrappedUpdateCombat: ((...args: unknown[]) => unknown) | null;
}

const integrationState: ChrisPremadesIntegrationState = {
    status: "inactive",
    version: null,
    reason: null,
    warnedKeys: new Set(),
    bridgeRegistered: false,
    updateCombatWrapped: false,
    originalUpdateCombat: null,
    wrappedUpdateCombat: null
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
    integrationState.updateCombatWrapped = false;
    integrationState.originalUpdateCombat = null;
    integrationState.wrappedUpdateCombat = null;
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

async function invokeTriggers(triggers: SortedTrigger[], ownerCombatantId: string | null = null, ownerPlaceableId: string | null = null): Promise<void> {
    for (const trigger of triggers) {
        const triggerToken = trigger.token as { id?: string; uuid?: string; document?: { uuid?: string } } | null;
        const targetId = triggerToken?.id ?? triggerToken?.document?.uuid ?? triggerToken?.uuid ?? null;
        debug(`    -> macro=${trigger.macroName} owner=${ownerCombatantId} ownerPlaceable=${ownerPlaceableId} trigger.token.id=${targetId}`);
        try {
            await trigger.macro({ trigger });
        } catch (error) {
            debug(`    !! macro=${trigger.macroName} threw:`, error);
            console?.error?.(error);
        }
    }
}

function getCombatTurnRef(combat: CombatLike | null | undefined, key: "current" | "previous"): CombatTurnRef | null {
    const ref = (combat as Record<string, unknown> | null)?.[key];
    return ref && typeof ref === "object" ? (ref as CombatTurnRef) : null;
}

/**
 * Resolve a combatant's token placeable (the object CPR macros target via
 * `token.document.uuid`). Prefer the document's `.object`; fall back to the
 * canvas placeable, then the document itself. Returns `[document, placeable]`.
 */
function resolveCombatantToken(combatant: CombatantLike | null | undefined): { document: TokenLike | null; placeable: unknown } {
    const tokenDocument = combatant?.token ?? combatant?.tokenDocument ?? null;
    const canvasTokens = (globalThis as { canvas?: { tokens?: { get?(id: string): unknown } } }).canvas?.tokens;
    const placeable = tokenDocument?.object ?? canvasTokens?.get?.(tokenDocument?.id ?? "") ?? tokenDocument;
    return { document: tokenDocument, placeable };
}

/**
 * Serialized queue for bridge-fired workflows. midi-qol cannot run concurrent
 * programmatic damage workflows — they clobber the shared target selection
 * (visibly so once Dice So Nice delays the rolls), which is what made the
 * commander "absorb" other tokens' damage. Every batch of workflows the bridge
 * launches is chained onto this promise so they run strictly one at a time,
 * including across the back-to-back `sideTurnEnd`/`sideTurnStart` hooks.
 */
let workflowChain: Promise<void> = Promise.resolve();

function enqueueWorkflowBatch(task: () => Promise<void>): void {
    workflowChain = workflowChain
        .catch(() => undefined)
        .then(task)
        .then(() => undefined, (error) => debug("workflow batch rejected:", error));
}

/**
 * Await the serialized workflow queue (tests/diagnostics). Resolves once every
 * bridge-fired batch queued so far has completed.
 */
export async function flushCprBridge(): Promise<void> {
    await workflowChain.catch(() => undefined);
}

async function firePassesForSide(combat: CombatLike, sideId: string, passes: readonly TurnPass[]): Promise<void> {
    const current = getCombatTurnRef(combat, "current");
    const previous = getCombatTurnRef(combat, "previous");
    const details: TurnDetails = {
        currentTurn: current?.turn ?? -1,
        previousTurn: previous?.turn ?? -1,
        currentRound: current?.round ?? -1,
        previousRound: previous?.round ?? -1
    };

    debug(`bridge passes=[${passes.join(",")}] side=${sideId}`);
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        const { document: tokenDocument, placeable: tokenPlaceable } = resolveCombatantToken(combatant);
        const combatantId = combatant?.id ?? null;
        const placeableId = (tokenPlaceable as { id?: string } | null)?.id ?? null;
        if (!tokenPlaceable) {
            debug(`  combatant=${combatantId} SKIP (no token placeable)`);
            continue;
        }
        for (const pass of passes) {
            const triggers = collectTriggersForToken(tokenDocument, tokenPlaceable, pass, details);
            if (triggers.length === 0) continue;
            debug(`  combatant=${combatantId} placeable=${placeableId} pass=${pass} firing ${triggers.length} trigger(s)`);
            // Await each macro so the next workflow only starts once this one
            // (rolls + damage) has completed.
            await invokeTriggers(triggers, combatantId, placeableId);
        }
    }
}

function bridgeSideTurn(payload: SideTurnPayload, passes: readonly TurnPass[]): void {
    if (!isPrimaryGMClient()) return;
    const combat = payload?.combat ?? null;
    const sideId = payload?.sideId ?? null;
    if (!combat || !sideId || !validateCprShape()) return;
    // Capture combat/sideId synchronously; fire the batch on the serialized queue.
    enqueueWorkflowBatch(() => firePassesForSide(combat, sideId, passes));
}

function registerSideTurnBridge(): void {
    if (integrationState.bridgeRegistered) return;
    integrationState.bridgeRegistered = true;
    hooks()?.on("side-initiative.sideTurnStart", (payload: SideTurnPayload) => bridgeSideTurn(payload ?? {}, ["turnStart", "everyTurn"]));
    hooks()?.on("side-initiative.sideTurnEnd", (payload: SideTurnPayload) => bridgeSideTurn(payload ?? {}, ["turnEnd"]));
}

/**
 * Distinctive string literals in CPR's `combatEvents.updateCombat` (combat.js).
 * Used to locate the handler in the Foundry hook registry by source shape so the
 * wrap survives CPR refactors as long as those dispatch passes keep their names.
 * Comparison is whitespace-insensitive (matches authored and bundled source).
 */
const CPR_UPDATE_COMBAT_MARKERS = ["turnStartSource", "turnEndSource", "turnStartNear", "everyTurn"];

function squashWhitespace(value: string): string {
    return value.replace(/\s+/g, "");
}

function isCprUpdateCombatSource(fn: unknown): boolean {
    if (typeof fn !== "function") return false;
    const source = squashWhitespace(Function.prototype.toString.call(fn));
    return CPR_UPDATE_COMBAT_MARKERS.every((marker) => source.includes(marker));
}

/**
 * Whether CPR's native `updateCombat` should be suppressed. For side-initiative
 * combats it is ALWAYS suppressed: CPR's per-current-combatant turn model is
 * incompatible with side initiative, and its native dispatch runs un-awaited from
 * the hook (overlapping the bridge's workflows and clobbering midi-qol's shared
 * target selection). The side-turn bridge owns `turnStart`/`turnEnd`/`everyTurn`
 * for every token on the active side instead. CPR's `updateCombat` only dispatches
 * macro passes (it early-returns unless the turn/round changed), so suppressing it
 * affects nothing else. Non-side combats are left untouched.
 */
function shouldSuppressCprUpdateCombat(combat: CombatLike | null | undefined): boolean {
    return isSideCombat(combat);
}

/**
 * Locate CPR's `updateCombat` hook handler in the Foundry registry and wrap it so
 * within-side turn changes are suppressed. The handler is found by source shape
 * (mirroring the Gambits OA source-marker approach) and wrapped in place by
 * mutating the registered `HookedFunction`'s `fn`. Idempotent. Returns false if
 * the handler cannot be found (e.g. CPR loaded later) — the side-turn bridge still
 * works without it; only the commander-switch dedup is lost.
 */
function wrapCprUpdateCombat(): boolean {
    if (integrationState.updateCombatWrapped) return true;
    const events = (globalThis as unknown as { Hooks?: { events?: Record<string, unknown[]> } }).Hooks?.events;
    const list = events?.["updateCombat"];
    if (!Array.isArray(list)) return false;

    for (let index = 0; index < list.length; index++) {
        const entry = list[index];
        const fn = typeof entry === "function" ? entry : (entry as { fn?: unknown })?.fn;
        if (!isCprUpdateCombatSource(fn)) continue;

        const original = fn as (...args: unknown[]) => unknown;
        const wrapped = async function cprUpdateCombatGuard(this: unknown, combat: unknown, ...rest: unknown[]): Promise<unknown> {
            if (shouldSuppressCprUpdateCombat(combat as CombatLike | null)) {
                debug(`CPR updateCombat SUPPRESSED (within-side switch) prev=${getCombatTurnRef(combat as CombatLike | null, "previous")?.combatantId ?? null} cur=${getCombatTurnRef(combat as CombatLike | null, "current")?.combatantId ?? null}`);
                return undefined;
            }
            debug(`CPR updateCombat native (cross-side/round) prev=${getCombatTurnRef(combat as CombatLike | null, "previous")?.combatantId ?? null} cur=${getCombatTurnRef(combat as CombatLike | null, "current")?.combatantId ?? null}`);
            return original.call(this, combat, ...rest);
        };
        if (typeof entry === "function") {
            list[index] = wrapped;
        } else {
            (entry as { fn: (...args: unknown[]) => unknown }).fn = wrapped;
        }
        integrationState.originalUpdateCombat = original;
        integrationState.wrappedUpdateCombat = wrapped;
        integrationState.updateCombatWrapped = true;
        return true;
    }
    return false;
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
    wrapCprUpdateCombat();

    if (validateCprShape()) {
        integrationState.status = "active";
        integrationState.reason = null;
        return;
    }

    // CPR populates `globalThis.chrisPremades` and registers its hooks during its
    // own ready (`cprReady`), which may run after this module's ready. Retry the
    // wrap then; the bridge re-checks the API shape on every fire regardless.
    integrationState.status = "inactive";
    integrationState.reason = "Chris' Premades API not yet available.";
    hooks()?.once("cprReady", () => {
        wrapCprUpdateCombat();
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
