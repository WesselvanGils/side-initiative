import {
    COMBATANT_SIDE_FLAG,
    COMBATANT_SIDE_SOURCE_FLAG,
    DEFAULT_SIDE_DATA,
    DEFAULT_SIDE_ORDER,
    FLAG_SCOPE,
    SIDE_STATE_FLAG
} from "./constants.mjs";

/**
 * @typedef {object} SideData
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {number | null} [roll]
 * @property {string[]} [combatantIds]
 * @property {number} [count]
 * @property {boolean} [active]
 * @property {string} [tone]
 */

/**
 * @typedef {object} CombatState
 * @property {number} version
 * @property {string[]} order
 * @property {Record<string, SideData>} sides
 * @property {number | null} lastRolledRound
 * @property {Record<string, number>} lastRolls
 * @property {string | null} activeSideId
 * @property {number | null} activeSideIndex
 * @property {string | null} activeCombatantId
 */

/**
 * @typedef {object} WorkflowLike
 * @property {object} [token]
 * @property {object} [tokenDocument]
 * @property {object} [speaker]
 * @property {object} [actor]
 */

/**
 * @typedef {object} CombatantLike
 * @property {string} [id]
 * @property {string} [name]
 * @property {boolean} [hasPlayerOwner]
 * @property {number} [disposition]
 * @property {boolean} [defeated]
 * @property {(scope: string, key: string) => unknown} [getFlag]
 * @property {(scope: string, key: string, value: unknown) => Promise<unknown>} [setFlag]
 * @property {object} [actor]
 * @property {object} [token]
 * @property {object} [document]
 * @property {object} [prototypeToken]
 */

/**
 * @typedef {object} ActorLike
 * @property {CombatantLike | null} [combatant]
 * @property {() => Array<{ combatant?: CombatantLike }>} [getActiveTokens]
 * @property {{ combatant?: CombatantLike }} [token]
 * @property {{ combatant?: CombatantLike }} [prototypeToken]
 */

/**
 * Normalize a side identifier into a lowercase slug.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSideId(value) {
    const text = String(value ?? "").trim().toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "side";
}

/**
 * Determine whether a combatant is owned by at least one player.
 * @param {CombatantLike | null | undefined} combatant
 * @returns {boolean}
 */
export function isPlayerOwnedCombatant(combatant) {
    return Boolean(
        combatant?.hasPlayerOwner ||
        combatant?.actor?.hasPlayerOwner ||
        combatant?.token?.actor?.hasPlayerOwner ||
        combatant?.document?.actor?.hasPlayerOwner
    );
}

/**
 * Resolve the numeric disposition for a combatant.
 * @param {CombatantLike | null | undefined} combatant
 * @returns {number}
 */
export function getCombatantDisposition(combatant) {
    const candidates = [
        combatant?.disposition,
        combatant?.token?.disposition,
        combatant?.token?.document?.disposition,
        combatant?.token?.object?.document?.disposition,
        combatant?.document?.disposition,
        combatant?.actor?.prototypeToken?.disposition
    ];

    for (const value of candidates) {
        if (Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
}

/**
 * Derive a default side identifier for a combatant.
 * @param {CombatantLike | null | undefined} combatant
 * @returns {string}
 */
export function defaultSideIdForCombatant(combatant) {
    if (!combatant) return "neutral";
    if (isPlayerOwnedCombatant(combatant)) return "players";
    const disposition = getCombatantDisposition(combatant);
    if (disposition > 0) return "allies";
    if (disposition < 0) return "monsters";
    return "neutral";
}

/**
 * Resolve the stored side id for a combatant.
 * @param {CombatantLike | null | undefined} combatant
 * @param {{ groupByDisposition?: boolean }} [options]
 * @returns {string}
 */
export function getCombatantSideId(combatant, { groupByDisposition = true } = {}) {
    const stored = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG);
    if (stored) return normalizeSideId(stored);
    if (!groupByDisposition) return "neutral";
    return defaultSideIdForCombatant(combatant);
}

/**
 * Read the stored side initiative combat state from a combat document.
 * @param {object | null | undefined} combat
 * @returns {CombatState}
 */
export function getCombatState(combat) {
    const raw = combat?.getFlag?.(FLAG_SCOPE, SIDE_STATE_FLAG);
    return normalizeCombatState(raw);
}

/**
 * Normalize the persisted combat state shape.
 * @param {Partial<CombatState> & Record<string, unknown>} [raw]
 * @returns {CombatState}
 */
export function normalizeCombatState(raw = {}) {
    const state = {
        version: 1,
        order: Array.isArray(raw?.order) ? raw.order.map(normalizeSideId) : [],
        sides: raw?.sides && typeof raw.sides === "object" ? { ...raw.sides } : {},
        lastRolledRound: raw?.lastRolledRound ?? null,
        lastRolls: raw?.lastRolls && typeof raw.lastRolls === "object" ? { ...raw.lastRolls } : {},
        activeSideId: raw?.activeSideId ? normalizeSideId(raw.activeSideId) : null,
        activeSideIndex: Number.isInteger(raw?.activeSideIndex) ? raw.activeSideIndex : null,
        activeCombatantId: raw?.activeCombatantId ?? null
    };

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
 * @param {string} sideId
 * @param {Partial<SideData> & Record<string, unknown>} [raw]
 * @returns {SideData}
 */
export function normalizeSideData(sideId, raw = {}) {
    const normalizedId = normalizeSideId(raw.id ?? sideId);
    const defaults = DEFAULT_SIDE_DATA[normalizedId] ?? {
        id: normalizedId,
        name: raw.name ?? normalizedId,
        color: raw.color ?? "#666666"
    };
    return {
        id: normalizedId,
        name: raw.name ?? defaults.name,
        color: raw.color ?? defaults.color,
        roll: Number.isFinite(raw.roll) ? raw.roll : null,
        combatantIds: Array.isArray(raw.combatantIds) ? [...raw.combatantIds] : []
    };
}

/**
 * Ensure a combat state has ordered, populated side records.
 * @param {object | null | undefined} combat
 * @param {Partial<CombatState> & Record<string, unknown>} [state]
 * @returns {CombatState}
 */
export function ensureCombatState(combat, state = {}) {
    const normalized = normalizeCombatState(state);
    if (!normalized.order.length) {
        normalized.order = DEFAULT_SIDE_ORDER.filter((sideId) => normalized.sides[sideId] || hasSideMembers(combat, sideId));
    }
    if (!normalized.order.length) {
        normalized.order = DEFAULT_SIDE_ORDER.filter((sideId) => DEFAULT_SIDE_DATA[sideId]);
    }
    for (const sideId of normalized.order) {
        if (!normalized.sides[sideId]) {
            normalized.sides[sideId] = normalizeSideData(sideId, DEFAULT_SIDE_DATA[sideId] ?? { id: sideId, name: sideId });
        }
    }
    return normalized;
}

/**
 * Read the stored side source for a combatant.
 * @param {CombatantLike | null | undefined} combatant
 * @returns {string | null}
 */
export function getCombatantSideSource(combatant) {
    const stored = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG);
    return stored ? String(stored) : null;
}

/**
 * Resolve the combat turn order as an array of combatants.
 * @param {object | null | undefined} combat
 * @returns {CombatantLike[]}
 */
function getCombatTurnEntries(combat) {
    const turns = combat?.turns;
    if (Array.isArray(turns)) return turns;
    if (Array.isArray(turns?.contents)) return turns.contents;
    if (typeof turns?.[Symbol.iterator] === "function") return Array.from(turns);

    const combatants = combat?.combatants;
    if (Array.isArray(combatants?.contents)) return combatants.contents;
    if (typeof combatants?.values === "function") return Array.from(combatants.values());
    if (typeof combatants?.[Symbol.iterator] === "function") return Array.from(combatants);
    return Array.from(combatants ?? []);
}

/**
 * Resolve a combatant from an actor-like object.
 * @param {ActorLike | null | undefined} actor
 * @returns {CombatantLike | null}
 */
export function getCombatantFromActor(actor) {
    if (!actor) return null;
    const activeTokens = actor.getActiveTokens?.() ?? [];
    const activeToken = Array.isArray(activeTokens) ? activeTokens.find((token) => token?.combatant) : null;
    return actor.combatant ?? activeToken?.combatant ?? actor.token?.combatant ?? actor.prototypeToken?.combatant ?? null;
}

/**
 * Determine whether a side contains any members.
 * @param {object | null | undefined} combat
 * @param {string} sideId
 * @returns {boolean}
 */
export function hasSideMembers(combat, sideId) {
    const normalizedId = normalizeSideId(sideId);
    return getCombatantsForSide(combat, normalizedId).length > 0;
}

/**
 * Collect combatants for a side.
 * @param {object | null | undefined} combat
 * @param {string} sideId
 * @param {{ includeDefeated?: boolean, groupByDisposition?: boolean }} [options]
 * @returns {CombatantLike[]}
 */
export function getCombatantsForSide(combat, sideId, { includeDefeated = true, groupByDisposition = true } = {}) {
    const normalizedId = normalizeSideId(sideId);
    const combatants = Array.from(combat?.combatants ?? []);
    return combatants.filter((combatant) => {
        if (!includeDefeated && combatant.defeated) return false;
        return getCombatantSideId(combatant, { groupByDisposition }) === normalizedId;
    });
}

/**
 * Collect all side records present in the combat.
 * @param {object | null | undefined} combat
 * @param {{ groupByDisposition?: boolean }} [options]
 * @returns {Map<string, SideData>}
 */
export function collectCombatantSides(combat, { groupByDisposition = true } = {}) {
    const combatants = Array.from(combat?.combatants ?? []);
    const sideMap = new Map();

    for (const combatant of combatants) {
        const sideId = getCombatantSideId(combatant, { groupByDisposition });
        if (!sideMap.has(sideId)) {
            sideMap.set(sideId, normalizeSideData(sideId, DEFAULT_SIDE_DATA[sideId] ?? { id: sideId, name: sideId }));
        }
        const side = sideMap.get(sideId);
        side.combatantIds.push(combatant.id);
    }

    return sideMap;
}

/**
 * Persist side assignments derived from combatant ownership and disposition.
 * @param {object | null | undefined} combat
 * @param {{ overwrite?: boolean, groupByDisposition?: boolean }} [options]
 * @returns {Promise<object | null | undefined>}
 */
export async function ensureCombatantSideAssignments(combat, { overwrite = false, groupByDisposition = true } = {}) {
    const combatants = Array.from(combat?.combatants ?? []);
    const updates = [];

    for (const combatant of combatants) {
        const currentSideId = getCombatantSideId(combatant, { groupByDisposition });
        const currentSource = getCombatantSideSource(combatant);
        const hasExplicitSideFlag = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG) != null;
        const shouldUpdate = overwrite || currentSource === "auto" || (!currentSource && !hasExplicitSideFlag);
        if (!shouldUpdate) continue;

        const nextSideId = defaultSideIdForCombatant(combatant);
        if (normalizeSideId(currentSideId) !== normalizeSideId(nextSideId) || currentSource !== "auto") {
            updates.push(
                combatant.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG, normalizeSideId(nextSideId)),
                combatant.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG, "auto")
            );
        }
    }

    await Promise.all(updates.filter(Boolean));
    return combat;
}

/**
 * Roll a single d20.
 * @param {() => number} [random]
 * @returns {number}
 */
export function rollDie(random = Math.random) {
    return Math.floor(random() * 20) + 1;
}

/**
 * Roll initiative for each side and resolve ties.
 * @param {Array<Partial<SideData> & { id: string }>} sideEntries
 * @param {() => number} [random]
 * @param {{ maxAttempts?: number }} [options]
 * @returns {{ rolls: Array<SideData & { roll: number, tieBreaker: number }>, order: string[], fallbackUsed: boolean }}
 */
export function rollSideInitiativeData(sideEntries, random = Math.random, { maxAttempts = 50 } = {}) {
    const rolls = sideEntries.map((side) => ({
        ...normalizeSideData(side.id, side),
        roll: rollDie(random),
        tieBreaker: random()
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
        fallbackUsed
    };
}

/**
 * Group items by a derived key.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string | number | symbol} iteratee
 * @returns {Map<string | number | symbol, T[]>}
 */
export function groupBy(items, iteratee) {
    const map = new Map();
    for (const item of items) {
        const key = iteratee(item);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    }
    return map;
}

export function resolveSideByCombatant(combat, combatant) {
    const state = getCombatState(combat);
    return state.sides[getCombatantSideId(combatant)] ?? normalizeSideData(getCombatantSideId(combatant));
}

/**
 * Resolve the current combatant for the combat's turn index.
 * @param {object | null | undefined} combat
 * @returns {CombatantLike | null}
 */
export function getCurrentCombatant(combat) {
    if (!combat) return null;
    const combatant = combat.combatant ?? getCombatantAtTurn(combat, combat.turn);
    if (combatant) return combatant;
    const index = Number.isFinite(combat.turn) ? combat.turn : 0;
    return getCombatantAtTurn(combat, index);
}

/**
 * Resolve a combatant at a turn index or combatant id.
 * @param {object | null | undefined} combat
 * @param {number | string} turn
 * @returns {CombatantLike | null}
 */
export function getCombatantAtTurn(combat, turn) {
    if (!combat) return null;
    const list = getCombatTurnEntries(combat);
    if (typeof turn === "string") {
        const resolved = list.find((combatant) => (typeof combatant === "string" ? combatant === turn : combatant?.id === turn));
        if (resolved) return resolved;
        return combat.combatants?.get?.(turn) ?? null;
    }
    return list[Number(turn)] ?? null;
}

export function getActiveSideId(combat, { groupByDisposition = true } = {}) {
    const state = getCombatState(combat);
    if (state.activeSideId) return state.activeSideId;
    if (Number.isInteger(state.activeSideIndex) && state.order[state.activeSideIndex]) {
        return state.order[state.activeSideIndex];
    }
    const current = getCurrentCombatant(combat);
    if (current) {
        return getCombatantSideId(current, { groupByDisposition });
    }
    return state.order[0] ?? null;
}

export function getActiveSideIndex(combat, { groupByDisposition = true } = {}) {
    const state = getCombatState(combat);
    if (Number.isInteger(state.activeSideIndex)) {
        return Math.max(0, Math.min(state.activeSideIndex, Math.max(state.order.length - 1, 0)));
    }
    const activeSideId = getActiveSideId(combat, { groupByDisposition });
    const index = state.order.indexOf(activeSideId);
    return index >= 0 ? index : 0;
}

export function getSideTone(sideId) {
    const normalized = normalizeSideId(sideId);
    if (normalized === "monsters") return "hostile";
    if (normalized === "neutral") return "neutral";
    return "friendly";
}

export function getSideSummary(combat, { groupByDisposition = true } = {}) {
    const state = ensureCombatState(combat, getCombatState(combat));
    const discovered = collectCombatantSides(combat, { groupByDisposition });
    const order = [...new Set([...state.order, ...DEFAULT_SIDE_ORDER, ...discovered.keys()])];

    return order
        .filter((sideId) => discovered.has(sideId) || state.sides[sideId])
        .map((sideId) => {
            const side = state.sides[sideId] ?? normalizeSideData(sideId, discovered.get(sideId) ?? { id: sideId, name: sideId });
            const combatantIds = discovered.get(sideId)?.combatantIds ?? side.combatantIds ?? [];
            return {
                ...side,
                combatantIds,
                count: combatantIds.length,
                active: sideId === getActiveSideId(combat, { groupByDisposition }),
                tone: getSideTone(sideId)
            };
        });
}

export function getCombatantById(combat, id) {
    if (!combat) return null;
    if (combat.combatants?.get) {
        return combat.combatants.get(id) ?? null;
    }
    return Array.from(combat.combatants ?? []).find((entry) => entry.id === id) ?? null;
}

export function getSideLabel(sideId) {
    const normalizedId = normalizeSideId(sideId);
    return DEFAULT_SIDE_DATA[normalizedId]?.name ?? normalizedId;
}

export function getSideColor(sideId) {
    const normalizedId = normalizeSideId(sideId);
    return DEFAULT_SIDE_DATA[normalizedId]?.color ?? "#666666";
}

/**
 * Resolve a representative combatant for a side.
 * @param {object | null | undefined} combat
 * @param {string} sideId
 * @param {{ groupByDisposition?: boolean }} [options]
 * @returns {CombatantLike | null}
 */
export function getSideRepresentativeCombatant(combat, sideId, { groupByDisposition = true } = {}) {
    const normalizedId = normalizeSideId(sideId);
    const turnMembers = getCombatTurnEntries(combat).filter((combatant) => {
        if (!combatant || combatant.defeated) return false;
        return getCombatantSideId(combatant, { groupByDisposition }) === normalizedId;
    });
    if (turnMembers.length) return turnMembers[0];

    const activeMembers = getCombatantsForSide(combat, sideId, { includeDefeated: false, groupByDisposition });
    if (activeMembers.length) return activeMembers[0];
    const allMembers = getCombatantsForSide(combat, sideId, { includeDefeated: true, groupByDisposition });
    return allMembers[0] ?? null;
}

/**
 * Resolve a combatant's index in the combat turn order.
 * @param {object | null | undefined} combat
 * @param {string} combatantId
 * @returns {number}
 */
export function getCombatantTurnIndex(combat, combatantId) {
    const list = getCombatTurnEntries(combat);
    return list.findIndex((combatant) => (typeof combatant === "string" ? combatant === combatantId : combatant?.id === combatantId));
}

export function getOrderedSideIds(combat, { groupByDisposition = true } = {}) {
    const state = ensureCombatState(combat, getCombatState(combat));
    const discovered = collectCombatantSides(combat, { groupByDisposition });
    return [...new Set([...state.order, ...DEFAULT_SIDE_ORDER, ...discovered.keys()])]
        .filter((sideId) => discovered.has(sideId) || state.sides[sideId]);
}

export function getNextSideId(combat, direction = 1, { groupByDisposition = true } = {}) {
    const state = ensureCombatState(combat, getCombatState(combat));
    const sideIds = getOrderedSideIds(combat, { groupByDisposition });
    if (!sideIds.length) return null;

    const currentSideId = getActiveSideId(combat, { groupByDisposition });
    let index = sideIds.indexOf(currentSideId);
    if (index < 0) index = 0;

    const step = direction >= 0 ? 1 : -1;
    for (let visited = 0; visited < sideIds.length; visited += 1) {
        index = (index + step + sideIds.length) % sideIds.length;
        const sideId = sideIds[index];
        if (getCombatantsForSide(combat, sideId, { includeDefeated: false, groupByDisposition }).length) {
            return sideId;
        }
    }

    return state.order[index] ?? sideIds[index] ?? currentSideId;
}

export function getPreviousSideId(combat, options = {}) {
    return getNextSideId(combat, -1, options);
}

export function cloneSideStateForSave(state, combatants) {
    const sideMap = collectCombatantSides(combatants);
    const nextState = normalizeCombatState(state);
    nextState.sides = {};

    for (const [sideId, side] of sideMap.entries()) {
        const existing = state?.sides?.[sideId] ?? {};
        nextState.sides[sideId] = normalizeSideData(sideId, {
            ...DEFAULT_SIDE_DATA[sideId],
            ...existing,
            combatantIds: side.combatantIds
        });
    }

    nextState.order = dedupeSideOrder([
        ...nextState.order,
        ...DEFAULT_SIDE_ORDER,
        ...Object.keys(nextState.sides)
    ]).filter((sideId) => nextState.sides[sideId]);
    return nextState;
}

export function dedupeSideOrder(order) {
    return [...new Set(order.map(normalizeSideId))];
}

/**
 * Resolve the current combatant-side record.
 * @param {object | null | undefined} combat
 * @param {CombatantLike | null | undefined} combatant
 * @param {{ groupByDisposition?: boolean }} [options]
 * @returns {SideData}
 */
export function getCombatantSideRecord(combat, combatant, { groupByDisposition = true } = {}) {
    const state = getCombatState(combat);
    const sideId = getCombatantSideId(combatant, { groupByDisposition });
    return state.sides[sideId] ?? normalizeSideData(sideId, DEFAULT_SIDE_DATA[sideId] ?? { id: sideId, name: sideId });
}

/**
 * Determine whether a combatant is off the active side.
 * @param {object | null | undefined} combat
 * @param {CombatantLike | null | undefined} combatant
 * @param {{ groupByDisposition?: boolean }} [options]
 * @returns {boolean}
 */
export function isOffSideWorkflow(combat, combatant, { groupByDisposition = true } = {}) {
    const activeSideId = getActiveSideId(combat, { groupByDisposition });
    if (!activeSideId) return false;
    const sideId = getCombatantSideId(combatant, { groupByDisposition });
    return normalizeSideId(activeSideId) !== normalizeSideId(sideId);
}

/**
 * Determine whether an actor is on the active side.
 * @param {ActorLike | null | undefined} actor
 * @param {object | null | undefined} combat
 * @param {{ groupByDisposition?: boolean }} [options]
 * @returns {boolean}
 */
export function isActorOnActiveSide(actor, combat = null, { groupByDisposition = true } = {}) {
    const resolvedCombat = combat ?? globalThis.game?.combat ?? null;
    if (!resolvedCombat || !resolvedCombat.started || !actor) return false;
    const combatant = getCombatantFromActor(actor);
    if (!combatant) return false;
    return !isOffSideWorkflow(resolvedCombat, combatant, { groupByDisposition });
}

/**
 * Resolve a combatant from a token-like object.
 * @param {object | null | undefined} token
 * @returns {CombatantLike | null}
 */
export function resolveCombatantFromToken(token) {
    return token?.combatant ?? token?.actor?.combatant ?? null;
}

/**
 * Resolve a combatant from a MidiQOL workflow-like object.
 * @param {WorkflowLike | null | undefined} workflow
 * @returns {CombatantLike | null}
 */
export function getCombatantFromWorkflow(workflow) {
    const token = workflow?.token ?? workflow?.tokenDocument ?? workflow?.speaker?.token;
    if (token?.combatant) return token.combatant;
    if (workflow?.actor?.combatant) return workflow.actor.combatant;
    return resolveCombatantFromToken(token);
}

/**
 * Persist a combat state.
 * @param {object | null | undefined} combat
 * @param {CombatState} state
 * @returns {Promise<unknown>}
 */
export async function setCombatState(combat, state) {
    const nextState = normalizeCombatState(state);
    return combat?.setFlag?.(FLAG_SCOPE, SIDE_STATE_FLAG, nextState);
}

/**
 * Persist a combatant side assignment.
 * @param {CombatantLike | null | undefined} combatant
 * @param {string} sideId
 * @returns {Promise<unknown>}
 */
export async function setCombatantSide(combatant, sideId) {
    return combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG, normalizeSideId(sideId));
}

/**
 * Persist a combatant side source.
 * @param {CombatantLike | null | undefined} combatant
 * @param {string} source
 * @returns {Promise<unknown>}
 */
export async function setCombatantSideSource(combatant, source) {
    return combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG, source);
}
