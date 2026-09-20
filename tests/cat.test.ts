import test from "node:test";
import assert from "node:assert/strict";
import {
    dispatchCatSide,
    getCatIntegrationState,
    isCatCombatHandler,
    registerCatIntegration,
} from "../src/integration/cat.js";

test("CAT side dispatch serializes members, runs everyTurn once, and leaves live documents intact", async () => {
    const previousGame = globalThis.game;
    globalThis.game = { user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } } } as any;
    try {
        const tokens = [0, 1, 2].map((id) => ({ id: String(id), actor: { type: "npc" }, parent: null as any }));
        const scene = { tokens };
        tokens.forEach((token) => {
            token.parent = scene;
        });
        const combat: any = {
            started: true,
            isActive: true,
            turn: 0,
            round: 2,
            current: { turn: 0, round: 2 },
            previous: { turn: 1, round: 1 },
            combatants: tokens.map((token, index) => ({
                id: token.id,
                token,
                defeated: index === 2,
                getFlag: () => "players",
            })),
        };
        const calls: string[] = [];
        Object.defineProperty(combat, "combatants", { writable: false, configurable: false });
        let inFlight = false;
        const native = async (view: any, updates: any) => {
            assert.equal(inFlight, false);
            inFlight = true;
            assert.ok(updates.round);
            const current = view.combatants.get(view.current.combatantId)?.token;
            const previous = view.combatants.get(view.previous.combatantId)?.token;
            if (previous) calls.push(`end:${previous.id}`);
            if (current) {
                for (const token of current.parent.tokens.filter((t: any) => t.actor)) calls.push(`every:${token.id}`);
                assert.equal(current.parent.tokens.filter((t: any) => t.actor).length, 3);
                assert.equal(current.parent.tokens.map((t: any) => t.id).length, 3);
                calls.push(`start:${current.id}`);
            }
            await Promise.resolve();
            assert.equal(tokens[1].parent, scene);
            assert.equal(scene.tokens.length, 3);
            inFlight = false;
        };
        await dispatchCatSide(native, { combat, sideId: "players" }, false);
        await dispatchCatSide(native, { combat, sideId: "players" }, true);
        assert.deepEqual(calls, ["end:0", "end:1", "every:0", "every:1", "every:2", "start:0", "start:1"]);
        assert.deepEqual(combat.current, { turn: 0, round: 2 });
        assert.equal(combat.combatants.length, 3);
        (globalThis.game as any).user.id = "player";
        await dispatchCatSide(native, { combat, sideId: "players" }, true);
        assert.equal(calls.length, 7);
    } finally {
        globalThis.game = previousGame;
    }
});

test("CAT source guard rejects unrelated or changed handlers", () => {
    assert.equal(isCatCombatHandler(undefined), false);
    assert.equal(
        isCatCombatHandler(() => undefined),
        false,
    );
    const api: any = {};
    function supported() {
        api.processRegionActivities();
        new api.CombatEvent(null);
        return [api.combatPasses.everyTurn, api.combatPasses.turnEnd];
    }
    assert.equal(isCatCombatHandler(supported), true);
});

test("CAT guards activation, preserves ordinary combat dispatch, and suppresses commander updates", async () => {
    const originals = { game: globalThis.game, Hooks: globalThis.Hooks, cat: (globalThis as any).cat };
    const api: any = {};
    let nativeCalls = 0;
    async function native(combat: any) {
        if (!combat) {
            api.processRegionActivities();
            new api.CombatEvent(null);
            return [api.combatPasses.everyTurn, api.combatPasses.turnEnd];
        }
        nativeCalls++;
    }
    const events: any = { updateCombat: [{ fn: native }] };
    let ready: () => void;
    let version = "99.0.0";
    globalThis.Hooks = {
        events,
        once: (_name: string, fn: () => void) => {
            ready = fn;
        },
        on: (name: string, fn: unknown) => {
            (events[name] ??= []).push({ fn });
        },
    } as any;
    globalThis.game = {
        user: { id: "gm", isGM: false },
        users: { activeGM: { id: "gm" } },
        modules: { get: () => ({ active: true, version }) },
    } as any;
    (globalThis as any).cat = {
        lib: { Events: { CombatEvent: class {} } },
        utils: { combatUtils: { isOwnTurn: () => true } },
    };
    try {
        registerCatIntegration();
        ready!();
        assert.equal(getCatIntegrationState(), "unsupported");
        assert.equal(events.updateCombat[0].fn, native);
        version = "0.0.7";
        ready!();
        assert.equal(getCatIntegrationState(), "active");
        const wrapped = events.updateCombat[0].fn;
        await wrapped({});
        assert.equal(nativeCalls, 1);
        await wrapped({ getFlag: () => ({ activeSideId: "players" }) });
        assert.equal(nativeCalls, 1);
        await wrapped(
            {
                started: true,
                previous: { round: 0 },
                round: 1,
                turn: 0,
                getFlag: () => ({ activeSideId: "players" }),
                combatants: [0, 1].map((id) => ({
                    id: String(id),
                    getFlag: () => "players",
                    token: { id: String(id), actor: {}, parent: { tokens: [] } },
                })),
            },
            { round: 1, turn: 0 },
        );
        assert.equal(nativeCalls, 3);
        ready!();
        assert.equal(events.updateCombat[0].fn, wrapped);
        assert.equal(events["side-initiative.sideTurnStart"].length, 1);
    } finally {
        globalThis.game = originals.game;
        globalThis.Hooks = originals.Hooks;
        (globalThis as any).cat = originals.cat;
    }
});
