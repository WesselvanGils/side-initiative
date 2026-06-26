import test from "node:test";
import assert from "node:assert/strict";
import {
	handleCommanderSocketRequest,
	registerSideInitiativeSocket,
	SideInitiativeAPI,
} from "../src/api.js";
import type { CombatLike, CombatantLike, UserLike } from "../src/types.js";

const testGlobal = globalThis as unknown as {
	game: { socket?: GameSocket } & Record<string, unknown>;
};
interface CombatantOptions {
	id: string;
	sideId: string;
	hasPlayerOwner?: boolean;
	ownerIds?: string[];
}

type TestCombatant = CombatantLike & { id: string };
type TestCombat = CombatLike & {
	id: string;
	round: number;
	turn: number;
	started: boolean;
	combatants: Map<string, TestCombatant>;
};
type TestState = Record<string, unknown> | null;
interface GameSocket {
	on(event: string, listener: (...args: unknown[]) => void): void;
	emit(event: string, ...args: unknown[]): void;
}
interface EmitCall {
	event: string;
	args: unknown[];
}

function createCombatant({
	id,
	sideId,
	hasPlayerOwner = true,
	ownerIds = ["user-1"],
}: CombatantOptions): TestCombatant {
	const flags = new Map<string, unknown>();
	flags.set("side-initiative:sideId", sideId);
	return {
		id,
		name: id,
		hasPlayerOwner,
		isOwner: ownerIds.includes("user-1"),
		testUserPermission(user: UserLike | null | undefined, permission: string) {
			return (
				permission === "OWNER" &&
				(user?.isGM ||
					(typeof user?.id === "string" && ownerIds.includes(user.id)))
			);
		},
		getFlag(scope: string, key: string) {
			return flags.get(`${scope}:${key}`) ?? null;
		},
		setFlag(scope: string, key: string, value: unknown) {
			flags.set(`${scope}:${key}`, value);
			return Promise.resolve(value);
		},
	};
}

function createCombat(
	combatants: TestCombatant[],
	state: TestState = null,
): TestCombat {
	let combatState: unknown = state;
	return {
		id: "combat-1",
		round: 1,
		turn: 0,
		started: true,
		combatants: new Map(
			combatants.map((combatant) => [combatant.id, combatant]),
		),
		update(data: Record<string, unknown>) {
			if (typeof data.round === "number") this.round = data.round;
			if (typeof data.turn === "number") this.turn = data.turn;
			return Promise.resolve(this);
		},
		getFlag(scope: string, key: string) {
			if (scope === "side-initiative" && key === "state") return combatState;
			return null;
		},
		setFlag(scope: string, key: string, value: unknown) {
			if (scope === "side-initiative" && key === "state") {
				combatState = value;
			}
			return Promise.resolve(value);
		},
	};
}

test("handleCommanderSocketRequest applies commander changes for the active GM", async () => {
	const combatant = createCombatant({ id: "pc-1", sideId: "players" });
	const combat = createCombat([combatant], {
		activeSideId: "players",
		order: ["players"],
		sides: {
			players: { id: "players", combatantIds: ["pc-1"] },
		},
		commanderIds: {},
	});
	const requester = { id: "user-1", isGM: false };
	const activeGM = { id: "gm-1", isGM: true, active: true };
	const original = {
		game: testGlobal.game,
	};

	testGlobal.game = {
		user: activeGM,
		users: {
			activeGM,
			get(id: string) {
				if (id === requester.id) return requester;
				if (id === activeGM.id) return activeGM;
				return null;
			},
			contents: [requester, activeGM],
		},
		combats: {
			get(id: string) {
				return id === combat.id ? combat : null;
			},
		},
		i18n: {
			localize(key: string) {
				return key;
			},
		},
		settings: {
			get() {
				return "side-owners";
			},
		},
		sideInitiative: SideInitiativeAPI,
	};

	try {
		const result = await handleCommanderSocketRequest(
			{
				module: "side-initiative",
				action: "setCommander",
				combatId: combat.id,
				combatantId: combatant.id,
				userId: requester.id,
			},
			requester.id,
		);

		assert.ok(result);
		assert.equal(
			SideInitiativeAPI.getSideCommander(combat, "players")?.id,
			"pc-1",
		);
	} finally {
		testGlobal.game = original.game;
	}
});

test("handleCommanderSocketRequest ignores unauthorized commander requests", async () => {
	const combatant = createCombatant({
		id: "pc-1",
		sideId: "players",
		ownerIds: [],
	});
	const combat = createCombat([combatant], {
		activeSideId: "players",
		order: ["players"],
		sides: {
			players: { id: "players", combatantIds: ["pc-1"] },
		},
		commanderIds: {},
	});
	const requester = { id: "user-2", isGM: false };
	const activeGM = { id: "gm-1", isGM: true, active: true };
	const original = {
		game: testGlobal.game,
	};

	testGlobal.game = {
		user: activeGM,
		users: {
			activeGM,
			get(id: string) {
				if (id === requester.id) return requester;
				if (id === activeGM.id) return activeGM;
				return null;
			},
			contents: [requester, activeGM],
		},
		combats: {
			get(id: string) {
				return id === combat.id ? combat : null;
			},
		},
		i18n: {
			localize(key: string) {
				return key;
			},
		},
		settings: {
			get() {
				return "side-owners";
			},
		},
		sideInitiative: SideInitiativeAPI,
	};

	try {
		const result = await handleCommanderSocketRequest(
			{
				module: "side-initiative",
				action: "setCommander",
				combatId: combat.id,
				combatantId: combatant.id,
				userId: requester.id,
			},
			requester.id,
		);

		assert.equal(result, null);
		assert.equal(SideInitiativeAPI.getSideCommander(combat, "players"), null);
	} finally {
		testGlobal.game = original.game;
	}
});

test("handleCommanderSocketRequest applies commander changes when the requester owns a different side member", async () => {
	// requester (user-2) owns pc-2 but crowns pc-1 (owned by user-1) — same side.
	const target = createCombatant({
		id: "pc-1",
		sideId: "players",
		ownerIds: ["user-1"],
	});
	const member = createCombatant({
		id: "pc-2",
		sideId: "players",
		ownerIds: ["user-2"],
	});
	const combat = createCombat([target, member], {
		activeSideId: "players",
		order: ["players"],
		sides: {
			players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
		},
		commanderIds: {},
	});
	const requester = { id: "user-2", isGM: false };
	const activeGM = { id: "gm-1", isGM: true, active: true };
	const original = { game: testGlobal.game };

	testGlobal.game = {
		user: activeGM,
		users: {
			activeGM,
			get(id: string) {
				if (id === requester.id) return requester;
				if (id === activeGM.id) return activeGM;
				return null;
			},
			contents: [requester, activeGM],
		},
		combats: {
			get(id: string) {
				return id === combat.id ? combat : null;
			},
		},
		i18n: {
			localize(key: string) {
				return key;
			},
		},
		settings: {
			get() {
				return "side-owners";
			},
		},
		sideInitiative: SideInitiativeAPI,
	};

	try {
		const result = await handleCommanderSocketRequest(
			{
				module: "side-initiative",
				action: "setCommander",
				combatId: combat.id,
				combatantId: target.id,
				userId: requester.id,
			},
			requester.id,
		);

		assert.ok(result);
		assert.equal(
			SideInitiativeAPI.getSideCommander(combat, "players")?.id,
			"pc-1",
		);
	} finally {
		testGlobal.game = original.game;
	}
});

test("handleCommanderSocketRequest advances the active side for an authorized player", async () => {
	const player = createCombatant({
		id: "pc-1",
		sideId: "players",
		ownerIds: ["user-1"],
	});
	const monster = createCombatant({
		id: "npc-1",
		sideId: "monsters",
		ownerIds: [],
	});
	const combat = createCombat([player, monster], {
		activeSideId: "players",
		order: ["players", "monsters"],
		sides: {
			players: { id: "players", combatantIds: ["pc-1"] },
			monsters: { id: "monsters", combatantIds: ["npc-1"] },
		},
		commanderIds: {},
	});
	const requester = { id: "user-1", isGM: false };
	const activeGM = { id: "gm-1", isGM: true, active: true };
	const original = { game: testGlobal.game };

	testGlobal.game = {
		user: activeGM,
		users: {
			activeGM,
			get(id: string) {
				if (id === requester.id) return requester;
				if (id === activeGM.id) return activeGM;
				return null;
			},
			contents: [requester, activeGM],
		},
		combats: {
			get(id: string) {
				return id === combat.id ? combat : null;
			},
		},
		i18n: {
			localize(key: string) {
				return key;
			},
		},
		settings: {
			get() {
				return "side-owners";
			},
		},
		sideInitiative: SideInitiativeAPI,
	};

	try {
		const result = await handleCommanderSocketRequest(
			{
				module: "side-initiative",
				action: "advanceSide",
				combatId: combat.id,
				direction: 1,
				userId: requester.id,
			},
			requester.id,
		);

		assert.ok(result);
		assert.equal(result.activeSideId, "monsters");
		assert.equal(combat.turn, 1);
	} finally {
		testGlobal.game = original.game;
	}
});

test("handleCommanderSocketRequest rejects advance requests from users outside the active side", async () => {
	const player = createCombatant({
		id: "pc-1",
		sideId: "players",
		ownerIds: ["user-1"],
	});
	const monster = createCombatant({
		id: "npc-1",
		sideId: "monsters",
		ownerIds: ["user-2"],
	});
	const combat = createCombat([player, monster], {
		activeSideId: "players",
		order: ["players", "monsters"],
		sides: {
			players: { id: "players", combatantIds: ["pc-1"] },
			monsters: { id: "monsters", combatantIds: ["npc-1"] },
		},
		commanderIds: {},
	});
	const requester = { id: "user-2", isGM: false };
	const activeGM = { id: "gm-1", isGM: true, active: true };
	const original = { game: testGlobal.game };

	testGlobal.game = {
		user: activeGM,
		users: {
			activeGM,
			get(id: string) {
				if (id === requester.id) return requester;
				if (id === activeGM.id) return activeGM;
				return null;
			},
			contents: [requester, activeGM],
		},
		combats: {
			get(id: string) {
				return id === combat.id ? combat : null;
			},
		},
		i18n: {
			localize(key: string) {
				return key;
			},
		},
		settings: {
			get() {
				return "side-owners";
			},
		},
		sideInitiative: SideInitiativeAPI,
	};

	try {
		const result = await handleCommanderSocketRequest(
			{
				module: "side-initiative",
				action: "advanceSide",
				combatId: combat.id,
				direction: 1,
				userId: requester.id,
			},
			requester.id,
		);

		assert.equal(result, null);
		assert.equal(
			SideInitiativeAPI.getSideState(combat)?.find((side) => side.active)?.id,
			"players",
		);
		assert.equal(combat.turn, 0);
	} finally {
		testGlobal.game = original.game;
	}
});

test("player side actions dispatch over the native game.socket and the GM handler applies them", async () => {
	const player = createCombatant({
		id: "pc-1",
		sideId: "players",
		ownerIds: ["user-1"],
	});
	const monster = createCombatant({
		id: "npc-1",
		sideId: "monsters",
		ownerIds: [],
	});
	const combat = createCombat([player, monster], {
		activeSideId: "players",
		order: ["players", "monsters"],
		sides: {
			players: { id: "players", combatantIds: ["pc-1"] },
			monsters: { id: "monsters", combatantIds: ["npc-1"] },
		},
		commanderIds: {},
	});
	const requester = { id: "user-1", isGM: false };
	const activeGM = { id: "gm-1", isGM: true, active: true };
	const emitCalls: EmitCall[] = [];
	let registeredListener: ((...args: unknown[]) => void) | null = null;

	function buildPlayerGame(): void {
		testGlobal.game = {
			socket: {
				on(event: string, listener: (...args: unknown[]) => void) {
					assert.equal(event, "module.side-initiative");
					registeredListener = listener;
				},
				emit(event: string, ...args: unknown[]) {
					emitCalls.push({ event, args });
				},
			},
			user: requester,
			users: {
				get(id: string) {
					if (id === requester.id) return requester;
					return null;
				},
				contents: [requester],
			},
			combats: {
				get(id: string) {
					return id === combat.id ? combat : null;
				},
			},
			i18n: {
				localize(key: string) {
					return key;
				},
			},
			settings: {
				get() {
					return "side-owners";
				},
			},
			sideInitiative: SideInitiativeAPI,
		};
	}

	// Simulate the GM client receiving a socket message and processing it under
	// the GM's game context. Foundry delivers socket emits to every connected
	// client; only the active GM acts on the message.
	async function deliverAsGm(message: unknown, senderUserId: string | null) {
		const playerGame = testGlobal.game;
		testGlobal.game = {
			...playerGame,
			user: activeGM,
			users: {
				activeGM,
				get(id: string) {
					if (id === requester.id) return requester;
					if (id === activeGM.id) return activeGM;
					return null;
				},
				contents: [requester, activeGM],
			},
		};
		try {
			await handleCommanderSocketRequest(message as never, senderUserId);
		} finally {
			testGlobal.game = playerGame;
		}
	}

	const original = { game: testGlobal.game };

	try {
		buildPlayerGame();
		registerSideInitiativeSocket();
		assert.ok(
			registeredListener,
			"registerSideInitiativeSocket should register a socket listener",
		);

		const requested = await SideInitiativeAPI.requestAdvanceSide(combat, 1);

		assert.equal(requested, true);
		assert.equal(emitCalls.length, 1);
		assert.equal(emitCalls[0].event, "module.side-initiative");
		assert.deepEqual(emitCalls[0].args, [
			{
				module: "side-initiative",
				action: "advanceSide",
				combatId: combat.id,
				direction: 1,
				userId: requester.id,
			},
			requester.id,
		]);

		// The GM client processes the dispatched message.
		await deliverAsGm(
			emitCalls[0].args[0],
			emitCalls[0].args[1] as string | null,
		);
		assert.equal(
			SideInitiativeAPI.getSideState(combat)?.find((side) => side.active)?.id,
			"monsters",
		);
		assert.equal(combat.turn, 1);

		const commanderRequested = await SideInitiativeAPI.requestSideCommander(
			combat,
			player,
		);
		assert.equal(commanderRequested, true);
		assert.equal(emitCalls.length, 2);
		assert.deepEqual(emitCalls[1].args, [
			{
				module: "side-initiative",
				action: "setCommander",
				combatId: combat.id,
				combatantId: player.id,
				userId: requester.id,
			},
			requester.id,
		]);

		await deliverAsGm(
			emitCalls[1].args[0],
			emitCalls[1].args[1] as string | null,
		);
		assert.equal(
			SideInitiativeAPI.getSideCommander(combat, "players")?.id,
			player.id,
		);
	} finally {
		testGlobal.game = original.game;
	}
});

test("requestAdvanceSide warns and returns false when the socket transport is unavailable", async () => {
	const player = createCombatant({
		id: "pc-1",
		sideId: "players",
		ownerIds: ["user-1"],
	});
	const combat = createCombat([player], {
		activeSideId: "players",
		order: ["players"],
		sides: {
			players: { id: "players", combatantIds: ["pc-1"] },
		},
		commanderIds: {},
	});
	const requester = { id: "user-1", isGM: false };
	const original = { game: testGlobal.game };
	let warned = false;

	testGlobal.game = {
		// No `socket` available — simulates a client where the transport has not
		// been created yet.
		user: requester,
		users: {
			get(id: string) {
				return id === requester.id ? requester : null;
			},
			contents: [requester],
		},
		combats: {
			get(id: string) {
				return id === combat.id ? combat : null;
			},
		},
		i18n: {
			localize(key: string) {
				return key;
			},
		},
		settings: {
			get() {
				return "side-owners";
			},
		},
		sideInitiative: SideInitiativeAPI,
	} as never;

	const originalUi = (globalThis as { ui?: unknown }).ui;
	(globalThis as { ui?: unknown }).ui = {
		notifications: {
			warn() {
				warned = true;
			},
		},
	};

	try {
		const requested = await SideInitiativeAPI.requestAdvanceSide(combat, 1);
		assert.equal(requested, false);
		assert.equal(warned, true);
	} finally {
		testGlobal.game = original.game;
		(globalThis as { ui?: unknown }).ui = originalUi;
	}
});
