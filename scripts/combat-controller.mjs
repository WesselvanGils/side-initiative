import { SideInitiativeAPI } from "./api.mjs";
import { getCombatState, getOrderedSideIds } from "./logic.mjs";

const PATCH_SYMBOL = Symbol.for("side-initiative.combat-patches");

/**
 * @returns {Function | null}
 */
function getCombatClass() {
    return globalThis.CONFIG?.Combat?.documentClass ?? globalThis.Combat ?? null;
}

/**
 * @param {object | null | undefined} combat
 * @returns {boolean}
 */
function isSideCombat(combat) {
    const state = getCombatState(combat);
    return Boolean(state.activeSideId);
}

/**
 * Install combat turn patches for side initiative.
 * @returns {void}
 */
export function installCombatPatches() {
    const CombatClass = getCombatClass();
    if (!CombatClass || CombatClass.prototype[PATCH_SYMBOL]) return;

    const originalNextTurn = CombatClass.prototype.nextTurn;
    const originalPreviousTurn = CombatClass.prototype.previousTurn;
    const originalNextRound = CombatClass.prototype.nextRound;

    CombatClass.prototype.nextTurn = async function (...args) {
        if (isSideCombat(this)) {
            return SideInitiativeAPI.advanceSide(this, 1);
        }
        return originalNextTurn.apply(this, args);
    };

    CombatClass.prototype.previousTurn = async function (...args) {
        if (isSideCombat(this)) {
            return SideInitiativeAPI.advanceSide(this, -1);
        }
        return originalPreviousTurn.apply(this, args);
    };

    CombatClass.prototype.nextRound = async function (...args) {
        if (isSideCombat(this)) {
            const sideIds = getOrderedSideIds(this);
            if (!sideIds.length) return SideInitiativeAPI.advanceSide(this, 1);
            const firstSideId = sideIds[0];
            await SideInitiativeAPI.setActiveSide(this, firstSideId);
            await this.update({ round: Math.max(1, (this.round ?? 1) + 1) });
            return this;
        }
        return originalNextRound.apply(this, args);
    };

    CombatClass.prototype[PATCH_SYMBOL] = true;
}
