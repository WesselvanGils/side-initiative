import test from "node:test";
import assert from "node:assert/strict";
import {
    getCprPremadesIntegrationState,
    getCprPremadesVersion,
    registerChrisPremadesIntegration,
    resetCprPremadesIntegrationState,
    validateCprShape
} from "../src/integration/chris-premades.js";

function createHooks() {
    // Model Foundry's Hooks: events[name] is an array of {fn, once} entries, so
    // the updateCombat wrap can locate and mutate a handler's `fn` in place.
    const events: Record<string, Array<{ fn: (...args: unknown[]) => unknown; once: boolean }>> = {};
    return {
        events,
        on(name: string, handler: (...args: unknown[]) => unknown) {
            (events[name] ??= []).push({ fn: handler, once: false });
        },
        once(name: string, handler: (...args: unknown[]) => unknown) {
            (events[name] ??= []).push({ fn: handler, once: true });
        },
        get(name: string) {
            return (events[name] ?? []).map((entry) => entry.fn);
        }
    };
}

interface TemplateFixture {
    id: string;
    tokenIds: Set<string>;
    flags: Record<string, Record<string, unknown>>;
}

interface RegionFixture {
    id: string;
    name: string;
    flags: Record<string, Record<string, unknown>>;
}

interface InstallOptions {
    version?: string;
    cprActive?: boolean;
    primaryGM?: string;
    currentTokenId?: string | null;
    previousTokenId?: string | null;
    currentCombatantId?: string | null;
    previousCombatantId?: string | null;
    templates?: TemplateFixture[];
    templateUtils?: unknown;
    macros?: Record<string, unknown>;
    sideCombat?: boolean;
    cprUpdateCombat?: (...args: unknown[]) => unknown;
    extraCombatants?: Array<{ id: string; sideId: string; tokenId: string; defeated?: boolean; regions?: Set<unknown> }>;
}

function installGlobals(options: InstallOptions = {}) {
    const {
        version = "1.2.29",
        cprActive = true,
        primaryGM = "gm-1",
        currentTokenId = "commander",
        previousTokenId = "commander",
        currentCombatantId = "combatant-commander",
        previousCombatantId = "combatant-commander",
        sideCombat = true,
        templates = [],
        extraCombatants = []
    } = options;

    const original = {
        game: globalThis.game,
        ui: globalThis.ui,
        Hooks: globalThis.Hooks,
        chrisPremades: (globalThis as { chrisPremades?: unknown }).chrisPremades
    };

    const warnings: string[] = [];
    const invocations: Array<{ macro: string; pass: string; tokenId: string; castData: { castLevel: number; saveDC: number }; name: string }> = [];

    function recorder(macro: string) {
        const fn = async function ({ trigger }: { trigger: { token?: { id?: string }; castData: { castLevel: number; saveDC: number }; name?: string } }) {
            invocations.push({ macro, pass: "", tokenId: trigger?.token?.id ?? "?", castData: trigger?.castData, name: trigger?.name ?? "" });
        };
        Object.defineProperty(fn, "name", { value: macro });
        return fn;
    }

    const defaultMacros = {
        hungerOfHadarTemplate: {
            template: [
                { pass: "turnStart", priority: 50, macro: recorder("hunger-start") },
                { pass: "turnEnd", priority: 50, macro: recorder("hunger-end") }
            ]
        },
        cloudkillTemplate: {
            template: [{ pass: "turnStart", priority: 50, macro: recorder("cloudkill") }]
        },
        everyTurnMacro: {
            template: [{ pass: "everyTurn", priority: 50, macro: recorder("every-turn") }]
        },
        wallOfFireRegion: {
            region: [{ pass: "turnEnd", priority: 50, macro: recorder("wallfire-end") }]
        },
        ...(options.macros ?? {})
    };

    function createToken(id: string, regions: Set<unknown> = new Set()) {
        const token = {
            id,
            uuid: `${id}-uuid`,
            object: { id } as { id: string; document?: unknown },
            regions,
            actor: { id: `${id}-actor`, uuid: `${id}-actor-uuid`, type: "character" }
        };
        token.object.document = token;
        return token;
    }

    const commander = createToken("commander");
    const member = createToken("member");
    const offside = createToken("offside");

    function createCombatant(id: string, sideId: string, token: ReturnType<typeof createToken>, defeated = false) {
        return {
            id,
            token,
            actor: token.actor,
            defeated,
            getFlag(scope: string, key: string) {
                if (sideCombat && scope === "side-initiative" && key === "sideId") return sideId;
                return null;
            }
        };
    }

    const combatants = [
        createCombatant("combatant-commander", "players", commander),
        createCombatant("combatant-member", "players", member),
        createCombatant("combatant-offside", "monsters", offside)
    ] as Array<ReturnType<typeof createCombatant>> & { get?(id: string): ReturnType<typeof createCombatant> | null };
    for (const extra of extraCombatants) {
        const token = createToken(extra.tokenId, extra.regions);
        combatants.push(createCombatant(extra.id, extra.sideId, token, extra.defeated ?? false));
    }
    combatants.get = (id: string) => combatants.find((combatant) => combatant.id === id) ?? null;

    const templateUtils = options.templateUtils ?? {
        getTemplatesInToken(placeable: { id?: string }) {
            const id = placeable?.id;
            return new Set(templates.filter((template) => template.tokenIds.has(id)));
        }
    };

    globalThis.game = {
        user: { id: "gm-1", isGM: true, active: true },
        users: { activeGM: { id: primaryGM, isGM: true, active: true } },
        combat: {
            started: true,
            current: { tokenId: currentTokenId, combatantId: currentCombatantId, turn: 2, round: 1 },
            previous: previousCombatantId === null && previousTokenId === null
                ? undefined
                : { tokenId: previousTokenId, combatantId: previousCombatantId, turn: 1, round: 1 },
            combatants
        },
        modules: {
            get(moduleId: string) {
                if (moduleId === "chris-premades") return cprActive ? { active: true, version, data: { version } } : { active: false, version, data: { version } };
                return null;
            }
        },
        i18n: {
            localize(key: string) {
                return key;
            },
            format(key: string, data: unknown) {
                return `${key} ${JSON.stringify(data)}`;
            }
        }
    };
    globalThis.ui = {
        notifications: {
            warn(message: string) {
                warnings.push(message);
            }
        }
    };
    globalThis.Hooks = createHooks();
    if (options.cprUpdateCombat) {
        (globalThis.Hooks as ReturnType<typeof createHooks>).on("updateCombat", options.cprUpdateCombat);
    }
    (globalThis as { chrisPremades?: unknown }).chrisPremades = {
        macros: defaultMacros,
        utils: { templateUtils }
    };

    function emitSideTurnStart(sideId: string) {
        const [handler] = (globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnStart");
        return handler?.({ combat: (globalThis.game as { combat: unknown }).combat, sideId });
    }
    function emitSideTurnEnd(sideId: string) {
        const [handler] = (globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnEnd");
        return handler?.({ combat: (globalThis.game as { combat: unknown }).combat, sideId });
    }

    return {
        warnings,
        invocations,
        commander,
        member,
        offside,
        combat: (globalThis.game as { combat: unknown }).combat,
        getUpdateCombatHandler() {
            const entries = (globalThis.Hooks as ReturnType<typeof createHooks>).events["updateCombat"] ?? [];
            return entries[0]?.fn;
        },
        restore() {
            globalThis.game = original.game;
            globalThis.ui = original.ui;
            globalThis.Hooks = original.Hooks;
            (globalThis as { chrisPremades?: unknown }).chrisPremades = original.chrisPremades;
            resetCprPremadesIntegrationState();
        },
        emitSideTurnStart,
        emitSideTurnEnd
    };
}

const HUNGER_FLAGS = (overrides: Record<string, unknown> = {}) => ({
    "chris-premades": {
        template: { name: "Hunger of Hadar" },
        macros: { template: ["hungerOfHadarTemplate"] },
        castData: { castLevel: 3, saveDC: 15 },
        ...overrides
    }
});

const HUNGER_TEMPLATE = (tokenIds: string[], overrides: Record<string, unknown> = {}): TemplateFixture => ({
    id: `tpl-${tokenIds.join("-")}`,
    tokenIds: new Set(tokenIds),
    flags: HUNGER_FLAGS(overrides)
});

test("CPR helpers validate the API shape and read the version", () => {
    const env = installGlobals();
    try {
        assert.equal(getCprPremadesVersion(), "1.2.29");
        assert.equal(validateCprShape(), true);
    } finally {
        env.restore();
    }
});

test("validateCprShape is false when the CPR API is incomplete", () => {
    const env = installGlobals({ templateUtils: { /* no getTemplatesInToken */ } });
    try {
        assert.equal(validateCprShape(), false);
    } finally {
        env.restore();
    }
});

test("CPR integration registers the side-turn bridge when active", () => {
    const env = installGlobals();
    try {
        registerChrisPremadesIntegration();

        assert.equal(getCprPremadesIntegrationState().status, "active");
        assert.equal((globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnStart").length, 1);
        assert.equal((globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnEnd").length, 1);
        assert.equal(env.warnings.length, 0);
    } finally {
        env.restore();
    }
});

test("CPR integration is a no-op when the module is inactive", () => {
    const env = installGlobals({ cprActive: false });
    try {
        registerChrisPremadesIntegration();

        assert.equal(getCprPremadesIntegrationState().status, "inactive");
        assert.equal((globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnStart").length, 0);
    } finally {
        env.restore();
    }
});

test("CPR bridge fires turnStart for non-commander side tokens, not the commander", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [HUNGER_TEMPLATE(["commander", "member"])]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        const invoked = env.invocations.filter((i) => i.macro === "hunger-start").map((i) => i.tokenId);
        assert.deepEqual(invoked, ["member"]);
        assert.equal(env.invocations.some((i) => i.tokenId === "commander"), false);
    } finally {
        env.restore();
    }
});

test("CPR bridge fires turnEnd for non-commander side tokens", async () => {
    const env = installGlobals({
        // The ending side is still `combat.current` when sideTurnEnd is emitted
        // (the turn has not advanced yet), so the skip must target current, not
        // previous. Point previous at a different token to prove it is ignored.
        currentTokenId: "commander",
        previousTokenId: "member",
        templates: [HUNGER_TEMPLATE(["commander", "member"])]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnEnd("players");

        const invoked = env.invocations.filter((i) => i.macro === "hunger-end").map((i) => i.tokenId);
        assert.deepEqual(invoked, ["member"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge is a no-op off the primary GM client", async () => {
    const env = installGlobals({
        primaryGM: "other-gm",
        templates: [HUNGER_TEMPLATE(["commander", "member"])]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        assert.deepEqual(env.invocations, []);
    } finally {
        env.restore();
    }
});

test("CPR trigger castData uses -1 sentinels when the flag is missing", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [HUNGER_TEMPLATE(["member"], { castData: undefined })]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        const [invocation] = env.invocations;
        assert.deepEqual(invocation.castData, { castLevel: -1, saveDC: -1 });
    } finally {
        env.restore();
    }
});

test("CPR bridge passes through castData when present", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [HUNGER_TEMPLATE(["member"], { castData: { castLevel: 5, saveDC: 17 } })]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        const [invocation] = env.invocations;
        assert.deepEqual(invocation.castData, { castLevel: 5, saveDC: 17 });
    } finally {
        env.restore();
    }
});

test("CPR bridge dedupes overlapping same-name templates by max DC/level", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [
            {
                id: "cloudkill-low",
                tokenIds: new Set(["member"]),
                flags: { "chris-premades": { template: { name: "Cloudkill" }, macros: { template: ["cloudkillTemplate"] }, castData: { castLevel: 3, saveDC: 13 } } }
            },
            {
                id: "cloudkill-high",
                tokenIds: new Set(["member"]),
                flags: { "chris-premades": { template: { name: "Cloudkill" }, macros: { template: ["cloudkillTemplate"] }, castData: { castLevel: 5, saveDC: 17 } } }
            }
        ]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        const cloudkill = env.invocations.filter((i) => i.macro === "cloudkill");
        assert.equal(cloudkill.length, 1);
        assert.deepEqual(cloudkill[0].castData, { castLevel: 5, saveDC: 17 });
    } finally {
        env.restore();
    }
});

test("CPR bridge fires region turnEnd macros for member tokens (Wall of Fire)", async () => {
    const region: RegionFixture = {
        id: "region-wallfire",
        name: "Wall of Fire Region",
        flags: { "chris-premades": { macros: { region: ["wallOfFireRegion"] }, castData: { castLevel: 4, saveDC: 16 } } }
    };
    const env = installGlobals({
        templates: [],
        extraCombatants: [{ id: "combatant-member-2", sideId: "players", tokenId: "member2", regions: new Set([region as unknown]) }]
    });
    // The default `member` combatant has no region; the extra `member2` carries it.
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnEnd("players");

        const wallfire = env.invocations.filter((i) => i.macro === "wallfire-end").map((i) => i.tokenId);
        assert.deepEqual(wallfire, ["member2"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge excludes defeated combatants", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [HUNGER_TEMPLATE(["commander", "member", "downed"])],
        extraCombatants: [{ id: "combatant-downed", sideId: "players", tokenId: "downed", defeated: true }]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        const invoked = env.invocations.map((i) => i.tokenId);
        assert.equal(invoked.includes("downed"), false);
        assert.equal(invoked.includes("member"), true);
    } finally {
        env.restore();
    }
});

test("CPR bridge skips the commander via combat.current on turnEnd even when previous is unset", async () => {
    // CPR fires turnEnd for the ending side's commander regardless of whether a
    // previous turn existed, so the skip (combat.current) must hold even when
    // combat.previous is null/undefined.
    const env = installGlobals({
        currentTokenId: "commander",
        previousTokenId: null,
        templates: [HUNGER_TEMPLATE(["commander", "member"])]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnEnd("players");

        const invoked = env.invocations.filter((i) => i.macro === "hunger-end").map((i) => i.tokenId).sort();
        assert.deepEqual(invoked, ["member"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge never fires an everyTurn pass", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [
            {
                id: "tpl-everyturn",
                tokenIds: new Set(["member"]),
                flags: { "chris-premades": { template: { name: "Everyturn Thing" }, macros: { template: ["everyTurnMacro"] }, castData: { castLevel: 1, saveDC: 10 } } }
            }
        ]
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        assert.equal(env.invocations.some((i) => i.macro === "every-turn"), false);
    } finally {
        env.restore();
    }
});

// A stand-in for CPR's combatEvents.updateCombat: its source contains the pass
// markers the wrap looks for, and it records each dispatch so suppression is
// observable. (Markers as string literals keep them in Function.toString output.)
function createFakeCprUpdateCombat(sink: unknown[]) {
    return function fakeCprUpdateCombat(combat: unknown) {
        sink.push(combat);
        return ["turnStartSource", "turnEndSource", "turnStartNear", "everyTurn"];
    };
}

test("CPR updateCombat wrap suppresses within-side turn changes (commander switch)", async () => {
    const dispatches: unknown[] = [];
    const env = installGlobals({
        currentCombatantId: "combatant-commander",
        previousCombatantId: "combatant-member",
        cprUpdateCombat: createFakeCprUpdateCombat(dispatches)
    });
    try {
        registerChrisPremadesIntegration();

        const wrapped = env.getUpdateCombatHandler();
        assert.ok(typeof wrapped === "function");
        await wrapped!(env.combat);

        // Previous (member) and current (commander) are both on `players`, so this
        // is a commander switch and CPR's native dispatch must be suppressed.
        assert.equal(dispatches.length, 0);
    } finally {
        env.restore();
    }
});

test("CPR updateCombat wrap lets real cross-side advances dispatch natively", async () => {
    const dispatches: unknown[] = [];
    const env = installGlobals({
        currentCombatantId: "combatant-commander",
        previousCombatantId: "combatant-offside",
        cprUpdateCombat: createFakeCprUpdateCombat(dispatches)
    });
    try {
        registerChrisPremadesIntegration();

        const wrapped = env.getUpdateCombatHandler();
        await wrapped!(env.combat);

        // Previous (monsters) and current (players) differ → real advance → dispatch.
        assert.equal(dispatches.length, 1);
    } finally {
        env.restore();
    }
});

test("CPR updateCombat wrap never suppresses non-side-initiative combats", async () => {
    const dispatches: unknown[] = [];
    const env = installGlobals({
        sideCombat: false,
        currentCombatantId: "combatant-commander",
        previousCombatantId: "combatant-member",
        cprUpdateCombat: createFakeCprUpdateCombat(dispatches)
    });
    try {
        registerChrisPremadesIntegration();

        const wrapped = env.getUpdateCombatHandler();
        await wrapped!(env.combat);

        // Not a side combat → never suppress, even though both combatants would
        // otherwise resolve to the same disposition-based side.
        assert.equal(dispatches.length, 1);
    } finally {
        env.restore();
    }
});

test("CPR updateCombat wrap does not touch handlers that do not match CPR's shape", async () => {
    const dispatches: unknown[] = [];
    const notCpr = function someOtherHandler(combat: unknown) {
        dispatches.push(combat);
    };
    const env = installGlobals({ cprUpdateCombat: notCpr });
    try {
        registerChrisPremadesIntegration();

        // The non-matching handler is left untouched (still the original reference).
        assert.equal(env.getUpdateCombatHandler(), notCpr);
    } finally {
        env.restore();
    }
});
