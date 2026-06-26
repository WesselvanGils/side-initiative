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
	isUserOnSide,
	normalizeSideId,
	rollWeightedSideInitiativeData,
	setCombatState,
	setCombatantSide,
	setCombatantSideSource,
	getCombatantInitiativeWeight,
} from "./logic.js";
import {
	getConst,
	getFoundry,
	getSideInitiative,
	getSetting,
	hooks,
	isActiveGMClient,
} from "./runtime.js";
import type {
	CombatLike,
	CombatState,
	CombatantLike,
	RandomFn,
	SideData,
	SideTurnPayload,
	TokenLike,
	UserLike,
} from "./types.js";
import {
	COMMANDER_CONTROL_OPTIONS,
	INITIATIVE_METHOD_OPTIONS,
	MODULE_ID,
	SETTINGS,
} from "./constants.js";

/** Options for {@link SideInitiativeApi.refreshCombatantSides}. */
export interface RefreshCombatantSidesOptions {
	overwrite?: boolean;
	groupByDisposition?: boolean;
}

/** Options for {@link SideInitiativeApi.rollSideInitiative}. */
export interface RollSideInitiativeOptions {
	random?: RandomFn;
}

/** Options for {@link SideInitiativeApi.rollWeightedSideInitiative}. */
export interface RollWeightedSideInitiativeOptions {
	random?: RandomFn;
	refresh?: boolean;
}

/** Options for {@link SideInitiativeApi.assignCombatantSide}. */
export interface AssignCombatantSideOptions {
	source?: string;
}

/** Public surface exposed as `game.sideInitiative`. */
export interface SideInitiativeApi {
	readonly MODULE_ID: string;
	refreshCombatantSides(
		combat?: CombatLike | null,
		options?: RefreshCombatantSidesOptions,
	): Promise<CombatState | null>;
	rollSideInitiative(
		combat?: CombatLike | null,
		options?: RollSideInitiativeOptions,
	): Promise<CombatState | null>;
	rollWeightedSideInitiative(
		combat?: CombatLike | null,
		options?: RollWeightedSideInitiativeOptions,
	): Promise<CombatState | null>;
	assignCombatantSide(
		combatant: CombatantLike | null | undefined,
		sideId: string,
		options?: AssignCombatantSideOptions,
	): Promise<string | null>;
	setSideCommander(
		combat: CombatLike | null | undefined,
		combatant: CombatantLike | null | undefined,
	): Promise<CombatState | null>;
	requestSideCommander(
		combat: CombatLike | null | undefined,
		combatant: CombatantLike | null | undefined,
	): Promise<boolean>;
	requestAdvanceSide(
		combat: CombatLike | null | undefined,
		direction?: number,
	): Promise<boolean>;
	getSideCommander(
		combat?: CombatLike | null,
		sideId?: string,
	): CombatantLike | null;
	canUserSetCommander(
		combatant: CombatantLike | null | undefined,
		user?: UserLike | null,
		combat?: CombatLike | null,
	): boolean;
	canUserAdvanceSide(
		combat?: CombatLike | null,
		user?: UserLike | null,
	): boolean;
	setActiveSide(
		combat: CombatLike | null | undefined,
		sideId: string,
	): Promise<CombatState | null>;
	advanceSide(
		combat: CombatLike | null | undefined,
		direction?: number,
	): Promise<CombatState | null>;
	getSideState(combat?: CombatLike | null): SideData[] | null;
	canCombatantAct(
		combatant: CombatantLike | null | undefined,
		combat?: CombatLike | null,
	): boolean;
	isSideCombat(combat?: CombatLike | null): boolean;
	isCombatantOnActiveSide(
		combatant: CombatantLike | null | undefined,
		combat?: CombatLike | null,
		options?: Record<string, unknown>,
	): boolean;
	isActorOnActiveSide(
		actor: unknown,
		combat?: CombatLike | null,
		options?: Record<string, unknown>,
	): boolean;
	isTokenOnActiveSide(
		token: TokenLike | null | undefined,
		combat?: CombatLike | null,
		options?: Record<string, unknown>,
	): boolean;
}

function getCombatFromArgument(
	combat: CombatLike | null | undefined,
): CombatLike | null {
	if (combat) return combat;
	return (game?.combat as CombatLike | null) ?? null;
}

async function saveState(
	combat: CombatLike | null,
	state: CombatState,
): Promise<CombatState | null> {
	if (!combat) return null;
	const nextState = cloneSideStateForSave(state, combat.combatants);
	await setCombatState(combat, nextState);
	return nextState;
}

async function syncCombatToSide(
	combat: CombatLike,
	sideId: string,
	{ roundDelta = 0 }: { roundDelta?: number } = {},
): Promise<CombatState> {
	const normalizedSideId = normalizeSideId(sideId);
	const combatant = getSideRepresentativeCombatant(combat, normalizedSideId);
	const state = getCombatState(combat);
	const sideIds = getOrderedSideIds(combat);

	state.activeSideId = normalizedSideId;
	state.activeSideIndex = Math.max(0, sideIds.indexOf(normalizedSideId));
	state.activeCombatantId = combatant?.id ?? null;

	await setCombatState(combat, cloneSideStateForSave(state, combat.combatants));

	const updates: Record<string, number> = {};
	if (Number.isFinite(roundDelta) && roundDelta !== 0) {
		updates.round = Math.max(1, (combat.round ?? 1) + roundDelta);
	}
	if (combatant) {
		const turn = getCombatantTurnIndex(combat, combatant.id ?? "");
		if (turn >= 0) {
			updates.turn = turn;
		}
	}
	if (Object.keys(updates).length) {
		await combat.update?.(updates);
	}

	return state;
}

/**
 * Async work that must complete during a side's turn-end BEFORE the turn
 * advances. Advancing fires Foundry's `updateCombat`, which midi-qol uses to
 * auto-untarget at end of turn — if that runs while an integration's turn-end
 * workflows are still mid-flight, targets get cleared before damage resolves and
 * tokens miss damage. Integrations register a flusher; `emitSideTurnEndHook`
 * awaits them all before returning.
 */
const sideTurnEndFlushers: Array<() => Promise<unknown>> = [];

export function registerSideTurnEndFlusher(
	flusher: () => Promise<unknown>,
): void {
	if (!sideTurnEndFlushers.includes(flusher)) sideTurnEndFlushers.push(flusher);
}

export function clearSideTurnEndFlushers(): void {
	sideTurnEndFlushers.length = 0;
}

async function emitSideTurnEndHook(
	combat: CombatLike | null | undefined,
	sideId: string | null | undefined,
	nextSideId: string | null | undefined,
): Promise<void> {
	if (!sideId) return;
	const payload: SideTurnPayload = {
		combat,
		sideId: normalizeSideId(sideId),
		nextSideId: nextSideId ? normalizeSideId(nextSideId) : null,
	};
	hooks()?.callAll("side-initiative.sideTurnEnd", payload);
	if (sideTurnEndFlushers.length) {
		await Promise.all(
			sideTurnEndFlushers.map((flusher) =>
				Promise.resolve(flusher()).catch(() => undefined),
			),
		);
	}
}

function emitSideTurnStartHook(
	combat: CombatLike | null | undefined,
	sideId: string | null | undefined,
	previousSideId: string | null | undefined,
): void {
	if (!sideId) return;
	const payload: SideTurnPayload = {
		combat,
		sideId: normalizeSideId(sideId),
		previousSideId: previousSideId ? normalizeSideId(previousSideId) : null,
	};
	hooks()?.callAll("side-initiative.sideTurnStart", payload);
}

function getCombatantEntries(
	combat: CombatLike | null | undefined,
): CombatantLike[] {
	const combatants = combat?.combatants;
	if (!combatants) return [];
	if (combatants instanceof Map)
		return Array.from((combatants as Map<string, CombatantLike>).values());
	if (Array.isArray(combatants)) return combatants as CombatantLike[];
	const collection = combatants as {
		contents?: CombatantLike[];
		values?(): IterableIterator<CombatantLike> | CombatantLike[];
		[Symbol.iterator]?(): IterableIterator<CombatantLike>;
	};
	if (Array.isArray(collection.contents)) return collection.contents;
	if (typeof collection.values === "function")
		return Array.from(collection.values() as Iterable<CombatantLike>);
	if (typeof collection[Symbol.iterator] === "function")
		return Array.from(combatants as Iterable<CombatantLike>);
	return Array.from((combatants as Iterable<CombatantLike> | undefined) ?? []);
}

function getRollClass(): typeof Roll | null {
	return getFoundry()?.dice?.Roll ?? null;
}

interface VisibleSideDieOptions {
	rollMode?: string | null;
	random?: RandomFn;
}

async function rollVisibleSideDie(
	side: { id: string; name: string },
	options: VisibleSideDieOptions = {},
): Promise<{ roll: number; tieBreaker: number }> {
	const Roll = getRollClass();
	const rollMode =
		options.rollMode ??
		(getSetting("core", "rollMode") as string | null) ??
		undefined;
	const random = options.random ?? Math.random;

	if (!Roll?.create) {
		return {
			roll: Math.floor(random() * 20) + 1,
			tieBreaker: random(),
		};
	}

	const roll = Roll.create("1d20") as Roll & { total: number | null };
	await roll.evaluate({
		allowInteractive: rollMode !== getConst()?.DICE_ROLL_MODES?.BLIND,
	});
	const speaker =
		getFoundry()?.documents?.ChatMessage?.implementation?.getSpeaker?.({
			alias: side.name,
		}) ?? { alias: side.name };
	const flavor =
		game?.i18n?.format?.("COMBAT.RollsInitiative", { name: side.name }) ??
		`${side.name} initiative`;
	await roll.toMessage({ speaker, flavor }, { rollMode: rollMode as never });
	return {
		roll: Number.isFinite(roll.total ?? NaN) ? (roll.total as number) : 0,
		tieBreaker: random(),
	};
}

async function rollStandardSideInitiative(
	resolvedCombat: CombatLike,
	{ random = Math.random }: { random?: RandomFn } = {},
): Promise<CombatState | null> {
	await SideInitiativeAPI.refreshCombatantSides(resolvedCombat);

	const sideSummary = getSideSummary(resolvedCombat);
	const rolls: Array<SideData & { roll: number; tieBreaker: number }> = [];
	for (const side of sideSummary) {
		rolls.push({
			...side,
			...(await rollVisibleSideDie(side, {
				rollMode: getSetting("core", "rollMode") as string | null,
				random,
			})),
		});
	}

	let attempts = 0;
	while (attempts < 50) {
		const groups = new Map<number, typeof rolls>();
		for (const entry of rolls) {
			const key = entry.roll;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(entry);
		}
		const tiedGroups = [...groups.values()].filter((group) => group.length > 1);
		if (!tiedGroups.length) break;
		for (const group of tiedGroups) {
			for (const side of group) {
				Object.assign(
					side,
					await rollVisibleSideDie(side, {
						rollMode: getSetting("core", "rollMode") as string | null,
						random,
					}),
				);
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
	const nextState: CombatState = {
		...state,
		order: ordered.map((side) => side.id),
		lastRolls: Object.fromEntries(rolls.map((side) => [side.id, side.roll])),
		lastRolledRound: resolvedCombat.round ?? null,
		activeSideId: ordered[0]?.id ?? null,
		activeSideIndex: 0,
		activeCombatantId: null,
		sides: {
			...state.sides,
		},
	};

	for (const side of rolls) {
		nextState.sides[side.id] = {
			...(nextState.sides[side.id] ?? side),
			...side,
			combatantIds:
				side.combatantIds ?? nextState.sides[side.id]?.combatantIds ?? [],
		};
	}

	await saveState(resolvedCombat, nextState);

	const updates: Array<{ _id: string; initiative: number }> = [];
	for (const side of rolls) {
		for (const combatantId of side.combatantIds ?? []) {
			updates.push({
				_id: combatantId,
				initiative: side.roll,
			});
		}
	}
	if (updates.length) {
		await resolvedCombat.updateEmbeddedDocuments?.("Combatant", updates);
	}

	const firstSide = ordered[0]?.id;
	if (firstSide) {
		await syncCombatToSide(resolvedCombat, firstSide, { roundDelta: 0 });
	}

	return nextState;
}

async function rollWeightedSideInitiative(
	resolvedCombat: CombatLike,
	{
		random = Math.random,
		refresh = true,
	}: { random?: RandomFn; refresh?: boolean } = {},
): Promise<CombatState | null> {
	if (refresh) {
		await SideInitiativeAPI.refreshCombatantSides(resolvedCombat);
	}

	if (game?.user?.isGM) {
		const missing = getCombatantEntries(resolvedCombat).filter(
			(combatant) => combatant?.id && !Number.isFinite(combatant.initiative),
		);
		if (missing.length) {
			if (typeof resolvedCombat.rollAll === "function") {
				await resolvedCombat.rollAll?.({ updateTurn: false });
			} else if (typeof resolvedCombat.rollInitiative === "function") {
				await resolvedCombat.rollInitiative?.(
					missing.map((combatant) => combatant.id ?? ""),
					{ updateTurn: false },
				);
			}
		}
	}

	const combatants = getCombatantEntries(resolvedCombat);
	const initiativeByCombatantId: Record<string, number> = {};
	const weightByCombatantId: Record<string, number> = {};

	for (const combatant of combatants) {
		if (!combatant?.id) continue;
		initiativeByCombatantId[combatant.id] = Number.isFinite(
			combatant.initiative,
		)
			? (combatant.initiative as number)
			: 0;
		weightByCombatantId[combatant.id] = getCombatantInitiativeWeight(combatant);
	}

	const state = getCombatState(resolvedCombat);
	const sideSummary = getSideSummary(resolvedCombat);
	const rollResult = rollWeightedSideInitiativeData(
		sideSummary,
		initiativeByCombatantId,
		weightByCombatantId,
		random,
	);
	const nextState: CombatState = {
		...state,
		order: rollResult.order,
		lastRolls: Object.fromEntries(
			rollResult.rolls.map((side) => [side.id, side.roll]),
		),
		lastRolledRound: resolvedCombat.round ?? null,
		activeSideId: rollResult.order[0] ?? null,
		activeSideIndex: 0,
		activeCombatantId: null,
		sides: {
			...state.sides,
		},
	};

	for (const side of rollResult.rolls) {
		nextState.sides[side.id] = {
			...(nextState.sides[side.id] ?? side),
			...side,
			combatantIds:
				side.combatantIds ?? nextState.sides[side.id]?.combatantIds ?? [],
		};
	}

	await saveState(resolvedCombat, nextState);

	const updates: Array<{ _id: string; initiative: number }> = [];
	for (const side of rollResult.rolls) {
		for (const combatantId of side.combatantIds ?? []) {
			updates.push({
				_id: combatantId,
				initiative: side.roll,
			});
		}
	}
	if (updates.length) {
		await resolvedCombat.updateEmbeddedDocuments?.("Combatant", updates);
	}

	const firstSide = rollResult.order[0];
	if (firstSide) {
		await syncCombatToSide(resolvedCombat, firstSide, { roundDelta: 0 });
	}

	return nextState;
}

function getNextRoundDelta(
	currentSideId: string | null,
	nextSideId: string | null,
	direction = 1,
	sideIds: string[] = [],
): number {
	if (!sideIds.length) return 0;
	const currentIndex = Math.max(0, sideIds.indexOf(currentSideId ?? ""));
	const nextIndex = Math.max(0, sideIds.indexOf(nextSideId ?? ""));
	if (direction >= 0) {
		return nextIndex <= currentIndex ? 1 : 0;
	}
	return nextIndex >= currentIndex ? -1 : 0;
}

function canUserControlSide(
	combat: CombatLike | null,
	sideId: string | null | undefined,
	user: UserLike | null | undefined,
): boolean {
	if (!combat || !user || !sideId) return false;
	if (user.isGM) return true;

	const commanderControl = getSetting(MODULE_ID, SETTINGS.commanderControl) as
		| string
		| undefined;
	if (commanderControl === COMMANDER_CONTROL_OPTIONS.gmOnly) return false;

	return isUserOnSide(combat, sideId, user);
}

interface SideSocketMessage {
	module?: string;
	action?: string;
	combatId?: string;
	combatantId?: string;
	userId?: string;
	direction?: number;
}

function getSocketCombat(
	combatId: string | null | undefined,
): CombatLike | null {
	return (
		(game?.combats?.get?.(combatId ?? "") as CombatLike | undefined) ??
		(game?.combat?.id === combatId ? (game.combat as CombatLike) : null)
	);
}

function getRequestingUser(
	message: SideSocketMessage,
	senderUserId: string | null,
): UserLike | null {
	const userId = senderUserId ?? message.userId ?? "";
	return (game?.users?.get?.(userId) as UserLike | undefined) ?? null;
}

interface GameSocket {
	emit(event: string, ...args: unknown[]): void;
	on(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Defensive accessor for Foundry's built-in websocket. The socket is created
 * during world `setup` and is available by the `ready` hook on every client.
 */
function getGameSocket(): GameSocket | null {
	return (game as { socket?: GameSocket } | null)?.socket ?? null;
}

// Foundry only relays a module's single namespaced socket event, "module.<id>".
// An unnamespaced emit is silently dropped by the server (see foundryvtt#582).
const SOCKET_EVENT = `module.${MODULE_ID}`;
let sideSocketRegistered = false;

/**
 * Register the Foundry-native socket listener that lets player clients ask the
 * GM to perform combat changes they are not permitted to make directly
 * (advancing the active side or swapping the active commander). Only the active
 * GM client acts on a message, so duplicate work is avoided when several GMs are
 * connected. socketlib was used previously, but its registration proved
 * unreliable at runtime; `game.socket` is part of Foundry itself and is always
 * available once the world is ready.
 */
export function registerSideInitiativeSocket(): void {
	if (sideSocketRegistered) return;
	const socket = getGameSocket();
	if (!socket?.on) return;
	sideSocketRegistered = true;
	socket.on(SOCKET_EVENT, (...args: unknown[]) => {
		void handleCommanderSocketRequest(
			(args[0] as SideSocketMessage | undefined) ?? {},
			(args[1] as string | null | undefined) ?? null,
		);
	});
}

/**
 * Dispatch a side-initiative request from a player client to the GM over the
 * native socket. This is fire-and-forget: the GM performs the action and the
 * resulting combat update propagates to every client, so no return value is
 * needed.
 */
function dispatchSideRequest(message: SideSocketMessage): boolean {
	const socket = getGameSocket();
	if (!socket?.emit) return false;
	socket.emit(SOCKET_EVENT, message, game?.user?.id ?? null);
	return true;
}

export async function handleCommanderSocketRequest(
	message: SideSocketMessage = {},
	senderUserId: string | null = null,
): Promise<CombatState | null> {
	if (message?.module !== MODULE_ID) return null;
	if (!game?.user?.isGM || !isActiveGMClient()) return null;

	const combat = getSocketCombat(message.combatId);
	if (!combat) return null;

	const requestingUser = getRequestingUser(message, senderUserId);
	if (!requestingUser) return null;

	if (message.action === "setCommander") {
		const combatants = combat.combatants;
		const combatant =
			combatants && typeof (combatants as { get?: unknown }).get === "function"
				? ((combatants as { get: (id: string) => CombatantLike | null }).get(
						message.combatantId ?? "",
					) ?? null)
				: null;
		if (!combatant) return null;
		if (
			!canUserControlSide(combat, getCombatantSideId(combatant), requestingUser)
		)
			return null;

		return SideInitiativeAPI.setSideCommander(combat, combatant);
	}

	if (message.action === "advanceSide") {
		if (!SideInitiativeAPI.canUserAdvanceSide(combat, requestingUser))
			return null;
		return SideInitiativeAPI.advanceSide(combat, message.direction ?? 1);
	}

	return null;
}

export const SideInitiativeAPI: SideInitiativeApi = {
	MODULE_ID,
	async refreshCombatantSides(
		combat = null,
		{ overwrite = false, groupByDisposition = true } = {},
	) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (!resolvedCombat) return null;
		await ensureCombatantSideAssignments(resolvedCombat, {
			overwrite,
			groupByDisposition,
		});
		const nextState = cloneSideStateForSave(
			getCombatState(resolvedCombat),
			resolvedCombat.combatants,
		);
		await setCombatState(resolvedCombat, nextState);
		return nextState;
	},

	async rollSideInitiative(combat = null, { random = Math.random } = {}) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (!resolvedCombat) return null;
		const initiativeMethod = getSetting(MODULE_ID, SETTINGS.initiativeMethod) as
			| string
			| undefined;
		if (initiativeMethod === INITIATIVE_METHOD_OPTIONS.weightedAverage) {
			return rollWeightedSideInitiative(resolvedCombat, {
				random,
				refresh: true,
			});
		}
		return rollStandardSideInitiative(resolvedCombat, { random });
	},

	async rollWeightedSideInitiative(
		combat = null,
		{ random = Math.random, refresh = true } = {},
	) {
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
			[normalizeSideId(sideId)]: combatant.id ?? "",
		};

		await setCombatState(
			resolvedCombat,
			cloneSideStateForSave(state, resolvedCombat.combatants),
		);

		if (getActiveSideId(resolvedCombat) === normalizeSideId(sideId)) {
			await syncCombatToSide(resolvedCombat, sideId, { roundDelta: 0 });
			return getCombatState(resolvedCombat);
		}

		return state;
	},

	async requestSideCommander(combat, combatant) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (!resolvedCombat || !combatant) return false;

		if (game?.user?.isGM) {
			await this.setSideCommander(resolvedCombat, combatant);
			return true;
		}

		const dispatched = dispatchSideRequest({
			module: MODULE_ID,
			action: "setCommander",
			combatId: resolvedCombat.id ?? undefined,
			combatantId: combatant.id ?? undefined,
			userId: game?.user?.id ?? undefined,
		});
		if (!dispatched) {
			ui?.notifications?.warn?.(
				game?.i18n?.localize?.(
					"SIDE-INITIATIVE.Notifications.NoGMForCommander",
				) ?? "",
			);
			return false;
		}
		return true;
	},

	async requestAdvanceSide(combat, direction = 1) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (
			!resolvedCombat ||
			!this.canUserAdvanceSide(
				resolvedCombat,
				game?.user as UserLike | undefined,
			)
		)
			return false;

		if (game?.user?.isGM) {
			await this.advanceSide(resolvedCombat, direction);
			return true;
		}

		const dispatched = dispatchSideRequest({
			module: MODULE_ID,
			action: "advanceSide",
			combatId: resolvedCombat.id ?? undefined,
			direction,
			userId: game?.user?.id ?? undefined,
		});
		if (!dispatched) {
			ui?.notifications?.warn?.(
				game?.i18n?.localize?.(
					"SIDE-INITIATIVE.Notifications.NoGMForAdvance",
				) ?? "",
			);
			return false;
		}
		return true;
	},

	getSideCommander(combat, sideId) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (!resolvedCombat) return null;
		return getSideCommanderCombatant(resolvedCombat, sideId ?? "");
	},

	canUserSetCommander(
		combatant,
		user = game?.user as UserLike | undefined,
		combat,
	) {
		const resolvedCombat = getCombatFromArgument(combat);
		const sideId = combatant ? getCombatantSideId(combatant) : null;
		return canUserControlSide(resolvedCombat, sideId, user);
	},

	canUserAdvanceSide(combat, user = game?.user as UserLike | undefined) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (
			!resolvedCombat ||
			!resolvedCombat.started ||
			!isSideCombat(resolvedCombat)
		)
			return false;

		const activeSideId = getActiveSideId(resolvedCombat);
		return canUserControlSide(resolvedCombat, activeSideId, user);
	},

	async setActiveSide(combat, sideId) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (!resolvedCombat) return null;
		const normalizedSideId = normalizeSideId(sideId);
		const previousSideId = getActiveSideId(resolvedCombat);
		if (previousSideId === normalizedSideId) {
			const state = getCombatState(resolvedCombat);
			state.activeSideId = normalizedSideId;
			state.activeSideIndex = Math.max(
				0,
				getOrderedSideIds(resolvedCombat).indexOf(normalizedSideId),
			);
			state.activeCombatantId =
				getSideRepresentativeCombatant(resolvedCombat, normalizedSideId)?.id ??
				null;
			await setCombatState(
				resolvedCombat,
				cloneSideStateForSave(state, resolvedCombat.combatants),
			);
			await syncCombatToSide(resolvedCombat, normalizedSideId, {
				roundDelta: 0,
			});
			return state;
		}

		await emitSideTurnEndHook(resolvedCombat, previousSideId, normalizedSideId);
		const state = getCombatState(resolvedCombat);
		state.activeSideId = normalizedSideId;
		state.activeSideIndex = Math.max(
			0,
			getOrderedSideIds(resolvedCombat).indexOf(normalizedSideId),
		);
		state.activeCombatantId =
			getSideRepresentativeCombatant(resolvedCombat, normalizedSideId)?.id ??
			null;
		await setCombatState(
			resolvedCombat,
			cloneSideStateForSave(state, resolvedCombat.combatants),
		);
		await syncCombatToSide(resolvedCombat, normalizedSideId, { roundDelta: 0 });
		emitSideTurnStartHook(resolvedCombat, normalizedSideId, previousSideId);
		return state;
	},

	async advanceSide(combat, direction = 1) {
		const resolvedCombat = getCombatFromArgument(combat);
		if (!resolvedCombat) return null;
		const currentSideId = getActiveSideId(resolvedCombat);
		const nextSideId = getNextSideId(resolvedCombat, direction);
		if (!nextSideId) return null;
		const ordered = getOrderedSideIds(resolvedCombat);
		const roundDelta = getNextRoundDelta(
			currentSideId,
			nextSideId,
			direction,
			ordered,
		);
		await emitSideTurnEndHook(resolvedCombat, currentSideId, nextSideId);
		const state = getCombatState(resolvedCombat);
		state.activeSideId = nextSideId;
		state.activeSideIndex = Math.max(0, ordered.indexOf(nextSideId));
		state.activeCombatantId =
			getSideRepresentativeCombatant(resolvedCombat, nextSideId)?.id ?? null;
		await setCombatState(
			resolvedCombat,
			cloneSideStateForSave(state, resolvedCombat.combatants),
		);
		await syncCombatToSide(resolvedCombat, nextSideId, { roundDelta });
		emitSideTurnStartHook(resolvedCombat, nextSideId, currentSideId);
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
		return isActorOnActiveSide(
			actor as Parameters<typeof isActorOnActiveSide>[0],
			resolvedCombat,
			options,
		);
	},

	isTokenOnActiveSide(token, combat = null, options = {}) {
		const resolvedCombat = getCombatFromArgument(combat);
		return isTokenOnActiveSide(token, resolvedCombat, options);
	},
};

// Re-exported so `game.sideInitiative` consumers share the live instance.
export { getSideInitiative };
