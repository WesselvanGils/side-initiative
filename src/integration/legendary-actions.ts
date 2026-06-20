import {
    getActiveSideId,
    getCombatantFromActor,
    getCombatantFromWorkflow,
    getCombatantSideId,
    isActorOnActiveSide,
    isSideCombat
} from "../logic.js";
import { getSetting, hooks, isPrimaryGMClient } from "../runtime.js";
import type { ActorLike, CombatLike, CombatantLike, WorkflowLike } from "../types.js";
import { MODULE_ID, SETTINGS } from "../constants.js";

/**
 * Legendary Action Windows (LAW) — side-initiative compatibility bridge for
 * Chris' Premades (CPR) legendary actions.
 *
 * In standard combat CPR's legendary-action prompt fires on `preUpdateCombat`
 * with `options.direction === 1` (turn advance). Side initiative never produces
 * that event: `installCombatPatches` redirects `nextTurn` → `advanceSide` →
 * `combat.update({turn, round})` (no `direction`), and CPR's combat handler is
 * wrapped/suppressed for side combats. So CPR's prompt is dead in side combats.
 *
 * A Legendary Action Window opens whenever a creature on the active side
 * finishes an **Action**. At that moment the GM is prompted (driven through
 * CPR's own `DialogApp` + `workflowUtils.completeItemUse`) whether any opposing
 * legendary monster wants to spend a legendary action. Only Actions open a
 * window (bonus actions / reactions do not, to avoid prompt flooding). Extra
 * Attack is honoured: a weapon Attack action only opens a window once the actor
 * has made all of its expected attacks for that action.
 *
 * CPR does not expose its prompt function, but it does expose
 * `globalThis.chrisPremades.{DialogApp, utils}` — this bridge reuses those
 * utilities (shape-checked, not version-pinned) so the prompt and execution are
 * genuinely CPR's, just triggered at LAW moments and without the turn advance
 * CPR appends natively.
 */

interface LegendaryDocumentGroup {
    actor: ActorLike;
    items: any[];
}

interface LegendaryActionsIntegrationState {
    status: "inactive" | "active" | "unsupported" | "disabled";
    reason: string | null;
    registered: boolean;
    warnedKeys: Set<string>;
}

const integrationState: LegendaryActionsIntegrationState = {
    status: "inactive",
    reason: null,
    registered: false,
    warnedKeys: new Set()
};

/** Per-actor count of weapon attacks made since the last opened window. */
const attacksSinceLastWindow = new Map<string, number>();

/** Prevents stacked prompts while the GM is resolving a legendary window. */
let promptInProgress = false;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

function debug(...parts: unknown[]): void {
    if (!(globalThis as { SIDE_INITIATIVE_DEBUG_LAW?: boolean }).SIDE_INITIATIVE_DEBUG_LAW) return;
    console.log("[side-initiative/law]", ...parts);
}

function getCpr(): any | null {
    return (globalThis as { chrisPremades?: any }).chrisPremades ?? null;
}

function getCprModule(): { active?: boolean } | null {
    return game?.modules?.get?.("chris-premades") ?? null;
}

function getMidiModule(): { active?: boolean } | null {
    return game?.modules?.get?.("midi-qol") ?? null;
}

function isFeatureEnabled(): boolean {
    return Boolean(getSetting(MODULE_ID, SETTINGS.legendaryActionWindows));
}

export function getLegendaryActionsIntegrationState(): { status: string; reason: string | null } {
    return { status: integrationState.status, reason: integrationState.reason };
}

/**
 * Reset internal integration + detection state (tests / diagnostics).
 */
export function resetLegendaryActionsIntegrationState(): void {
    integrationState.status = "inactive";
    integrationState.reason = null;
    integrationState.registered = false;
    integrationState.warnedKeys.clear();
    attacksSinceLastWindow.clear();
    promptInProgress = false;
}

function warnOnce(key: string, message: string): void {
    if (integrationState.warnedKeys.has(key)) return;
    integrationState.warnedKeys.add(key);
    ui?.notifications?.warn?.(message);
}

function localize(key: string, fallback: string): string {
    const translated = game?.i18n?.localize?.(key);
    if (typeof translated === "string" && translated && translated !== key) return translated;
    return fallback;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for testing)                                */
/* ------------------------------------------------------------------ */

function normalizeFeatureText(value: unknown): string {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * How many attacks does one Attack action grant this actor? Base 1, plus any
 * Extra Attack feature on the sheet. dnd5e 4.x stores no per-attack state, so
 * the count is derived from feature names/identifiers: `Extra Attack` (1 extra
 * → 2), `Two Extra Attacks` (2 → 3), `Three Extra Attacks` (3 → 4). The highest
 * grant found wins. Returns 1 when the actor has no Extra Attack feature.
 */
export function getExpectedAttackCount(actor: ActorLike | null | undefined): number {
    let maxGrant = 0;
    for (const item of iterActorItems(actor)) {
        const grant = parseExtraAttackGrant(item?.name, item?.system?.identifier ?? item?.identifier);
        if (grant > maxGrant) maxGrant = grant;
    }
    return 1 + maxGrant;
}

function parseExtraAttackGrant(name: unknown, identifier: unknown): number {
    let best = 0;
    for (const value of [name, identifier]) {
        const text = normalizeFeatureText(value);
        if (!text.includes("extra attack")) continue;
        let grant = 1;
        for (const [word, count] of Object.entries(NUMBER_WORDS)) {
            if (text.startsWith(`${word} `)) {
                grant = count;
                break;
            }
        }
        if (grant > best) best = grant;
    }
    return best;
}

/**
 * Yield every item on an actor, handling CPR's `identifiedItems` (an iterable
 * of category iterables) and the standard flat `items` collection.
 */
function iterActorItems(actor: ActorLike | null | undefined): any[] {
    const out: any[] = [];
    if (!actor) return out;

    const identified = (actor as { identifiedItems?: any }).identifiedItems;
    if (identified && typeof identified[Symbol.iterator] === "function") {
        for (const group of identified) {
            if (group && typeof group[Symbol.iterator] === "function") {
                for (const item of group) out.push(item);
            } else {
                out.push(group);
            }
        }
    }

    const items = (actor as { items?: any }).items;
    if (items) {
        if (Array.isArray(items)) {
            out.push(...items);
        } else if (typeof items[Symbol.iterator] === "function") {
            for (const item of items) out.push(item);
        } else if (typeof items.forEach === "function") {
            items.forEach((item: any) => out.push(item));
        }
    }

    return out;
}

/**
 * Classify a completed activity for LAW purposes.
 *  - `triggers`: the activity is an Action (the only activation that opens a window).
 *  - `isAttack`: a weapon attack that counts toward an Attack action's Extra Attack budget.
 *    Attack-spells and non-attack actions are NOT counted (they open a window at once).
 */
export function classifyActionActivity(activity: any, item: any): { triggers: boolean; isAttack: boolean } {
    const activationType = activity?.activation?.type;
    const triggers = activationType === "action";
    if (!triggers) return { triggers: false, isAttack: false };
    const isWeapon = item?.type === "weapon" || item?.system?.type === "weapon";
    const isAttack = activity?.type === "attack" && isWeapon;
    return { triggers: true, isAttack };
}

function activitiesToArray(activities: any): any[] {
    if (!activities) return [];
    if (Array.isArray(activities)) return activities;
    if (Array.isArray(activities.contents)) return activities.contents;
    if (typeof activities[Symbol.iterator] === "function") return Array.from(activities as Iterable<any>);
    if (typeof activities.values === "function") return Array.from(activities.values() as Iterable<any>);
    return [];
}

function hasLegendaryActivity(item: any, legactValue: number): boolean {
    const activities = activitiesToArray(item?.system?.activities);
    return activities.some((activity) => {
        const isLegendary = activity?.activation?.type === "legendary"
            || activity?.consumption?.targets?.[0]?.target === "resources.legact.value";
        if (!isLegendary) return false;
        const cost = Number(activity?.activation?.value);
        return !Number.isFinite(cost) || legactValue >= cost;
    });
}

function resolveActor(combatant: CombatantLike | null | undefined): ActorLike | null {
    return combatant?.actor ?? combatant?.document?.actor ?? combatant?.token?.actor ?? null;
}

function listCombatants(combat: CombatLike | null | undefined): CombatantLike[] {
    const combatants = combat?.combatants;
    if (!combatants) return [];
    if (combatants instanceof Map) return Array.from((combatants as Map<string, CombatantLike>).values());
    if (Array.isArray(combatants)) return combatants as CombatantLike[];
    if (Array.isArray((combatants as { contents?: CombatantLike[] }).contents)) {
        return (combatants as { contents: CombatantLike[] }).contents;
    }
    if (typeof (combatants as { values?: unknown }).values === "function") {
        return Array.from((combatants as { values: () => Iterable<CombatantLike> }).values());
    }
    if (typeof (combatants as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function") {
        return Array.from(combatants as Iterable<CombatantLike>);
    }
    return [];
}

/**
 * Collect legendary-action candidates off the active side: non-defeated
 * combatants on an opposing side with legendary actions remaining
 * (`system.resources.legact.value > 0`) and at least one spendable legendary
 * item. Each group is `{ actor, items }`; groups with no qualifying item are
 * dropped so an empty prompt is never shown.
 */
export function getLegendaryActionDocuments(combat: CombatLike | null | undefined): LegendaryDocumentGroup[] {
    if (!combat) return [];
    const activeSideId = getActiveSideId(combat);
    if (!activeSideId) return [];

    const groups: LegendaryDocumentGroup[] = [];
    for (const combatant of listCombatants(combat)) {
        if (!combatant || combatant.defeated) continue;
        const sideId = getCombatantSideId(combatant);
        if (!sideId || sideId === activeSideId) continue;

        const actor = resolveActor(combatant);
        if (!actor) continue;
        const legact = (actor as { system?: { resources?: { legact?: { value?: unknown; max?: unknown } } } })
            ?.system?.resources?.legact;
        const legactValue = Number(legact?.value);
        if (!Number.isFinite(legactValue) || legactValue <= 0) continue;

        const items = iterActorItems(actor).filter((item) => hasLegendaryActivity(item, legactValue));
        if (!items.length) continue;

        groups.push({ actor, items });
    }

    return groups;
}

/* ------------------------------------------------------------------ */
/* Detection state                                                    */
/* ------------------------------------------------------------------ */

function actorKey(actor: ActorLike | null | undefined): string {
    return actor?.uuid ?? actor?.id ?? "";
}

function incrementAttackBurst(actor: ActorLike | null | undefined): number {
    const key = actorKey(actor);
    if (!key) return Infinity;
    const next = (attacksSinceLastWindow.get(key) ?? 0) + 1;
    attacksSinceLastWindow.set(key, next);
    return next;
}

function resetAttackBurst(actor: ActorLike | null | undefined): void {
    const key = actorKey(actor);
    if (key) attacksSinceLastWindow.delete(key);
}

function resetBurstState(): void {
    attacksSinceLastWindow.clear();
}

/* ------------------------------------------------------------------ */
/* Prompt + execution (CPR utilities)                                 */
/* ------------------------------------------------------------------ */

function validateLegendaryPromptShape(): boolean {
    const cpr = getCpr();
    const utils = cpr?.utils;
    return Boolean(
        typeof cpr?.DialogApp?.dialog === "function"
            && typeof utils?.workflowUtils?.completeItemUse === "function"
    );
}

/**
 * Present CPR's legendary-action dialog for the gathered documents and execute
 * the GM's selection via `workflowUtils.completeItemUse`, replicating CPR's
 * `prompt()` (`libs/chris-premades/scripts/extensions/combat.js:61-112`) but
 * without the trailing `game.combat.nextTurn()` (a LAW window must not advance
 * the side). Target selection uses CPR's `tokenUtils.findNearby` +
 * `dialogUtils.selectTargetDialog` when available; otherwise execution proceeds
 * without explicit targets.
 */
async function presentLegendaryActionPrompt(documents: LegendaryDocumentGroup[]): Promise<void> {
    const cpr = getCpr();
    const DialogApp = cpr?.DialogApp;
    const utils = cpr?.utils;
    if (typeof DialogApp?.dialog !== "function") {
        debug("CPR DialogApp.dialog unavailable; cannot prompt");
        return;
    }

    const flat = documents.flatMap((group) => group.items.map((item) => ({ item, actor: group.actor })));
    const isMultiple = documents.length > 1;

    const inputs = documents.map((group) => [
        isMultiple ? "checkbox" : "button",
        group.items.map((item) => ({
            label: `${item.name ?? ""} - ${item?.labels?.activation ?? ""}${isMultiple ? ` - ${group.actor?.name ?? ""}` : ""}`,
            name: item.id,
            options: { image: item.img }
        })),
        { displayAsRows: true, totalMax: 1 }
    ]);

    const title = localize("SIDE-INITIATIVE.LegendaryActionWindows.Prompt.Title", "Legendary Actions");
    let content = localize("SIDE-INITIATIVE.LegendaryActionWindows.Prompt.Content", "Use a legendary action?");
    for (const group of documents) {
        const value = (group.actor as { system?: { resources?: { legact?: { value?: unknown; max?: unknown } } } })
            ?.system?.resources?.legact?.value;
        const max = (group.actor as { system?: { resources?: { legact?: { value?: unknown; max?: unknown } } } })
            ?.system?.resources?.legact?.max;
        content += `<br>${group.actor?.name ?? ""} - ${value ?? 0}/${max ?? 0}`;
    }

    let result: any;
    try {
        result = await DialogApp.dialog(title, content, inputs, isMultiple ? "okCancel" : "cancel", { height: "auto" });
    } catch (error) {
        debug("legendary prompt dialog rejected:", error);
        return;
    }

    if (!result || !result.buttons) return;

    let ids: unknown[];
    if (Object.keys(result).length > 1) {
        ids = Object.entries(result)
            .filter(([key, value]) => key !== "buttons" && value !== false)
            .map(([key]) => key);
    } else {
        ids = Array.isArray(result.buttons) ? result.buttons : [result.buttons];
    }

    const chosen = flat.filter((entry) => ids.includes(entry.item.id));
    for (const entry of chosen) {
        await executeLegendaryAction(entry.item, entry.actor, utils);
    }
}

async function executeLegendaryAction(item: any, actor: ActorLike, utils: any): Promise<void> {
    if (typeof utils?.workflowUtils?.completeItemUse !== "function") {
        debug("CPR workflowUtils.completeItemUse unavailable; skipping", item?.name);
        return;
    }

    const activities = activitiesToArray(item?.system?.activities);
    const activityWithType = activities.find((activity) => activity?.type);
    const actionType = activityWithType?.type;
    const options: { targetUuids?: unknown[] } = {};

    const needsTarget = (["attack", "save"].includes(actionType) || activities.some((activity) => (activity?.target?.affects?.count ?? 0) > 0))
        && !activities.some((activity) => (activity?.target?.template?.count ?? 0) > 0);

    if (needsTarget) {
        const token = typeof utils?.actorUtils?.getFirstToken === "function" ? utils.actorUtils.getFirstToken(actor) : null;
        if (token && typeof utils?.tokenUtils?.findNearby === "function") {
            const range = item?.system?.range?.reach ?? item?.system?.range?.value ?? undefined;
            const disposition = ["attack", "save"].includes(actionType) ? "enemy" : undefined;
            const nearby = utils.tokenUtils.findNearby(token, range, disposition);
            let target: unknown;
            if (Array.isArray(nearby) && nearby.length > 1 && typeof utils?.dialogUtils?.selectTargetDialog === "function") {
                const picked = await utils.dialogUtils.selectTargetDialog(
                    localize("SIDE-INITIATIVE.LegendaryActionWindows.Target.Title", "Choose a Target"),
                    localize("SIDE-INITIATIVE.LegendaryActionWindows.Target.Content", "Target for legendary action: ") + `${item?.name ?? ""} - ${actor?.name ?? ""}`,
                    nearby,
                    { userId: game?.user?.id }
                );
                target = Array.isArray(picked) && picked[0] ? [picked[0]] : undefined;
            } else if (Array.isArray(nearby) && nearby.length === 1) {
                target = nearby;
            }
            if (target) {
                options.targetUuids = (target as any[]).map((entry) => entry?.document?.uuid ?? entry?.uuid);
            }
        }
    }

    await utils.workflowUtils.completeItemUse(item, {}, options);
}

/* ------------------------------------------------------------------ */
/* Window orchestration                                               */
/* ------------------------------------------------------------------ */

async function openLegendaryWindow(combat: CombatLike | null | undefined): Promise<void> {
    if (promptInProgress) {
        debug("legendary window already in progress; skipping");
        return;
    }
    if (!validateLegendaryPromptShape()) {
        warnOnce(
            "law-cpr-shape",
            localize(
                "SIDE-INITIATIVE.Notifications.LegendaryActionWindowsUnsupportedCpr",
                "Legendary Action Windows are disabled because the installed Chris' Premades API is not supported."
            )
        );
        integrationState.status = "unsupported";
        integrationState.reason = "CPR API shape not supported";
        return;
    }

    const documents = getLegendaryActionDocuments(combat);
    if (!documents.length) {
        debug("no legendary creatures can act; no window");
        return;
    }

    promptInProgress = true;
    try {
        await presentLegendaryActionPrompt(documents);
    } catch (error) {
        debug("legendary window failed:", error);
        console?.error?.(error);
    } finally {
        promptInProgress = false;
    }
}

/**
 * `midi-qol.RollComplete` handler. Fires on every completed activity; only
 * Actions on the active side open a window, and weapon attacks are buffered
 * until the actor's expected attack count is reached.
 */
async function onWorkflowComplete(workflow: WorkflowLike | null | undefined): Promise<void> {
    if (!isPrimaryGMClient()) return;
    if (!isFeatureEnabled()) return;

    const combat = (game?.combat as CombatLike | null) ?? null;
    if (!combat || !isSideCombat(combat) || !combat.started) return;

    const actor = workflow?.actor
        ?? (workflow as { item?: { actor?: ActorLike } })?.item?.actor
        ?? null;
    if (!actor) return;
    if (!isActorOnActiveSide(actor, combat)) return;

    const activity = (workflow as { activity?: any })?.activity;
    const item = (workflow as { item?: any })?.item;
    const { triggers, isAttack } = classifyActionActivity(activity, item);
    if (!triggers) return;

    // Keep counting attacks even while a prompt is open so a burst isn't lost,
    // but don't stack prompts.
    if (promptInProgress) {
        if (isAttack) incrementAttackBurst(actor);
        return;
    }

    if (!isAttack) {
        resetAttackBurst(actor);
        await openLegendaryWindow(combat);
        return;
    }

    const count = incrementAttackBurst(actor);
    const expected = getExpectedAttackCount(actor);
    debug(`attack burst ${count}/${expected} for ${actorKey(actor)}`);
    if (count >= expected) {
        resetAttackBurst(actor);
        await openLegendaryWindow(combat);
    }
}

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Register the Legendary Action Windows bridge. The detection hooks are
 * attached whenever Chris' Premades and MidiQOL are active; the per-fire
 * handler re-checks the setting so a GM can toggle the feature at runtime.
 */
export function registerLegendaryActionsIntegration(): void {
    if (integrationState.registered) return;

    if (!getCprModule()?.active || !getMidiModule()?.active) {
        // Only nag about missing dependencies when the GM actually enabled the feature.
        if (isFeatureEnabled()) {
            warnOnce(
                "law-deps",
                localize(
                    "SIDE-INITIATIVE.Notifications.LegendaryActionWindowsNeedsDeps",
                    "Legendary Action Windows are enabled, but require both Chris' Premades and MidiQOL to be active."
                )
            );
        }
        integrationState.status = "inactive";
        integrationState.reason = "Chris' Premades or MidiQOL not active";
        return;
    }

    integrationState.registered = true;
    integrationState.status = "active";
    integrationState.reason = null;

    hooks()?.on("midi-qol.RollComplete", (workflow: WorkflowLike) => onWorkflowComplete(workflow));
    hooks()?.on("side-initiative.sideTurnStart", () => {
        resetBurstState();
        return Promise.resolve();
    });
}
