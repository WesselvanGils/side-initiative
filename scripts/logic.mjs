import {
    COMBATANT_SIDE_FLAG,
    COMBATANT_SIDE_SOURCE_FLAG,
    DEFAULT_SIDE_DATA,
    DEFAULT_SIDE_ORDER,
    FLAG_SCOPE,
    SIDE_STATE_FLAG
} from "./constants.mjs";

export function normalizeSideId(value) {
    const text = String(value ?? "").trim().toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "side";
}

export function isPlayerOwnedCombatant(combatant) {
    return Boolean(
        combatant?.hasPlayerOwner ||
        combatant?.actor?.hasPlayerOwner ||
        combatant?.token?.actor?.hasPlayerOwner ||
        combatant?.document?.actor?.hasPlayerOwner
    );
}

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

export function defaultSideIdForCombatant(combatant) {
    if (!combatant) return "neutral";
    if (isPlayerOwnedCombatant(combatant)) return "players";
    const disposition = getCombatantDisposition(combatant);
    if (disposition > 0) return "allies";
    if (disposition < 0) return "monsters";
    return "neutral";
}

export function getCombatantSideId(combatant, { groupByDisposition = true } = {}) {
    const stored = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG);
    if (stored) return normalizeSideId(stored);
    if (!groupByDisposition) return "neutral";
    return defaultSideIdForCombatant(combatant);
}

export function getCombatState(combat) {
    const raw = combat?.getFlag?.(FLAG_SCOPE, SIDE_STATE_FLAG);
    return normalizeCombatState(raw);
}

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

export function getCombatantSideSource(combatant) {
    const stored = combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG);
    return stored ? String(stored) : null;
}

export function hasSideMembers(combat, sideId) {
    const normalizedId = normalizeSideId(sideId);
    return getCombatantsForSide(combat, normalizedId).length > 0;
}

export function getCombatantsForSide(combat, sideId, { includeDefeated = true, groupByDisposition = true } = {}) {
    const normalizedId = normalizeSideId(sideId);
    const combatants = Array.from(combat?.combatants ?? []);
    return combatants.filter((combatant) => {
        if (!includeDefeated && combatant.defeated) return false;
        return getCombatantSideId(combatant, { groupByDisposition }) === normalizedId;
    });
}

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

export function rollDie(random = Math.random) {
    return Math.floor(random() * 20) + 1;
}

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

export function getCurrentCombatant(combat) {
    if (!combat) return null;
    const combatant = combat.combatant ?? getCombatantAtTurn(combat, combat.turn);
    if (combatant) return combatant;
    const index = Number.isFinite(combat.turn) ? combat.turn : 0;
    return getCombatantAtTurn(combat, index);
}

export function getCombatantAtTurn(combat, turn) {
    if (!combat) return null;
    if (combat.combatants?.get && typeof turn === "string") {
        return combat.combatants.get(turn) ?? null;
    }
    const list = Array.isArray(combat.combatants?.contents)
        ? combat.combatants.contents
        : Array.from(combat.combatants ?? []);
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

export function getSideRepresentativeCombatant(combat, sideId, { groupByDisposition = true } = {}) {
    const activeMembers = getCombatantsForSide(combat, sideId, { includeDefeated: false, groupByDisposition });
    if (activeMembers.length) return activeMembers[0];
    const allMembers = getCombatantsForSide(combat, sideId, { includeDefeated: true, groupByDisposition });
    return allMembers[0] ?? null;
}

export function getCombatantTurnIndex(combat, combatantId) {
    const list = Array.isArray(combat?.combatants)
        ? combat.combatants
        : Array.isArray(combat?.combatants?.contents)
            ? combat.combatants.contents
            : Array.from(combat?.combatants ?? []);
    return list.findIndex((combatant) => combatant.id === combatantId);
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

export function getCombatantSideRecord(combat, combatant, { groupByDisposition = true } = {}) {
    const state = getCombatState(combat);
    const sideId = getCombatantSideId(combatant, { groupByDisposition });
    return state.sides[sideId] ?? normalizeSideData(sideId, DEFAULT_SIDE_DATA[sideId] ?? { id: sideId, name: sideId });
}

export function isOffSideWorkflow(combat, combatant, { groupByDisposition = true } = {}) {
    const activeSideId = getActiveSideId(combat, { groupByDisposition });
    if (!activeSideId) return false;
    const sideId = getCombatantSideId(combatant, { groupByDisposition });
    return normalizeSideId(activeSideId) !== normalizeSideId(sideId);
}

export function resolveCombatantFromToken(token) {
    return token?.combatant ?? token?.actor?.combatant ?? null;
}

export function getCombatantFromWorkflow(workflow) {
    const token = workflow?.token ?? workflow?.tokenDocument ?? workflow?.speaker?.token;
    if (token?.combatant) return token.combatant;
    if (workflow?.actor?.combatant) return workflow.actor.combatant;
    return resolveCombatantFromToken(token);
}

export async function setCombatState(combat, state) {
    const nextState = normalizeCombatState(state);
    return combat?.setFlag?.(FLAG_SCOPE, SIDE_STATE_FLAG, nextState);
}

export async function setCombatantSide(combatant, sideId) {
    return combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_FLAG, normalizeSideId(sideId));
}

export async function setCombatantSideSource(combatant, source) {
    return combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_SIDE_SOURCE_FLAG, source);
}
