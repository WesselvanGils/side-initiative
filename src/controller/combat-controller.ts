import { SideInitiativeAPI } from "../api.js";
import { getCombatState, getOrderedSideIds } from "../logic.js";
import type { CombatLike } from "../types.js";

const PATCH_SYMBOL = Symbol.for("side-initiative.combat-patches");

/* The Foundry Combat class; prototype surgery below is intentionally dynamic. */
type CombatClass = any;

function getCombatClass(): CombatClass | null {
    return CONFIG?.Combat?.documentClass ?? Combat ?? null;
}

function isSideCombat(combat: CombatLike | null | undefined): boolean {
    const state = getCombatState(combat);
    return Boolean(state.activeSideId);
}

/**
 * Install combat turn patches for side initiative. When a combat is under side
 * control, Foundry's next/previous turn and next round methods are redirected
 * to the side initiative API.
 */
export function installCombatPatches(): void {
    const CombatClass = getCombatClass();
    if (!CombatClass || CombatClass.prototype[PATCH_SYMBOL]) return;

    const originalNextTurn = CombatClass.prototype.nextTurn;
    const originalPreviousTurn = CombatClass.prototype.previousTurn;
    const originalNextRound = CombatClass.prototype.nextRound;

    CombatClass.prototype.nextTurn = async function (this: CombatLike, ...args: unknown[]) {
        if (isSideCombat(this)) {
            if (!SideInitiativeAPI.canUserAdvanceSide(this)) return this;
            return SideInitiativeAPI.advanceSide(this, 1);
        }
        return originalNextTurn.apply(this, args);
    };

    CombatClass.prototype.previousTurn = async function (this: CombatLike, ...args: unknown[]) {
        if (isSideCombat(this)) {
            if (!SideInitiativeAPI.canUserAdvanceSide(this)) return this;
            return SideInitiativeAPI.advanceSide(this, -1);
        }
        return originalPreviousTurn.apply(this, args);
    };

    CombatClass.prototype.nextRound = async function (this: CombatLike, ...args: unknown[]) {
        if (isSideCombat(this)) {
            if (!SideInitiativeAPI.canUserAdvanceSide(this)) return this;
            const sideIds = getOrderedSideIds(this);
            if (!sideIds.length) return SideInitiativeAPI.advanceSide(this, 1);
            const firstSideId = sideIds[0]!;
            await SideInitiativeAPI.setActiveSide(this, firstSideId);
            await this.update?.({ round: Math.max(1, (this.round ?? 1) + 1) });
            return this;
        }
        return originalNextRound.apply(this, args);
    };

    CombatClass.prototype[PATCH_SYMBOL] = true;
}
