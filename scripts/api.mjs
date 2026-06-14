import {
    cloneSideStateForSave,
    ensureCombatantSideAssignments,
    getActiveSideId,
    getCombatState,
    getCombatantTurnIndex,
    getCombatantSideId,
    getNextSideId,
    getOrderedSideIds,
    getSideCommanderCombatant,
    getSideRepresentativeCombatant,
    getSideSummary,
    isActorOnActiveSide,
    isCombatantOnActiveSide,
    isSideCombat,
    isTokenOnActiveSide,
    normalizeSideId,
    rollWeightedSideInitiativeData,
    setCombatState,
    setCombatantSide,
    setCombatantSideSource,
    getCombatantInitiativeWeight
} from "./logic.mjs";
import { COMMANDER_CONTROL_OPTIONS, INITIATIVE_METHOD_OPTIONS, MODULE_ID, SETTINGS, SOCKET_EVENT } from "./constants.mjs";

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
 * Resolve combatant documents from a combat document.
 * @param {object | null | undefined} combat
 * @returns {Array<object>}
 */
function getCombatantEntries(combat) {
    const combatants = combat?.combatants;
    if (!combatants) return [];
    if (typeof combatants.values === "function") return Array.from(combatants.values());
    if (Array.isArray(combatants.contents)) return combatants.contents;
    if (typeof combatants[Symbol.iterator] === "function") return Array.from(combatants);
    return Array.from(combatants ?? []);
}

/**
 * Resolve the Roll class if Foundry provides it.
 * @returns {typeof import("../foundry/client/dice/roll.mjs").default | null}
 */
function getRollClass() {
    return globalThis.foundry?.dice?.Roll ?? null;
}

/**
 * Roll a single visible d20 for a side.
 * @param {object} side
 * @param {object} [options]
 * @returns {Promise<{ roll: number, tieBreaker: number }>}
 */
async function rollVisibleSideDie(side, options = {}) {
    const Roll = getRollClass();
    const rollMode = options.rollMode ?? globalThis.game?.settings?.get?.("core", "rollMode");
    const random = options.random ?? Math.random;

    if (!Roll?.create) {
        return {
            roll: Math.floor(random() * 20) + 1,
            tieBreaker: random()
        };
    }

    const roll = Roll.create("1d20");
    await roll.evaluate({ allowInteractive: rollMode !== globalThis.CONST?.DICE_ROLL_MODES?.BLIND });
    const speaker = globalThis.foundry?.documents?.ChatMessage?.implementation?.getSpeaker?.({ alias: side.name })
        ?? { alias: side.name };
    const flavor = globalThis.game?.i18n?.format?.("COMBAT.RollsInitiative", { name: side.name })
        ?? `${side.name} initiative`;
    await roll.toMessage({ speaker, flavor }, { rollMode });
    return {
        roll: Number.isFinite(roll.total) ? roll.total : 0,
        tieBreaker: random()
    };
}

/**
 * Roll side initiative using one d20 per side.
 * @param {object} resolvedCombat
 * @param {{ random?: () => number }} [options]
 * @returns {Promise<object | null>}
 */
async function rollStandardSideInitiative(resolvedCombat, { random = Math.random } = {}) {
    await SideInitiativeAPI.refreshCombatantSides(resolvedCombat);

    const sideSummary = getSideSummary(resolvedCombat);
    const rolls = [];
    for (const side of sideSummary) {
        rolls.push({
            ...side,
            ...(await rollVisibleSideDie(side, { rollMode: globalThis.game?.settings?.get?.("core", "rollMode"), random }))
        });
    }

    let attempts = 0;
    while (attempts < 50) {
        const groups = new Map();
        for (const entry of rolls) {
            const key = entry.roll;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(entry);
        }
        const tiedGroups = [...groups.values()].filter((group) => group.length > 1);
        if (!tiedGroups.length) break;
        for (const group of tiedGroups) {
            for (const side of group) {
                Object.assign(side, await rollVisibleSideDie(side, { rollMode: globalThis.game?.settings?.get?.("core", "rollMode"), random }));
            }
        }
        attempts += 1;
    }

    const ordered = [...rolls].sort((a, b) => {
        if (b.roll !== a.roll) return b.roll - a.roll;
        if (b.tieBreaker !== a.tieBreaker) return b.tieBreaker - a.tieBreaker;
        return a.id.localeCompare(b.id);
    });

    const state = getCombatState(resolvedCombat);
    const nextState = {
        ...state,
        order: ordered.map((side) => side.id),
        lastRolls: Object.fromEntries(rolls.map((side) => [side.id, side.roll])),
        lastRolledRound: resolvedCombat.round,
        activeSideId: ordered[0]?.id ?? null,
        activeSideIndex: 0,
        activeCombatantId: null,
        sides: {
            ...state.sides
        }
    };

    for (const side of rolls) {
        nextState.sides[side.id] = {
            ...(nextState.sides[side.id] ?? side),
            ...side,
            combatantIds: side.combatantIds ?? nextState.sides[side.id]?.combatantIds ?? []
        };
    }

    await saveState(resolvedCombat, nextState);

    const updates = [];
    for (const side of rolls) {
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

    const firstSide = ordered[0]?.id;
    if (firstSide) {
        await syncCombatToSide(resolvedCombat, firstSide, { roundDelta: 0 });
    }

    return nextState;
}

/**
 * Roll side initiative using weighted combatant averages.
 * @param {object} resolvedCombat
 * @param {{ random?: () => number, refresh?: boolean }} [options]
 * @returns {Promise<object | null>}
 */
async function rollWeightedSideInitiative(resolvedCombat, { random = Math.random, refresh = true } = {}) {
    if (refresh) {
        await SideInitiativeAPI.refreshCombatantSides(resolvedCombat);
    }

    if (globalThis.game?.user?.isGM) {
        const missing = getCombatantEntries(resolvedCombat).filter((combatant) => combatant?.id && !Number.isFinite(combatant.initiative));
        if (missing.length) {
            if (typeof resolvedCombat.rollAll === "function") {
                await resolvedCombat.rollAll({ updateTurn: false });
            } else if (typeof resolvedCombat.rollInitiative === "function") {
                await resolvedCombat.rollInitiative(missing.map((combatant) => combatant.id), { updateTurn: false });
            }
        }
    }

    const combatants = getCombatantEntries(resolvedCombat);
    const initiativeByCombatantId = {};
    const weightByCombatantId = {};

    for (const combatant of combatants) {
        if (!combatant?.id) continue;
        initiativeByCombatantId[combatant.id] = Number.isFinite(combatant.initiative) ? combatant.initiative : 0;
        weightByCombatantId[combatant.id] = getCombatantInitiativeWeight(combatant);
    }

    const state = getCombatState(resolvedCombat);
    const sideSummary = getSideSummary(resolvedCombat);
    const rollResult = rollWeightedSideInitiativeData(sideSummary, initiativeByCombatantId, weightByCombatantId, random);
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
 * Determine whether a user can control a combatant as a commander.
 * @param {object | null | undefined} combatant
 * @param {object | null | undefined} user
 * @returns {boolean}
 */
function canUserControlCombatant(combatant, user = game.user) {
    if (!combatant || !user) return false;
    if (user.isGM) return true;

    const commanderControl = game.settings?.get?.(MODULE_ID, SETTINGS.commanderControl);
    if (commanderControl === COMMANDER_CONTROL_OPTIONS.gmOnly) return false;

    if (typeof combatant.testUserPermission === "function") {
        return combatant.testUserPermission(user, "OWNER");
    }
    return Boolean(combatant.isOwner);
}

/**
 * Resolve the active GM user if one is available.
 * @returns {object | null}
 */
function getActiveGMUser() {
    return game.users?.activeGM ?? game.users?.getActiveGM?.() ?? Array.from(game.users?.contents ?? []).find((user) => user?.isGM && user?.active) ?? null;
}

/**
 * Determine whether this client should process GM-only socket requests.
 * @returns {boolean}
 */
function isActiveGMClient() {
    const activeGM = getActiveGMUser();
    if (activeGM) return activeGM.id === game.user?.id;
    return Boolean(game.user?.isGM);
}

/**
 * Handle a commander assignment socket request.
 * @param {{ module?: string, action?: string, combatId?: string, combatantId?: string, userId?: string }} message
 * @param {string | null} senderUserId
 * @returns {Promise<object | null>}
 */
export async function handleCommanderSocketRequest(message = {}, senderUserId = null) {
    if (message?.module !== MODULE_ID || message?.action !== "setCommander") return null;
    if (!game.user?.isGM || !isActiveGMClient()) return null;

    const combat = game.combats?.get?.(message.combatId) ?? (game.combat?.id === message.combatId ? game.combat : null);
    if (!combat) return null;

    const combatant = combat.combatants?.get?.(message.combatantId) ?? null;
    if (!combatant) return null;

    const requestingUser = game.users?.get?.(message.userId ?? senderUserId) ?? null;
    if (!requestingUser || !canUserControlCombatant(combatant, requestingUser)) return null;

    return SideInitiativeAPI.setSideCommander(combat, combatant);
}

/**
 * Side initiative API surface.
 * @type {{
  *   MODULE_ID: string,
  *   refreshCombatantSides(combat?: object | null, options?: { overwrite?: boolean, groupByDisposition?: boolean }): Promise<object | null>,
  *   rollSideInitiative(combat?: object | null, options?: { random?: () => number }): Promise<object | null>,
 *   rollWeightedSideInitiative(combat?: object | null, options?: { random?: () => number, refresh?: boolean }): Promise<object | null>,
   *   assignCombatantSide(combatant: object | null | undefined, sideId: string, options?: { source?: string }): Promise<string | null>,
 *   setSideCommander(combat: object | null | undefined, combatant: object | null | undefined): Promise<object | null>,
 *   requestSideCommander(combat: object | null | undefined, combatant: object | null | undefined): Promise<boolean>,
 *   getSideCommander(combat?: object | null, sideId?: string): object | null,
 *   canUserSetCommander(combatant: object | null | undefined, user?: object | null): boolean,
 *   canUserAdvanceSide(combat?: object | null, user?: object | null): boolean,
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
        const initiativeMethod = globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.initiativeMethod);
        if (initiativeMethod === INITIATIVE_METHOD_OPTIONS.weightedAverage) {
            return rollWeightedSideInitiative(resolvedCombat, { random, refresh: true });
        }
        return rollStandardSideInitiative(resolvedCombat, { random });
    },

    async rollWeightedSideInitiative(combat = null, { random = Math.random, refresh = true } = {}) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat) return null;
        return rollWeightedSideInitiative(resolvedCombat, { random, refresh });
    },

    async assignCombatantSide(combatant, sideId, { source = "manual" } = {}) {
        if (!combatant) return null;
        await setCombatantSide(combatant, sideId);
        await setCombatantSideSource(combatant, source);
        return sideId;
    },

    async setSideCommander(combat, combatant) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat || !combatant) return null;

        const sideId = getCombatantSideId(combatant);
        if (!sideId) return null;

        const state = getCombatState(resolvedCombat);
        state.commanderIds = {
            ...(state.commanderIds ?? {}),
            [normalizeSideId(sideId)]: combatant.id
        };

        await setCombatState(resolvedCombat, cloneSideStateForSave(state, resolvedCombat.combatants));

        if (getActiveSideId(resolvedCombat) === normalizeSideId(sideId)) {
            await syncCombatToSide(resolvedCombat, sideId, { roundDelta: 0 });
            return getCombatState(resolvedCombat);
        }

        return state;
    },

    async requestSideCommander(combat, combatant) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat || !combatant) return false;

        if (game.user?.isGM) {
            await this.setSideCommander(resolvedCombat, combatant);
            return true;
        }

        const activeGM = getActiveGMUser();
        if (!activeGM || !game.socket?.emit) {
            ui.notifications?.warn?.(game.i18n.localize("SIDE-INITIATIVE.Notifications.NoActiveGM"));
            return false;
        }

        game.socket?.emit?.(SOCKET_EVENT, {
            module: MODULE_ID,
            action: "setCommander",
            combatId: resolvedCombat.id,
            combatantId: combatant.id,
            userId: game.user?.id ?? null
        });
        return true;
    },

    getSideCommander(combat, sideId) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat) return null;
        return getSideCommanderCombatant(resolvedCombat, sideId);
    },

    canUserSetCommander(combatant, user = game.user) {
        return canUserControlCombatant(combatant, user);
    },

    canUserAdvanceSide(combat, user = game.user) {
        const resolvedCombat = getCombatFromArgument(combat);
        if (!resolvedCombat || !resolvedCombat.started || !isSideCombat(resolvedCombat)) return false;
        if (user?.isGM) return true;

        const activeSideId = getActiveSideId(resolvedCombat);
        if (!activeSideId) return false;
        const commander = getSideRepresentativeCombatant(resolvedCombat, activeSideId);
        if (!commander) return false;
        return canUserControlCombatant(commander, user);
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
