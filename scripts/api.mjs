import {
    cloneSideStateForSave,
    ensureCombatantSideAssignments,
    getActiveSideId,
    getCombatState,
    getCombatantTurnIndex,
    getNextSideId,
    getOrderedSideIds,
    getSideRepresentativeCombatant,
    getSideSummary,
    isActorOnActiveSide,
    isCombatantOnActiveSide,
    isSideCombat,
    isTokenOnActiveSide,
    normalizeSideId,
    rollSideInitiativeData,
    setCombatState,
    setCombatantSide,
    setCombatantSideSource
} from "./logic.mjs";
import { MODULE_ID } from "./constants.mjs";

/**
 * @param {object | null | undefined} combat
 * @returns {object | null}
 */
function getCombatFromArgument(combat) {
    if (combat) return combat;
    return game?.combat ?? null;
}

/**
 * @param {object} combat
 * @param {object} state
 * @returns {Promise<object | null>}
 */
async function saveState(combat, state) {
    if (!combat) return null;
    const nextState = cloneSideStateForSave(state, combat.combatants);
    await setCombatState(combat, nextState);
    return nextState;
}

/**
 * @param {object} combat
 * @param {string} sideId
 * @param {{ roundDelta?: number }} [options]
 * @returns {Promise<object>}
 */
async function syncCombatToSide(combat, sideId, { roundDelta = 0 } = {}) {
    const normalizedSideId = normalizeSideId(sideId);
    const combatant = getSideRepresentativeCombatant(combat, normalizedSideId);
    const state = getCombatState(combat);
    const sideIds = getOrderedSideIds(combat);

    state.activeSideId = normalizedSideId;
    state.activeSideIndex = Math.max(0, sideIds.indexOf(normalizedSideId));
    state.activeCombatantId = combatant?.id ?? null;

    await setCombatState(combat, cloneSideStateForSave(state, combat.combatants));

    const updates = {};
    if (Number.isFinite(roundDelta) && roundDelta !== 0) {
        updates.round = Math.max(1, (combat.round ?? 1) + roundDelta);
    }
    if (combatant) {
        const turn = getCombatantTurnIndex(combat, combatant.id);
        if (turn >= 0) {
            updates.turn = turn;
        }
    }
    if (Object.keys(updates).length) {
        await combat.update(updates);
    }

    return state;
}

/**
 * @param {string | null} currentSideId
 * @param {string | null} nextSideId
 * @param {number} [direction]
 * @param {string[]} [sideIds]
 * @returns {number}
 */
function getNextRoundDelta(currentSideId, nextSideId, direction = 1, sideIds = []) {
    if (!sideIds.length) return 0;
    const currentIndex = Math.max(0, sideIds.indexOf(currentSideId));
    const nextIndex = Math.max(0, sideIds.indexOf(nextSideId));
    if (direction >= 0) {
        return nextIndex <= currentIndex ? 1 : 0;
    }
    return nextIndex >= currentIndex ? -1 : 0;
}

/**
 * Side initiative API surface.
 * @type {{
 *   MODULE_ID: string,
 *   refreshCombatantSides(combat?: object | null, options?: { overwrite?: boolean, groupByDisposition?: boolean }): Promise<object | null>,
 *   rollSideInitiative(combat?: object | null, options?: { random?: () => number }): Promise<object | null>,
 *   assignCombatantSide(combatant: object | null | undefined, sideId: string, options?: { source?: string }): Promise<string | null>,
 *   setActiveSide(combat?: object | null, sideId: string): Promise<object | null>,
 *   advanceSide(combat?: object | null, direction?: number): Promise<object | null>,
 *   getSideState(combat?: object | null): Array<object> | null,
 *   canCombatantAct(combatant: object | null | undefined, combat?: object | null): boolean,
 *   isSideCombat(combat?: object | null): boolean,
 *   isCombatantOnActiveSide(combatant: object | null | undefined, combat?: object | null): boolean,
 *   isActorOnActiveSide(actor: object | null | undefined, combat?: object | null): boolean,
 *   isTokenOnActiveSide(token: object | null | undefined, combat?: object | null): boolean
 * }}
 */
export const SideInitiativeAPI = {
    MODULE_ID,
    async refreshCombatantSides(combat = null, { overwrite = false, groupByDisposition = true } = {}) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat) return null;
        await ensureCombatantSideAssignments(resolvedCombat, { overwrite, groupByDisposition });
        const nextState = cloneSideStateForSave(getCombatState(resolvedCombat), resolvedCombat.combatants);
        await setCombatState(resolvedCombat, nextState);
        return nextState;
    },

    async rollSideInitiative(combat = null, { random = Math.random } = {}) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat) return null;

        await this.refreshCombatantSides(resolvedCombat);

        const state = getCombatState(resolvedCombat);
        const sideSummary = getSideSummary(resolvedCombat);
        const rollResult = rollSideInitiativeData(sideSummary, random);
        const nextState = {
            ...state,
            order: rollResult.order,
            lastRolls: Object.fromEntries(rollResult.rolls.map((side) => [side.id, side.roll])),
            lastRolledRound: resolvedCombat.round,
            activeSideId: rollResult.order[0] ?? null,
            activeSideIndex: 0,
            activeCombatantId: null,
            sides: {
                ...state.sides
            }
        };

        for (const side of rollResult.rolls) {
            nextState.sides[side.id] = {
                ...(nextState.sides[side.id] ?? side),
                ...side,
                combatantIds: side.combatantIds ?? nextState.sides[side.id]?.combatantIds ?? []
            };
        }

        await saveState(resolvedCombat, nextState);

        const updates = [];
        for (const side of rollResult.rolls) {
            for (const combatantId of side.combatantIds ?? []) {
                updates.push({
                    _id: combatantId,
                    initiative: side.roll
                });
            }
        }
        if (updates.length) {
            await resolvedCombat.updateEmbeddedDocuments("Combatant", updates);
        }

        const firstSide = rollResult.order[0];
        if (firstSide) {
            await syncCombatToSide(resolvedCombat, firstSide, { roundDelta: 0 });
        }

        return nextState;
    },

    async assignCombatantSide(combatant, sideId, { source = "manual" } = {}) {
        if (!combatant) return null;
        await setCombatantSide(combatant, sideId);
        await setCombatantSideSource(combatant, source);
        return sideId;
    },

    async setActiveSide(combat, sideId) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat) return null;
        const normalizedSideId = normalizeSideId(sideId);
        const state = getCombatState(resolvedCombat);
        state.activeSideId = normalizedSideId;
        state.activeSideIndex = Math.max(0, getOrderedSideIds(resolvedCombat).indexOf(normalizedSideId));
        state.activeCombatantId = getSideRepresentativeCombatant(resolvedCombat, normalizedSideId)?.id ?? null;
        await setCombatState(resolvedCombat, cloneSideStateForSave(state, resolvedCombat.combatants));
        await syncCombatToSide(resolvedCombat, normalizedSideId, { roundDelta: 0 });
        return state;
    },

    async advanceSide(combat, direction = 1) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat) return null;
        const currentSideId = getActiveSideId(resolvedCombat);
        const nextSideId = getNextSideId(resolvedCombat, direction);
        if (!nextSideId) return null;
        const ordered = getOrderedSideIds(resolvedCombat);
        const roundDelta = getNextRoundDelta(currentSideId, nextSideId, direction, ordered);
        const state = getCombatState(resolvedCombat);
        state.activeSideId = nextSideId;
        state.activeSideIndex = Math.max(0, ordered.indexOf(nextSideId));
        state.activeCombatantId = getSideRepresentativeCombatant(resolvedCombat, nextSideId)?.id ?? null;
        await setCombatState(resolvedCombat, cloneSideStateForSave(state, resolvedCombat.combatants));
        await syncCombatToSide(resolvedCombat, nextSideId, { roundDelta });
        return state;
    },

    getSideState(combat) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat) return null;
        return getSideSummary(resolvedCombat);
    },

    canCombatantAct(combatant, combat = null) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat || !combatant) return false;
        return !combatant.defeated;
    },

    isSideCombat(combat = null) {
        const resolvedCombat = getCombatFromArgument(combat);
        return isSideCombat(resolvedCombat);
    },

    isCombatantOnActiveSide(combatant, combat = null, options = {}) {
        const resolvedCombat = getCombatFromArgument(combat);
        return isCombatantOnActiveSide(resolvedCombat, combatant, options);
    },

    isActorOnActiveSide(actor, combat = null, options = {}) {
        const resolvedCombat = getCombatFromArgument(combat);
        return isActorOnActiveSide(actor, resolvedCombat, options);
    },

    isTokenOnActiveSide(token, combat = null, options = {}) {
        const resolvedCombat = getCombatFromArgument(combat);
        return isTokenOnActiveSide(token, resolvedCombat, options);
    }
};
