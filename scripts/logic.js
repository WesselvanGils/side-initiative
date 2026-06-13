import {
  COMBATANT_ACTED_ROUND_FLAG,
  COMBATANT_SIDE_FLAG,
  DEFAULT_SIDE_DATA,
  DEFAULT_SIDE_ORDER,
  FLAG_SCOPE,
  MODULE_ID,
  SIDE_STATE_FLAG
} from "./constants.js";

export function normalizeSideId(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "side";
}

export function defaultSideIdForCombatant(combatant) {
  if (!combatant) return "neutral";
  if (combatant.hasPlayerOwner) return "players";
  const disposition = Number(combatant.disposition ?? combatant.token?.disposition ?? 0);
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
    activeSideId: raw?.activeSideId ? normalizeSideId(raw.activeSideId) : null
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
  const current = getCurrentCombatant(combat);
  if (current) {
    return getCombatantSideId(current, { groupByDisposition });
  }
  const state = getCombatState(combat);
  return state.order[0] ?? null;
}

export function getCombatantActedRound(combatant) {
  return combatant?.getFlag?.(FLAG_SCOPE, COMBATANT_ACTED_ROUND_FLAG) ?? null;
}

export function hasCombatantActedThisRound(combatant, combat) {
  if (!combatant || !combat) return false;
  return getCombatantActedRound(combatant) === combat.round;
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
        active: sideId === getActiveSideId(combat, { groupByDisposition }),
        acted: combatantIds.every((id) => hasCombatantActedThisRound(getCombatantById(combat, id), combat))
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

export async function setCombatantActedRound(combatant, round) {
  return combatant?.setFlag?.(FLAG_SCOPE, COMBATANT_ACTED_ROUND_FLAG, round);
}
