import { SideInitiativeAPI } from "../api.js";
import { getCombatState, getOrderedSideIds } from "../logic.js";
import type { CombatLike } from "../types.js";

const PATCH_SYMBOL = Symbol.for("side-initiative.combat-patches");

/* The Foundry Combat class; prototype surgery below is intentionally dynamic. */
type CombatMethod = (
	this: CombatLike,
	...args: unknown[]
) => Promise<unknown> | unknown;
type CombatPrototype = {
	nextTurn?: CombatMethod;
	previousTurn?: CombatMethod;
	nextRound?: CombatMethod;
	[PATCH_SYMBOL]?: boolean;
};
type CombatClass = { prototype: CombatPrototype };

function getCombatClass(): CombatClass | null {
	const CombatClass = CONFIG?.Combat?.documentClass ?? Combat ?? null;
	return (CombatClass as unknown as CombatClass | null) ?? null;
}

function isSideCombat(combat: CombatLike | null | undefined): boolean {
	const state = getCombatState(combat);
	return Boolean(state.activeSideId);
}

/**
 * Install combat turn patches for side initiative. When a combat is under side
 * control, Foundry's next/previous turn and next round methods are redirected
 * to the side initiative API.
 *
 * Foundry V13's `Combat#_canChangeTurn` always returns true by default, so
 * overriding it cannot grant players permission to advance a turn. Player
 * advancement is instead routed to the GM through `requestAdvanceSide`, which
 * delegates over the native socket; the patches below only redirect the turn
 * methods so they call that API.
 */
export function installCombatPatches(): void {
	const CombatClass = getCombatClass();
	if (!CombatClass || CombatClass.prototype[PATCH_SYMBOL]) return;

	const originalNextTurn = CombatClass.prototype.nextTurn;
	const originalPreviousTurn = CombatClass.prototype.previousTurn;
	const originalNextRound = CombatClass.prototype.nextRound;

	CombatClass.prototype.nextTurn = async function (
		this: CombatLike,
		...args: unknown[]
	) {
		if (isSideCombat(this)) {
			if (!SideInitiativeAPI.canUserAdvanceSide(this)) return this;
			await SideInitiativeAPI.requestAdvanceSide(this, 1);
			return this;
		}
		return originalNextTurn?.apply(this, args) ?? this;
	};

	CombatClass.prototype.previousTurn = async function (
		this: CombatLike,
		...args: unknown[]
	) {
		if (isSideCombat(this)) {
			if (!SideInitiativeAPI.canUserAdvanceSide(this)) return this;
			await SideInitiativeAPI.requestAdvanceSide(this, -1);
			return this;
		}
		return originalPreviousTurn?.apply(this, args) ?? this;
	};

	CombatClass.prototype.nextRound = async function (
		this: CombatLike,
		...args: unknown[]
	) {
		if (isSideCombat(this)) {
			if (!SideInitiativeAPI.canUserAdvanceSide(this)) return this;
			const sideIds = getOrderedSideIds(this);
			if (!sideIds.length) return SideInitiativeAPI.advanceSide(this, 1);
			const firstSideId = sideIds[0]!;
			await SideInitiativeAPI.setActiveSide(this, firstSideId);
			await this.update?.({ round: Math.max(1, (this.round ?? 1) + 1) });
			return this;
		}
		return originalNextRound?.apply(this, args) ?? this;
	};

	CombatClass.prototype[PATCH_SYMBOL] = true;
}
