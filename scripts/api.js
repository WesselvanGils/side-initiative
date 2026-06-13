import {
  cloneSideStateForSave,
  getCombatState,
  getSideSummary,
  normalizeSideId,
  rollSideInitiativeData,
  setCombatState,
  setCombatantActedRound,
  setCombatantSide
} from "./logic.js";
import { MODULE_ID } from "./constants.js";

function getCombatFromArgument(combat) {
  if (combat) return combat;
  return game?.combat ?? null;
}

function getCombatantList(combat) {
  if (!combat) return [];
  if (Array.isArray(combat.combatants)) return combat.combatants;
  if (Array.isArray(combat.combatants?.contents)) return combat.combatants.contents;
  return Array.from(combat.combatants ?? []);
}

async function saveState(combat, state) {
  if (!combat) return null;
  const nextState = cloneSideStateForSave(state, combat.combatants);
  await setCombatState(combat, nextState);
  return nextState;
}

export const SideInitiativeAPI = {
  MODULE_ID,
  async rollSideInitiative(combat = null, { random = Math.random } = {}) {
    const resolvedCombat = getCombatFromArgument(combat);
    if (!resolvedCombat) return null;

    const state = getCombatState(resolvedCombat);
    const sideSummary = getSideSummary(resolvedCombat);
    const rollResult = rollSideInitiativeData(sideSummary, random);
    const nextState = {
      ...state,
      order: rollResult.order,
      lastRolls: Object.fromEntries(rollResult.rolls.map((side) => [side.id, side.roll])),
      lastRolledRound: resolvedCombat.round,
      activeSideId: rollResult.order[0] ?? null,
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

    const combatantList = getCombatantList(resolvedCombat);
    if (combatantList.length) {
      const firstSide = rollResult.order[0];
      const firstCombatantId = nextState.sides[firstSide]?.combatantIds?.[0];
      if (firstCombatantId != null) {
        const firstIndex = combatantList.findIndex((combatant) => combatant.id === firstCombatantId);
        if (firstIndex >= 0) {
          await resolvedCombat.update({ turn: firstIndex, round: resolvedCombat.round });
        }
      }
    }

    return nextState;
  },

  async assignCombatantSide(combatant, sideId) {
    return setCombatantSide(combatant, sideId);
  },

  async markActed(combatant, round = null) {
    if (!combatant) return null;
    const currentRound = round ?? combatant.parent?.round ?? game?.combat?.round ?? 0;
    return setCombatantActedRound(combatant, currentRound);
  },

  async setActiveSide(combat, sideId) {
    const resolvedCombat = getCombatFromArgument(combat);
    if (!resolvedCombat) return null;
    const normalizedSideId = normalizeSideId(sideId);
    const state = getCombatState(resolvedCombat);
    state.activeSideId = normalizedSideId;
    const saved = await saveState(resolvedCombat, state);
    const combatantIds = saved?.sides?.[normalizedSideId]?.combatantIds ?? [];
    const targetCombatantId = combatantIds[0];
    if (targetCombatantId != null) {
      const index = getCombatantList(resolvedCombat).findIndex((combatant) => combatant.id === targetCombatantId);
      if (index >= 0) {
        await resolvedCombat.update({ turn: index });
      }
    }
    return saved;
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
  }
};
