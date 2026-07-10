import {
    COMBATANT_SIDE_FLAG,
    COMBATANT_SIDE_SOURCE_FLAG,
    DEFAULT_SIDE_DATA,
    DEFAULT_SIDE_ORDER,
    FLAG_SCOPE,
    SIDE_STATE_FLAG,
} from "./constants.js";
import type {
    ActorLike,
    CombatLike,
    CombatState,
    CombatantLike,
    CombatantSource,
    CombatantsCollection,
    GroupMap,
    RandomFn,
    SideData,
    SideFilterOptions,
    SideGroupOptions,
    SideRollResult,
    TokenLike,
    UserLike,
    WorkflowLike,
} from "./types.js";

const COMBAT_STATE_VERSION = 2;

/**
 * Normalize a side identifier into a lowercase slug.
 */
export function normalizeSideId(value: unknown): string {
    const text = String(value ?? "")
        .trim()
        .toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "side";
}

/**
 * Determine whether a combatant is owned by at least one player.
 */
export function isPlayerOwnedCombatant(combatant: CombatantLike | null | undefined): boolean {
    return Boolean(
        combatant?.hasPlayerOwner ||
            combatant?.actor?.hasPlayerOwner ||
            combatant?.token?.actor?.hasPlayerOwner ||
            combatant?.document?.actor?.hasPlayerOwner,
    );
}

/**
 * Resolve the numeric disposition for a combatant.
 */
export function getCombatantDisposition(combatant: CombatantLike | null | undefined): number {
    const candidates = [
        combatant?.disposition,
        combatant?.token?.disposition,
        combatant?.token?.document?.disposition,
        combatant?.token?.object?.document?.disposition,
        combatant?.document?.disposition,
        combatant?.actor?.prototypeToken?.disposition,
    ];

    for (const value of candidates) {
        if (Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
}

/**
 * Derive a default side identifier for a combatant.
 */
export function defaultSideIdForCombatant(combatant: CombatantLike | null | undefined): string {
    if (!combatant) return "neutral";
    if (isPlayerOwnedCombatant(combatant)) return "players";
    const disposition = getCombatantDisposition(combatant);
    if (disposition > 0) return "allies";
    if (disposition < 0) return "monsters";
    return "neutral";
}

/**
 * Resolve the stored side id for a combatant.
 */
export function getCombatantSideId(
    combatant: CombatantLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): string {
    const stored = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG);
    if (stored) return normalizeSideId(stored);
    if (!groupByDisposition) return "neutral";
    return defaultSideIdForCombatant(combatant);
}

/**
 * Read the stored side initiative combat state from a combat document.
 */
export function getCombatState(combat: CombatLike | null | undefined): CombatState {
    const raw = combat?.getFlag?.(FLAG_SCOPE, SIDE_STATE_FLAG);
    return normalizeCombatState(raw as Partial<CombatState> | undefined);
}

/**
 * Normalize the persisted combat state shape.
 */
export function normalizeCombatState(raw: Partial<CombatState> | undefined = {}): CombatState {
    const state: CombatState = {
        version: COMBAT_STATE_VERSION,
        order: Array.isArray(raw?.order) ? raw!.order.map(normalizeSideId) : [],
        sides: raw?.sides && typeof raw.sides === "object" ? { ...raw.sides } : {},
        lastRolledRound: raw?.lastRolledRound ?? null,
        lastRolls: raw?.lastRolls && typeof raw.lastRolls === "object" ? { ...raw.lastRolls } : {},
        activeSideId: raw?.activeSideId ? normalizeSideId(raw.activeSideId) : null,
        activeSideIndex: Number.isInteger(raw?.activeSideIndex) ? raw!.activeSideIndex! : null,
        activeCombatantId: raw?.activeCombatantId ?? null,
        commanderIds: {},
    };

    if (raw?.commanderIds && typeof raw.commanderIds === "object") {
        for (const [sideId, combatantId] of Object.entries(raw.commanderIds)) {
            const normalizedSideId = normalizeSideId(sideId);
            if (typeof combatantId === "string" && combatantId) {
                state.commanderIds[normalizedSideId] = combatantId;
            } else if (
                combatantId &&
                typeof combatantId === "object" &&
                typeof (combatantId as { id?: unknown }).id === "string"
            ) {
                state.commanderIds[normalizedSideId] = (combatantId as { id: string }).id;
            }
        }
    }

    for (const [sideId, side] of Object.entries(state.sides)) {
        state.sides[normalizeSideId(sideId)] = normalizeSideData(sideId, side);
        if (normalizeSideId(sideId) !== sideId) {
            delete state.sides[sideId];
        }
    }

    state.order = [...new Set(state.order.filter(Boolean))];
    return state;
}

/**
 * Normalize a side record to the persisted side data shape.
 */
export function normalizeSideData(sideId: string, raw: Partial<SideData> = {}): SideData {
    const normalizedId = normalizeSideId(raw.id ?? sideId);
    const defaults = DEFAULT_SIDE_DATA[normalizedId] ?? {
        id: normalizedId,
        name: raw.name ?? normalizedId,
        color: raw.color ?? "#666666",
    };
    return {
        id: normalizedId,
        name: raw.name ?? defaults.name,
        color: raw.color ?? defaults.color,
        roll: Number.isFinite(raw.roll as number) ? (raw.roll as number) : null,
        combatantIds: Array.isArray(raw.combatantIds) ? [...raw.combatantIds] : [],
    };
}

/**
 * Ensure a combat state has ordered, populated side records.
 */
export function ensureCombatState(
    combat: CombatLike | null | undefined,
    state: Partial<CombatState> = {},
): CombatState {
    const normalized = normalizeCombatState(state);
    if (!normalized.order.length) {
        normalized.order = DEFAULT_SIDE_ORDER.filter(
            (sideId) => normalized.sides[sideId] || hasSideMembers(combat, sideId),
        );
    }
    if (!normalized.order.length) {
        normalized.order = DEFAULT_SIDE_ORDER.filter((sideId) => DEFAULT_SIDE_DATA[sideId]);
    }
    for (const sideId of normalized.order) {
        if (!normalized.sides[sideId]) {
            normalized.sides[sideId] = normalizeSideData(
                sideId,
                DEFAULT_SIDE_DATA[sideId] ?? { id: sideId, name: sideId },
            );
        }
    }
    return normalized;
}

/**
 * Read the stored side source for a combatant.
 */
export function getCombatantSideSource(combatant: CombatantLike | null | undefined): string | null {
    const stored = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG);
    return stored ? String(stored) : null;
}

/**
 * Resolve the combat turn order as an array of combatants.
 */
function getCombatTurnEntries(combat: CombatLike | null | undefined): CombatantLike[] {
    if (combat instanceof Map) return Array.from(combat.values());
    const turns = combat?.turns;
    if (Array.isArray(turns)) return turns;
    if (turns && Array.isArray((turns as CombatantsCollection).contents))
        return (turns as CombatantsCollection).contents as CombatantLike[];
    if (turns && typeof (turns as CombatantsCollection)[Symbol.iterator] === "function")
        return Array.from(turns as Iterable<CombatantLike>);

    const combatants = combat?.combatants;
    if (combatants && Array.isArray((combatants as CombatantsCollection).contents))
        return (combatants as CombatantsCollection).contents as CombatantLike[];
    if (combatants && typeof (combatants as CombatantsCollection).values === "function")
        return Array.from((combatants as CombatantsCollection).values!() as Iterable<CombatantLike>);
    if (combatants && typeof (combatants as CombatantsCollection)[Symbol.iterator] === "function")
        return Array.from(combatants as Iterable<CombatantLike>);
    return Array.from((combatants as Iterable<CombatantLike> | undefined) ?? []);
}

/**
 * Resolve combatant entries from a combat document or combatant collection.
 */
function getCombatantEntries(source: CombatantSource): CombatantLike[] {
    if (source instanceof Map) return Array.from(source.values());
    if (Array.isArray(source)) return source;
    const combatants = (source as CombatLike)?.combatants;
    if (combatants && Array.isArray((combatants as CombatantsCollection).contents))
        return (combatants as CombatantsCollection).contents as CombatantLike[];
    if (combatants && typeof (combatants as CombatantsCollection).values === "function")
        return Array.from((combatants as CombatantsCollection).values!() as Iterable<CombatantLike>);
    if (combatants && typeof (combatants as CombatantsCollection)[Symbol.iterator] === "function")
        return Array.from(combatants as Iterable<CombatantLike>);
    return Array.from((combatants as Iterable<CombatantLike> | undefined) ?? []);
}

/**
 * Resolve a combatant from an actor-like object.
 */
export function getCombatantFromActor(actor: ActorLike | null | undefined): CombatantLike | null {
    if (!actor) return null;
    const activeTokens = actor.getActiveTokens?.() ?? [];
    const activeToken = Array.isArray(activeTokens) ? activeTokens.find((token) => token?.combatant) : null;
    return (
        actor.combatant ?? activeToken?.combatant ?? actor.token?.combatant ?? actor.prototypeToken?.combatant ?? null
    );
}

/**
 * Determine whether a side contains any members.
 */
export function hasSideMembers(combat: CombatLike | null | undefined, sideId: string): boolean {
    const normalizedId = normalizeSideId(sideId);
    return getCombatantsForSide(combat, normalizedId).length > 0;
}

/**
 * Collect combatants for a side.
 */
export function getCombatantsForSide(
    combat: CombatLike | null | undefined,
    sideId: string,
    { includeDefeated = true, groupByDisposition = true }: SideFilterOptions = {},
): CombatantLike[] {
    const normalizedId = normalizeSideId(sideId);
    const combatants = getCombatantEntries(combat);
    return combatants.filter((combatant) => {
        if (!includeDefeated && combatant.defeated) return false;
        return getCombatantSideId(combatant, { groupByDisposition }) === normalizedId;
    });
}

/**
 * Determine whether a user owns at least one combatant on the given side.
 *
 * Unlike {@link isPlayerOwnedCombatant} (a user-agnostic flag), this performs a
 * per-user ownership test so it can authorize a specific player. Defeated
 * combatants never count toward membership.
 */
export function isUserOnSide(
    combat: CombatLike | null | undefined,
    sideId: string,
    user: UserLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): boolean {
    if (!combat || !user) return false;
    const normalizedId = normalizeSideId(sideId);
    const members = getCombatantsForSide(combat, normalizedId, { includeDefeated: false, groupByDisposition });
    return members.some((combatant) => {
        if (typeof combatant?.testUserPermission === "function") {
            return combatant.testUserPermission(user, "OWNER");
        }
        return Boolean(combatant?.isOwner);
    });
}

/**
 * Collect all side records present in the combat.
 */
export function collectCombatantSides(
    combat: CombatantSource,
    { groupByDisposition = true }: SideGroupOptions = {},
): Map<string, SideData> {
    const combatants = getCombatantEntries(combat);
    const sideMap = new Map<string, SideData>();

    for (const combatant of combatants) {
        const sideId = getCombatantSideId(combatant, { groupByDisposition });
        if (!sideMap.has(sideId)) {
            sideMap.set(sideId, normalizeSideData(sideId, DEFAULT_SIDE_DATA[sideId] ?? { id: sideId, name: sideId }));
        }
        const side = sideMap.get(sideId)!;
        if (!side.combatantIds) side.combatantIds = [];
        if (combatant.id) side.combatantIds.push(combatant.id);
    }

    return sideMap;
}

/**
 * Persist side assignments derived from combatant ownership and disposition.
 */
export async function ensureCombatantSideAssignments(
    combat: CombatLike | null | undefined,
    { overwrite = false, groupByDisposition = true }: { overwrite?: boolean } & SideGroupOptions = {},
): Promise<CombatLike | null | undefined> {
    const combatants = getCombatantEntries(combat);
    const updates: Promise<unknown>[] = [];

    for (const combatant of combatants) {
        const currentSideId = getCombatantSideId(combatant, { groupByDisposition });
        const currentSource = getCombatantSideSource(combatant);
        const hasExplicitSideFlag = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG) != null;
        const shouldUpdate = overwrite || currentSource === "auto" || (!currentSource && !hasExplicitSideFlag);
        if (!shouldUpdate) continue;

        const nextSideId = defaultSideIdForCombatant(combatant);
        if (normalizeSideId(currentSideId) !== normalizeSideId(nextSideId) || currentSource !== "auto") {
            updates.push(
                Promise.resolve(combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG, normalizeSideId(nextSideId))),
                Promise.resolve(combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG, "auto")),
            );
        }
    }

    await Promise.all(updates.filter(Boolean));
    return combat;
}

/**
 * Roll a single d20.
 */
export function rollDie(random: RandomFn = Math.random): number {
    return Math.floor(random() * 20) + 1;
}

/**
 * Resolve the XP value used to weight a combatant's initiative.
 */
function getCombatantXpValue(combatant: CombatantLike | null | undefined): number {
    const candidates = [
        combatant?.actor?.system?.details?.xp?.value,
        combatant?.actor?.system?.details?.xp,
        combatant?.token?.actor?.system?.details?.xp?.value,
        combatant?.token?.actor?.system?.details?.xp,
    ];

    for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") {
            const nested = Number(
                (candidate as { value?: unknown; xp?: unknown; total?: unknown }).value ??
                    (candidate as { xp?: unknown }).xp ??
                    (candidate as { total?: unknown }).total,
            );
            if (Number.isFinite(nested) && nested > 0) return nested;
        }

        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return value;
    }

    return 1;
}

/**
 * Determine the initiative weight for a combatant.
 */
export function getCombatantInitiativeWeight(combatant: CombatantLike | null | undefined): number {
    if (isPlayerOwnedCombatant(combatant)) return 1;
    return getCombatantXpValue(combatant);
}

/**
 * Roll initiative for each side and resolve ties.
 */
export function rollSideInitiativeData(
    sideEntries: Array<Partial<SideData> & { id: string }>,
    random: RandomFn = Math.random,
    { maxAttempts = 50 }: { maxAttempts?: number } = {},
): SideRollResult {
    const rolls = sideEntries.map((side) => ({
        ...normalizeSideData(side.id, side),
        roll: rollDie(random),
        tieBreaker: random(),
    }));

    let attempts = 0;
    while (attempts < maxAttempts) {
        const groups = groupBy(rolls, (entry) => entry.roll);
        const tiedGroups = [...groups.values()].filter((group) => group.length > 1);
        if (!tiedGroups.length) break;
        for (const group of tiedGroups) {
            for (const side of group) {
                side.roll = rollDie(random);
                side.tieBreaker = random();
            }
        }
        attempts += 1;
    }

    const fallbackUsed = attempts >= maxAttempts;
    const ordered = [...rolls].sort((a, b) => {
        if (b.roll !== a.roll) return b.roll - a.roll;
        if (b.tieBreaker !== a.tieBreaker) return b.tieBreaker - a.tieBreaker;
        return a.id.localeCompare(b.id);
    });

    return {
        rolls,
        order: ordered.map((side) => side.id),
        fallbackUsed,
    };
}

/**
 * Roll initiative for each side using weighted combatant averages.
 */
export function rollWeightedSideInitiativeData(
    sideEntries: Array<Partial<SideData> & { id: string; combatantIds?: string[] }>,
    initiativeByCombatantId: Record<string, number> = {},
    weightByCombatantId: Record<string, number> = {},
    random: RandomFn = Math.random,
): SideRollResult {
    const rolls = sideEntries.map((side) => {
        const combatantIds = Array.isArray(side.combatantIds) ? side.combatantIds : [];
        let totalWeight = 0;
        let weightedTotal = 0;

        for (const combatantId of combatantIds) {
            const initiative = Number(initiativeByCombatantId[combatantId]);
            const weight = Number(weightByCombatantId[combatantId]);
            const safeInitiative = Number.isFinite(initiative) ? initiative : 0;
            const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 1;
            totalWeight += safeWeight;
            weightedTotal += safeInitiative * safeWeight;
        }

        const roll = totalWeight > 0 ? Number((weightedTotal / totalWeight).toFixed(2)) : 0;
        return {
            ...normalizeSideData(side.id, side),
            combatantIds,
            roll,
            tieBreaker: random(),
        };
    });

    const ordered = [...rolls].sort((a, b) => {
        if (b.roll !== a.roll) return b.roll - a.roll;
        if (b.tieBreaker !== a.tieBreaker) return b.tieBreaker - a.tieBreaker;
        return a.id.localeCompare(b.id);
    });

    return {
        rolls,
        order: ordered.map((side) => side.id),
        fallbackUsed: false,
    };
}

/**
 * Group items by a derived key.
 */
export function groupBy<T>(items: T[], iteratee: (item: T) => string | number | symbol): GroupMap<T> {
    const map: GroupMap<T> = new Map();
    for (const item of items) {
        const key = iteratee(item);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
    }
    return map;
}

export function resolveSideByCombatant(
    combat: CombatLike | null | undefined,
    combatant: CombatantLike | null | undefined,
): SideData {
    const state = getCombatState(combat);
    return state.sides[getCombatantSideId(combatant)] ?? normalizeSideData(getCombatantSideId(combatant));
}

/**
 * Resolve the current combatant for the combat's turn index.
 */
export function getCurrentCombatant(combat: CombatLike | null | undefined): CombatantLike | null {
    if (!combat) return null;
    const combatant = combat.combatant ?? getCombatantAtTurn(combat, combat.turn);
    if (combatant) return combatant;
    const index = Number.isFinite(combat.turn) ? combat.turn : 0;
    return getCombatantAtTurn(combat, index ?? 0);
}

/**
 * Resolve a combatant at a turn index or combatant id.
 */
export function getCombatantAtTurn(
    combat: CombatLike | null | undefined,
    turn: number | string | undefined,
): CombatantLike | null {
    if (!combat) return null;
    const list = getCombatTurnEntries(combat);
    if (typeof turn === "string") {
        const resolved = list.find((combatant) =>
            typeof combatant === "string" ? combatant === turn : combatant?.id === turn,
        );
        if (resolved) return resolved;
        return combat.combatants && typeof (combat.combatants as CombatantsCollection).get === "function"
            ? (((combat.combatants as CombatantsCollection).get!(turn) as CombatantLike) ?? null)
            : null;
    }
    return list[Number(turn)] ?? null;
}

export function getActiveSideId(
    combat: CombatLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): string | null {
    const state = getCombatState(combat);
    if (state.activeSideId) return state.activeSideId;
    if (Number.isInteger(state.activeSideIndex) && state.order[state.activeSideIndex!]) {
        return state.order[state.activeSideIndex!];
    }
    const current = getCurrentCombatant(combat);
    if (current) {
        return getCombatantSideId(current, { groupByDisposition });
    }
    return state.order[0] ?? null;
}

export function getActiveSideIndex(
    combat: CombatLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): number {
    const state = getCombatState(combat);
    if (Number.isInteger(state.activeSideIndex)) {
        return Math.max(0, Math.min(state.activeSideIndex!, Math.max(state.order.length - 1, 0)));
    }
    const activeSideId = getActiveSideId(combat, { groupByDisposition });
    const index = state.order.indexOf(activeSideId ?? "");
    return index >= 0 ? index : 0;
}

export function getSideTone(sideId: string): string {
    const normalized = normalizeSideId(sideId);
    if (normalized === "monsters") return "hostile";
    if (normalized === "neutral") return "neutral";
    return "friendly";
}

export function getSideSummary(
    combat: CombatLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): SideData[] {
    const state = ensureCombatState(combat, getCombatState(combat));
    const discovered = collectCombatantSides(combat, { groupByDisposition });
    const order = [...new Set([...state.order, ...DEFAULT_SIDE_ORDER, ...discovered.keys()])];

    return order
        .filter((sideId) => discovered.has(sideId) || state.sides[sideId])
        .map((sideId): SideData => {
            const side =
                state.sides[sideId] ??
                normalizeSideData(sideId, discovered.get(sideId) ?? { id: sideId, name: sideId });
            const combatantIds = discovered.get(sideId)?.combatantIds ?? side.combatantIds ?? [];
            return {
                ...side,
                combatantIds,
                count: combatantIds.length,
                active: sideId === getActiveSideId(combat, { groupByDisposition }),
                commanderId: state.commanderIds?.[sideId] ?? null,
                tone: getSideTone(sideId),
            };
        });
}

export function getCombatantById(combat: CombatLike | null | undefined, id: string): CombatantLike | null {
    if (!combat) return null;
    if (combat.combatants && typeof (combat.combatants as CombatantsCollection).get === "function") {
        return ((combat.combatants as CombatantsCollection).get!(id) as CombatantLike) ?? null;
    }
    return (
        Array.from((combat.combatants as Iterable<CombatantLike> | undefined) ?? []).find((entry) => entry.id === id) ??
        null
    );
}

/**
 * Resolve the configured commander combatant id for a side.
 */
export function getSideCommanderId(combat: CombatLike | null | undefined, sideId: string): string | null {
    const state = getCombatState(combat);
    return state.commanderIds?.[normalizeSideId(sideId)] ?? null;
}

/**
 * Resolve the configured commander combatant for a side.
 */
export function getSideCommanderCombatant(
    combat: CombatLike | null | undefined,
    sideId: string,
    { groupByDisposition = true }: SideGroupOptions = {},
): CombatantLike | null {
    const normalizedId = normalizeSideId(sideId);
    const commanderId = getSideCommanderId(combat, normalizedId);
    if (!commanderId) return null;
    const commander = getCombatantById(combat, commanderId);
    if (!commander || commander.defeated) return null;
    return getCombatantSideId(commander, { groupByDisposition }) === normalizedId ? commander : null;
}

/**
 * Determine whether a combat currently has side initiative state.
 */
export function isSideCombat(combat: CombatLike | null | undefined): boolean {
    if (!combat) return false;
    const state = getCombatState(combat);
    if (
        state.activeSideId ||
        state.activeCombatantId ||
        state.order.length ||
        Object.keys(state.sides).length ||
        Object.keys(state.commanderIds).length
    ) {
        return true;
    }
    return Array.from((combat.combatants as Iterable<CombatantLike> | undefined) ?? []).some(
        (combatant) =>
            combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG) != null ||
            combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG) != null,
    );
}

export function getSideLabel(sideId: string): string {
    const normalizedId = normalizeSideId(sideId);
    return DEFAULT_SIDE_DATA[normalizedId]?.name ?? normalizedId;
}

export function getSideColor(sideId: string): string {
    const normalizedId = normalizeSideId(sideId);
    return DEFAULT_SIDE_DATA[normalizedId]?.color ?? "#666666";
}

/**
 * Pick the combatant with the highest initiative weight from a list. For
 * player-owned combatants the weight is always 1, so this only reorders NPC
 * sides — where the heaviest creature (highest XP/CR) is treated as the side's
 * de-facto leader. Ties keep the first occurrence, so ordering stays stable.
 */
function pickHighestWeightCombatant(combatants: CombatantLike[]): CombatantLike | null {
    let best: CombatantLike | null = null;
    let bestWeight = Number.NEGATIVE_INFINITY;
    for (const combatant of combatants) {
        if (!combatant) continue;
        const weight = getCombatantInitiativeWeight(combatant);
        if (weight > bestWeight) {
            bestWeight = weight;
            best = combatant;
        }
    }
    return best;
}

/**
 * Resolve a representative combatant for a side. The configured commander wins;
 * otherwise the highest-weight member leads (the strongest creature, not an
 * arbitrary first entry).
 */
export function getSideRepresentativeCombatant(
    combat: CombatLike | null | undefined,
    sideId: string,
    { groupByDisposition = true }: SideGroupOptions = {},
): CombatantLike | null {
    const normalizedId = normalizeSideId(sideId);
    const commander = getSideCommanderCombatant(combat, normalizedId, { groupByDisposition });
    if (commander) return commander;
    const turnMembers = getCombatTurnEntries(combat).filter((combatant) => {
        if (!combatant || combatant.defeated) return false;
        return getCombatantSideId(combatant, { groupByDisposition }) === normalizedId;
    });
    if (turnMembers.length) return pickHighestWeightCombatant(turnMembers) ?? turnMembers[0];

    const activeMembers = getCombatantsForSide(combat, sideId, { includeDefeated: false, groupByDisposition });
    if (activeMembers.length) return pickHighestWeightCombatant(activeMembers) ?? activeMembers[0];
    const allMembers = getCombatantsForSide(combat, sideId, { includeDefeated: true, groupByDisposition });
    return pickHighestWeightCombatant(allMembers) ?? allMembers[0] ?? null;
}

/**
 * Resolve a combatant's index in the combat turn order.
 */
export function getCombatantTurnIndex(combat: CombatLike | null | undefined, combatantId: string): number {
    const list = getCombatTurnEntries(combat);
    return list.findIndex((combatant) =>
        typeof combatant === "string" ? combatant === combatantId : combatant?.id === combatantId,
    );
}

export function getOrderedSideIds(
    combat: CombatLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): string[] {
    const state = ensureCombatState(combat, getCombatState(combat));
    const discovered = collectCombatantSides(combat, { groupByDisposition });
    return [...new Set([...state.order, ...DEFAULT_SIDE_ORDER, ...discovered.keys()])].filter(
        (sideId) => discovered.has(sideId) || state.sides[sideId],
    );
}

export function getNextSideId(
    combat: CombatLike | null | undefined,
    direction = 1,
    { groupByDisposition = true }: SideGroupOptions = {},
): string | null {
    const state = ensureCombatState(combat, getCombatState(combat));
    const sideIds = getOrderedSideIds(combat, { groupByDisposition });
    if (!sideIds.length) return null;

    const currentSideId = getActiveSideId(combat, { groupByDisposition });
    let index = sideIds.indexOf(currentSideId ?? "");
    if (index < 0) index = 0;

    const step = direction >= 0 ? 1 : -1;
    for (let visited = 0; visited < sideIds.length; visited += 1) {
        index = (index + step + sideIds.length) % sideIds.length;
        const sideId = sideIds[index];
        if (getCombatantsForSide(combat, sideId, { includeDefeated: false, groupByDisposition }).length) {
            return sideId;
        }
    }

    return state.order[index] ?? sideIds[index] ?? currentSideId ?? null;
}

export function getPreviousSideId(
    combat: CombatLike | null | undefined,
    options: SideGroupOptions = {},
): string | null {
    return getNextSideId(combat, -1, options);
}

export function cloneSideStateForSave(
    state: Partial<CombatState> | undefined,
    combatants: CombatantSource,
): CombatState {
    const sideMap = collectCombatantSides(combatants);
    const nextState = normalizeCombatState(state);
    const normalizedState = normalizeCombatState(state);
    nextState.sides = {};

    for (const [sideId, side] of sideMap.entries()) {
        const existing = state?.sides?.[sideId] ?? {};
        nextState.sides[sideId] = normalizeSideData(sideId, {
            ...DEFAULT_SIDE_DATA[sideId],
            ...existing,
            combatantIds: side.combatantIds,
        });
    }

    const combatantSideIds = new Map<string, string>();
    for (const [sideId, side] of sideMap.entries()) {
        for (const combatantId of side.combatantIds ?? []) {
            combatantSideIds.set(combatantId, sideId);
        }
    }

    nextState.commanderIds = {};
    for (const [sideId, combatantId] of Object.entries(normalizedState.commanderIds ?? {})) {
        const normalizedSideId = normalizeSideId(sideId);
        if (!combatantId) continue;
        if (combatantSideIds.get(combatantId) !== normalizedSideId) continue;
        nextState.commanderIds[normalizedSideId] = combatantId;
    }

    nextState.order = dedupeSideOrder([
        ...nextState.order,
        ...DEFAULT_SIDE_ORDER,
        ...Object.keys(nextState.sides),
    ]).filter((sideId) => nextState.sides[sideId]);
    return nextState;
}

export function dedupeSideOrder(order: string[]): string[] {
    return [...new Set(order.map(normalizeSideId))];
}

/**
 * Resolve the current combatant-side record.
 */
export function getCombatantSideRecord(
    combat: CombatLike | null | undefined,
    combatant: CombatantLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): SideData {
    const state = getCombatState(combat);
    const sideId = getCombatantSideId(combatant, { groupByDisposition });
    return state.sides[sideId] ?? normalizeSideData(sideId, DEFAULT_SIDE_DATA[sideId] ?? { id: sideId, name: sideId });
}

/**
 * Determine whether a combatant is off the active side.
 */
export function isOffSideWorkflow(
    combat: CombatLike | null | undefined,
    combatant: CombatantLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): boolean {
    const activeSideId = getActiveSideId(combat, { groupByDisposition });
    if (!activeSideId) return false;
    const sideId = getCombatantSideId(combatant, { groupByDisposition });
    return normalizeSideId(activeSideId) !== normalizeSideId(sideId);
}

/**
 * Determine whether a combatant is on the active side.
 */
export function isCombatantOnActiveSide(
    combat: CombatLike | null | undefined,
    combatant: CombatantLike | null | undefined,
    { groupByDisposition = true }: SideGroupOptions = {},
): boolean {
    const resolvedCombat = combat ?? (game?.combat as CombatLike | null) ?? null;
    if (!resolvedCombat || !resolvedCombat.started || !combatant) return false;
    return !isOffSideWorkflow(resolvedCombat, combatant, { groupByDisposition });
}

/**
 * Determine whether an actor is on the active side.
 */
export function isActorOnActiveSide(
    actor: ActorLike | null | undefined,
    combat: CombatLike | null | undefined = null,
    { groupByDisposition = true }: SideGroupOptions = {},
): boolean {
    const resolvedCombat = combat ?? (game?.combat as CombatLike | null) ?? null;
    if (!resolvedCombat || !resolvedCombat.started || !actor) return false;
    const combatant = getCombatantFromActor(actor);
    if (!combatant) return false;
    return isCombatantOnActiveSide(resolvedCombat, combatant, { groupByDisposition });
}

/**
 * Determine whether a token is on the active side.
 */
export function isTokenOnActiveSide(
    token: TokenLike | null | undefined,
    combat: CombatLike | null | undefined = null,
    { groupByDisposition = true }: SideGroupOptions = {},
): boolean {
    const resolvedCombat = combat ?? (game?.combat as CombatLike | null) ?? null;
    if (!resolvedCombat || !resolvedCombat.started || !token) return false;
    const combatant = resolveCombatantFromToken(token) ?? token?.document?.combatant ?? token?.actor?.combatant ?? null;
    if (combatant) return isCombatantOnActiveSide(resolvedCombat, combatant, { groupByDisposition });
    if (token?.actor) return isActorOnActiveSide(token.actor, resolvedCombat, { groupByDisposition });
    return false;
}

/**
 * Resolve a combatant from a token-like object.
 */
export function resolveCombatantFromToken(token: TokenLike | null | undefined): CombatantLike | null {
    return token?.combatant ?? token?.actor?.combatant ?? null;
}

/**
 * Resolve a combatant from a MidiQOL workflow-like object.
 */
export function getCombatantFromWorkflow(workflow: WorkflowLike | null | undefined): CombatantLike | null {
    const token = workflow?.token ?? workflow?.tokenDocument ?? workflow?.speaker?.token;
    if (token?.combatant) return token.combatant;
    if (workflow?.actor?.combatant) return workflow.actor.combatant;
    return resolveCombatantFromToken(token ?? null);
}

/**
 * Persist a combat state.
 */
export async function setCombatState(combat: CombatLike | null | undefined, state: CombatState): Promise<unknown> {
    const nextState = normalizeCombatState(state);
    return combat?.setFlag?.(FLAG_SCOPE, SIDE_STATE_FLAG, nextState);
}

/**
 * Persist a combatant side assignment.
 */
export async function setCombatantSide(combatant: CombatantLike | null | undefined, sideId: string): Promise<unknown> {
    return combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG, normalizeSideId(sideId));
}

/**
 * Persist a combatant side source.
 */
export async function setCombatantSideSource(
    combatant: CombatantLike | null | undefined,
    source: string,
): Promise<unknown> {
    return combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG, source);
}
