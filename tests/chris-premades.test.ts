import test from "node:test";
import assert from "node:assert/strict";
import {
    flushCprBridge,
    getCprPremadesIntegrationState,
    getCprPremadesVersion,
    registerChrisPremadesIntegration,
    resetCprPremadesIntegrationState,
    validateCprShape,
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
        },
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
    extraCombatants?: Array<{
        id: string;
        sideId: string;
        tokenId: string;
        defeated?: boolean;
        regions?: Set<unknown>;
        effects?: unknown[];
        items?: unknown[];
    }>;
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
        extraCombatants = [],
    } = options;

    const original = {
        game: globalThis.game,
        ui: globalThis.ui,
        Hooks: globalThis.Hooks,
        chrisPremades: (globalThis as { chrisPremades?: unknown }).chrisPremades,
    };

    const warnings: string[] = [];
    const invocations: Array<{
        macro: string;
        pass: string;
        tokenId: string;
        castData: { castLevel: number; saveDC: number };
        name: string;
    }> = [];

    function recorder(macro: string) {
        const fn = async ({
            trigger,
        }: {
            trigger: {
                token?: { id?: string };
                castData: { castLevel: number; saveDC: number };
                name?: string;
            };
        }) => {
            invocations.push({
                macro,
                pass: "",
                tokenId: trigger?.token?.id ?? "?",
                castData: trigger?.castData,
                name: trigger?.name ?? "",
            });
        };
        Object.defineProperty(fn, "name", { value: macro });
        return fn;
    }

    const defaultMacros = {
        hungerOfHadarTemplate: {
            template: [
                { pass: "turnStart", priority: 50, macro: recorder("hunger-start") },
                { pass: "turnEnd", priority: 50, macro: recorder("hunger-end") },
            ],
        },
        cloudkillTemplate: {
            template: [{ pass: "turnStart", priority: 50, macro: recorder("cloudkill") }],
        },
        everyTurnMacro: {
            template: [{ pass: "everyTurn", priority: 50, macro: recorder("every-turn") }],
        },
        wallOfFireRegion: {
            region: [{ pass: "turnEnd", priority: 50, macro: recorder("wallfire-end") }],
        },
        ...(options.macros ?? {}),
    };

    function createToken(
        id: string,
        regions: Set<unknown> = new Set(),
        actorExtras: { effects?: unknown[]; items?: unknown[] } = {},
    ) {
        const token = {
            id,
            uuid: `${id}-uuid`,
            object: { id } as { id: string; document?: unknown },
            regions,
            actor: {
                id: `${id}-actor`,
                uuid: `${id}-actor-uuid`,
                type: "character",
                effects: actorExtras.effects ?? [],
                items: actorExtras.items ?? [],
            },
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
            },
        };
    }

    const combatants = [
        createCombatant("combatant-commander", "players", commander),
        createCombatant("combatant-member", "players", member),
        createCombatant("combatant-offside", "monsters", offside),
    ] as Array<ReturnType<typeof createCombatant>> & {
        get?(id: string): ReturnType<typeof createCombatant> | null;
    };
    for (const extra of extraCombatants) {
        const token = createToken(extra.tokenId, extra.regions, {
            effects: extra.effects,
            items: extra.items,
        });
        combatants.push(createCombatant(extra.id, extra.sideId, token, extra.defeated ?? false));
    }
    combatants.get = (id: string) => combatants.find((combatant) => combatant.id === id) ?? null;

    const templateUtils = options.templateUtils ?? {
        getTemplatesInToken(placeable: { id?: string }) {
            const id = placeable?.id;
            return new Set(templates.filter((template) => template.tokenIds.has(id)));
        },
    };

    globalThis.game = {
        user: { id: "gm-1", isGM: true, active: true },
        users: { activeGM: { id: primaryGM, isGM: true, active: true } },
        combat: {
            started: true,
            current: {
                tokenId: currentTokenId,
                combatantId: currentCombatantId,
                turn: 2,
                round: 1,
            },
            previous:
                previousCombatantId === null && previousTokenId === null
                    ? undefined
                    : {
                          tokenId: previousTokenId,
                          combatantId: previousCombatantId,
                          turn: 1,
                          round: 1,
                      },
            combatants,
        },
        modules: {
            get(moduleId: string) {
                if (moduleId === "chris-premades")
                    return cprActive
                        ? { active: true, version, data: { version } }
                        : { active: false, version, data: { version } };
                return null;
            },
        },
        i18n: {
            localize(key: string) {
                return key;
            },
            format(key: string, data: unknown) {
                return `${key} ${JSON.stringify(data)}`;
            },
        },
    };
    globalThis.ui = {
        notifications: {
            warn(message: string) {
                warnings.push(message);
            },
        },
    };
    globalThis.Hooks = createHooks();
    if (options.cprUpdateCombat) {
        (globalThis.Hooks as ReturnType<typeof createHooks>).on("updateCombat", options.cprUpdateCombat);
    }
    (globalThis as { chrisPremades?: unknown }).chrisPremades = {
        macros: defaultMacros,
        utils: { templateUtils },
    };

    async function emitSideTurnStart(sideId: string) {
        const [handler] = (globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnStart");
        handler?.({
            combat: (globalThis.game as { combat: unknown }).combat,
            sideId,
        });
        await flushCprBridge();
    }
    async function emitSideTurnEnd(sideId: string) {
        const [handler] = (globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnEnd");
        handler?.({
            combat: (globalThis.game as { combat: unknown }).combat,
            sideId,
        });
        await flushCprBridge();
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
        emitSideTurnEnd,
    };
}

const HUNGER_FLAGS = (overrides: Record<string, unknown> = {}) => ({
    "chris-premades": {
        template: { name: "Hunger of Hadar" },
        macros: { template: ["hungerOfHadarTemplate"] },
        castData: { castLevel: 3, saveDC: 15 },
        ...overrides,
    },
});

const HUNGER_TEMPLATE = (tokenIds: string[], overrides: Record<string, unknown> = {}): TemplateFixture => ({
    id: `tpl-${tokenIds.join("-")}`,
    tokenIds: new Set(tokenIds),
    flags: HUNGER_FLAGS(overrides),
});

// An actor EFFECT carrying CPR 'combat' turn macros (the Blink pattern): the
// effect lists macro names under flags['chris-premades'].macros.combat, which CPR
// resolves to exports at chrisPremades.macros.<name>.combat.
const effectWithCombatMacro = (name: string, macroNames: string[], castLevel = 3, saveDC = 15) => ({
    name,
    flags: {
        "chris-premades": {
            macros: { combat: macroNames },
            castData: { castLevel, saveDC },
        },
    },
});

// An actor ITEM carrying CPR 'combat' turn macros (class features, etc.).
const itemWithCombatMacro = (name: string, macroNames: string[]) => ({
    name,
    flags: {
        "chris-premades": {
            macros: { combat: macroNames },
        },
    },
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
    const env = installGlobals({
        templateUtils: {
            /* no getTemplatesInToken */
        },
    });
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
        assert.equal(
            (globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnStart").length,
            1,
        );
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
        assert.equal(
            (globalThis.Hooks as ReturnType<typeof createHooks>).get("side-initiative.sideTurnStart").length,
            0,
        );
    } finally {
        env.restore();
    }
});

test("CPR bridge fires turnStart for every token on the side (no skip — CPR native is suppressed)", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [HUNGER_TEMPLATE(["commander", "member"])],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        const invoked = env.invocations
            .filter((i) => i.macro === "hunger-start")
            .map((i) => i.tokenId)
            .sort();
        // No skip: the commander is fired by the bridge too (CPR native is suppressed).
        assert.deepEqual(invoked, ["commander", "member"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge fires turnEnd for every token on the side", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        previousTokenId: "member",
        templates: [HUNGER_TEMPLATE(["commander", "member"])],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnEnd("players");

        const invoked = env.invocations
            .filter((i) => i.macro === "hunger-end")
            .map((i) => i.tokenId)
            .sort();
        assert.deepEqual(invoked, ["commander", "member"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge is a no-op off the primary GM client", async () => {
    const env = installGlobals({
        primaryGM: "other-gm",
        templates: [HUNGER_TEMPLATE(["commander", "member"])],
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
        templates: [HUNGER_TEMPLATE(["member"], { castData: undefined })],
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
        templates: [HUNGER_TEMPLATE(["member"], { castData: { castLevel: 5, saveDC: 17 } })],
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
                flags: {
                    "chris-premades": {
                        template: { name: "Cloudkill" },
                        macros: { template: ["cloudkillTemplate"] },
                        castData: { castLevel: 3, saveDC: 13 },
                    },
                },
            },
            {
                id: "cloudkill-high",
                tokenIds: new Set(["member"]),
                flags: {
                    "chris-premades": {
                        template: { name: "Cloudkill" },
                        macros: { template: ["cloudkillTemplate"] },
                        castData: { castLevel: 5, saveDC: 17 },
                    },
                },
            },
        ],
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
        flags: {
            "chris-premades": {
                macros: { region: ["wallOfFireRegion"] },
                castData: { castLevel: 4, saveDC: 16 },
            },
        },
    };
    const env = installGlobals({
        templates: [],
        extraCombatants: [
            {
                id: "combatant-member-2",
                sideId: "players",
                tokenId: "member2",
                regions: new Set([region as unknown]),
            },
        ],
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
        extraCombatants: [
            {
                id: "combatant-downed",
                sideId: "players",
                tokenId: "downed",
                defeated: true,
            },
        ],
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

test("CPR bridge fires for all side tokens on turnEnd even when previous is unset", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        previousTokenId: null,
        templates: [HUNGER_TEMPLATE(["commander", "member"])],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnEnd("players");

        const invoked = env.invocations
            .filter((i) => i.macro === "hunger-end")
            .map((i) => i.tokenId)
            .sort();
        assert.deepEqual(invoked, ["commander", "member"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge fires everyTurn passes at side start (preserves CPR's native everyTurn)", async () => {
    const env = installGlobals({
        currentTokenId: "commander",
        templates: [
            {
                id: "tpl-everyturn",
                tokenIds: new Set(["member"]),
                flags: {
                    "chris-premades": {
                        template: { name: "Everyturn Thing" },
                        macros: { template: ["everyTurnMacro"] },
                        castData: { castLevel: 1, saveDC: 10 },
                    },
                },
            },
        ],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        assert.equal(
            env.invocations.some((i) => i.macro === "every-turn"),
            true,
        );
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
        cprUpdateCombat: createFakeCprUpdateCombat(dispatches),
    });
    try {
        registerChrisPremadesIntegration();

        const wrapped = env.getUpdateCombatHandler();
        assert.ok(typeof wrapped === "function");
        await wrapped!(env.combat);

        assert.equal(dispatches.length, 0);
    } finally {
        env.restore();
    }
});

test("CPR updateCombat wrap suppresses ALL side-combat turn changes (cross-side advances too)", async () => {
    const dispatches: unknown[] = [];
    const env = installGlobals({
        currentCombatantId: "combatant-commander",
        previousCombatantId: "combatant-offside",
        cprUpdateCombat: createFakeCprUpdateCombat(dispatches),
    });
    try {
        registerChrisPremadesIntegration();

        const wrapped = env.getUpdateCombatHandler();
        await wrapped!(env.combat);

        // The bridge owns turnStart/turnEnd for side combats, so CPR's native
        // dispatch is suppressed even on a real cross-side advance — otherwise its
        // un-awaited commander workflow would run concurrently with the bridge.
        assert.equal(dispatches.length, 0);
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
        cprUpdateCombat: createFakeCprUpdateCombat(dispatches),
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

test("CPR bridge awaits each workflow before the next so slow macros never interleave", async () => {
    const log: string[] = [];
    const slow = async function slowMacro({ trigger }: { trigger: { token?: { id?: string } } }) {
        log.push(`start ${trigger.token?.id}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push(`end ${trigger.token?.id}`);
    };
    const env = installGlobals({
        macros: {
            slowTemplate: {
                template: [{ pass: "turnStart", priority: 50, macro: slow }],
            },
        },
        templates: [
            {
                id: "tpl-slow",
                tokenIds: new Set(["commander", "member"]),
                flags: {
                    "chris-premades": {
                        template: { name: "Slow" },
                        macros: { template: ["slowTemplate"] },
                        castData: { castLevel: 1, saveDC: 10 },
                    },
                },
            },
        ],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        // Each macro must fully complete (start + end) before the next begins —
        // this is what stops concurrent midi-qol workflows from clobbering targets.
        assert.deepEqual(log, ["start commander", "end commander", "start member", "end member"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge flushCprBridge drains the serialized turnEnd queue", async () => {
    const env = installGlobals({
        templates: [HUNGER_TEMPLATE(["commander", "member"])],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnEnd("players");
        // After awaiting, every turnEnd macro for the side has run.
        const invoked = env.invocations
            .filter((i) => i.macro === "hunger-end")
            .map((i) => i.tokenId)
            .sort();
        assert.deepEqual(invoked, ["commander", "member"]);
    } finally {
        env.restore();
    }
});

// --- combatUtils side-aware wrap ---
// CPR's combatUtils gates "on your turn" features on Foundry's single current
// combatant; in side initiative only the commander is current, so non-commander
// attackers never get Divine Smite's smite-picker (nor Favored Foe, Divine Fury,
// …). The wrap redefines "your turn" as "on the active side" for side combats.

interface CombatUtilsEnvOptions {
    activeSideId?: string;
    started?: boolean;
    sideCombat?: boolean;
}

function installCombatUtilsEnv(options: CombatUtilsEnvOptions = {}) {
    const { activeSideId = "players", started = true, sideCombat = true } = options;

    const original = {
        game: globalThis.game,
        ui: globalThis.ui,
        Hooks: globalThis.Hooks,
        canvas: (globalThis as { canvas?: unknown }).canvas,
        chrisPremades: (globalThis as { chrisPremades?: unknown }).chrisPremades,
    };

    const origIsOwnTurnCalls: unknown[] = [];
    const origPerTurnCheckCalls: Array<{
        entity: unknown;
        name: unknown;
        ownTurnOnly: unknown;
        tokenId: unknown;
    }> = [];
    const origGetCurrentCalls: number[] = [];

    function makeCombatant(id: string, sideId: string) {
        return {
            id,
            actor: { id: `${id}-actor`, uuid: `${id}-actor-uuid` },
            defeated: false,
            getFlag(scope: string, key: string) {
                if (sideCombat && scope === "side-initiative" && key === "sideId") return sideId;
                return null;
            },
        };
    }

    const commander = makeCombatant("c-commander", "players");
    const member = makeCombatant("c-member", "players");
    const offside = makeCombatant("c-offside", "monsters");

    function makeToken(id: string, combatant: ReturnType<typeof makeCombatant>) {
        // Placeable-like; isTokenOnActiveSide resolves the combatant via token.combatant.
        return {
            id,
            uuid: `${id}-uuid`,
            document: { id, uuid: `${id}-uuid` },
            combatant,
        };
    }
    const commanderToken = makeToken("commander", commander);
    const memberToken = makeToken("member", member);
    const offsideToken = makeToken("offside", offside);
    commander.token = commanderToken;
    member.token = memberToken;
    offside.token = offsideToken;

    const tokenById: Record<string, unknown> = {
        commander: commanderToken,
        member: memberToken,
        offside: offsideToken,
    };
    const combatants = [commander, member, offside] as Array<ReturnType<typeof makeCombatant>> & {
        get?(id: string): ReturnType<typeof makeCombatant> | null;
    };
    combatants.get = (id: string) => combatants.find((c) => c.id === id) ?? null;

    const combat = {
        id: "combat-1",
        started,
        round: 1,
        turn: 0,
        current: {
            tokenId: "commander",
            combatantId: "c-commander",
            turn: 0,
            round: 1,
        },
        combatants,
        getFlag(scope: string, key: string) {
            if (sideCombat && scope === "side-initiative" && key === "state") {
                return {
                    version: 2,
                    order: ["players", "monsters"],
                    sides: {},
                    lastRolledRound: null,
                    lastRolls: {},
                    activeSideId,
                    activeSideIndex: 0,
                    activeCombatantId: "c-commander",
                    commanderIds: { players: "c-commander", monsters: "c-offside" },
                };
            }
            return null;
        },
    };

    const combatUtils = {
        isOwnTurn(token: { id?: string }) {
            origIsOwnTurnCalls.push(token);
            return token?.id === "commander";
        },
        perTurnCheck(entity: unknown, name: unknown, ownTurnOnly: unknown, tokenId: unknown) {
            origPerTurnCheckCalls.push({ entity, name, ownTurnOnly, tokenId });
            return true;
        },
        getCurrentCombatantToken() {
            origGetCurrentCalls.push(origGetCurrentCalls.length);
            return commanderToken;
        },
    };

    globalThis.game = {
        user: { id: "gm-1", isGM: true, active: true },
        combat,
        modules: {
            get(id: string) {
                return id === "chris-premades"
                    ? { active: true, version: "1.3.53", data: { version: "1.3.53" } }
                    : null;
            },
        },
    } as unknown as typeof globalThis.game;
    globalThis.ui = {
        notifications: {
            warn() {
                /* noop */
            },
        },
    } as unknown as typeof globalThis.ui;
    globalThis.Hooks = createHooks() as unknown as typeof globalThis.Hooks;
    (globalThis as { canvas?: unknown }).canvas = {
        tokens: { get: (id: string) => tokenById[id] ?? null },
    };
    (globalThis as { chrisPremades?: unknown }).chrisPremades = {
        macros: {},
        utils: {
            templateUtils: { getTemplatesInToken: () => new Set() },
            combatUtils,
        },
    };

    function emitHook(name: string, ...args: unknown[]) {
        for (const fn of (globalThis.Hooks as unknown as ReturnType<typeof createHooks>).get(name)) fn(...args);
    }

    return {
        combatUtils,
        combat,
        commanderToken,
        memberToken,
        offsideToken,
        origIsOwnTurnCalls,
        origPerTurnCheckCalls,
        origGetCurrentCalls,
        emitHook,
        restore() {
            globalThis.game = original.game as typeof globalThis.game;
            globalThis.ui = original.ui as typeof globalThis.ui;
            globalThis.Hooks = original.Hooks as typeof globalThis.Hooks;
            (globalThis as { canvas?: unknown }).canvas = original.canvas;
            (globalThis as { chrisPremades?: unknown }).chrisPremades = original.chrisPremades;
            resetCprPremadesIntegrationState();
        },
    };
}

test("combatUtils.isOwnTurn treats active-side tokens as their own turn (side combat)", () => {
    const env = installCombatUtilsEnv();
    try {
        registerChrisPremadesIntegration();

        assert.equal(env.combatUtils.isOwnTurn(env.memberToken), true);
        assert.equal(env.combatUtils.isOwnTurn(env.offsideToken), false);
        // Side-aware path: CPR's original (current-combatant) check is bypassed.
        assert.equal(env.origIsOwnTurnCalls.length, 0);
    } finally {
        env.restore();
    }
});

test("combatUtils.isOwnTurn falls back to CPR's original for regular combats", () => {
    const env = installCombatUtilsEnv({ sideCombat: false });
    try {
        registerChrisPremadesIntegration();

        // Not a side combat → original runs with the token.
        assert.equal(env.combatUtils.isOwnTurn(env.memberToken), false);
        assert.equal(env.origIsOwnTurnCalls.length, 1);
    } finally {
        env.restore();
    }
});

test("combatUtils.perTurnCheck satisfies the ownTurnOnly gate for active-side tokens", () => {
    const env = installCombatUtilsEnv();
    try {
        registerChrisPremadesIntegration();

        // Member is on the active side → gate satisfied, CPR once-per-turn check
        // runs with ownTurnOnly=false (no literal-combatant comparison).
        assert.equal(env.combatUtils.perTurnCheck({ id: "fury" }, "divineFury", true, "member"), true);
        assert.equal(env.origPerTurnCheckCalls.length, 1);
        assert.equal(env.origPerTurnCheckCalls[0].ownTurnOnly, false);
        assert.equal(env.origPerTurnCheckCalls[0].tokenId, "member");
    } finally {
        env.restore();
    }
});

test("combatUtils.perTurnCheck blocks off-side tokens and skips CPR's check", () => {
    const env = installCombatUtilsEnv();
    try {
        registerChrisPremadesIntegration();

        assert.equal(env.combatUtils.perTurnCheck({ id: "fury" }, "divineFury", true, "offside"), false);
        // Off the active side → early false; CPR's once-per-turn check never runs.
        assert.equal(env.origPerTurnCheckCalls.length, 0);
    } finally {
        env.restore();
    }
});

test("combatUtils.perTurnCheck is untouched for non-ownTurnOnly / non-side cases", () => {
    const env = installCombatUtilsEnv({ sideCombat: false });
    try {
        registerChrisPremadesIntegration();

        // ownTurnOnly unchanged for regular combats.
        assert.equal(env.combatUtils.perTurnCheck({ id: "fury" }, "divineFury", true, "member"), true);
        assert.equal(env.origPerTurnCheckCalls[0].ownTurnOnly, true);
    } finally {
        env.restore();
    }
});

test("combatUtils.getCurrentCombatantToken answers with the tracked acting workflow token", () => {
    const env = installCombatUtilsEnv();
    try {
        registerChrisPremadesIntegration();

        // No active workflow → CPR's original (commander) is used.
        assert.equal(env.combatUtils.getCurrentCombatantToken(), env.commanderToken);
        assert.equal(env.origGetCurrentCalls.length, 1);

        // A non-commander attack starts a workflow → the attacker's token is tracked.
        env.emitHook("midi-qol.preAttackRoll", {
            id: "wf-member",
            token: env.memberToken,
        });
        assert.equal(env.combatUtils.getCurrentCombatantToken(), env.memberToken);
        // Divine Smite's `!= workflow.token` gate now passes for the member.
        assert.equal(env.origGetCurrentCalls.length, 1);
    } finally {
        env.restore();
    }
});

test("combatUtils.getCurrentCombatantToken stops tracking once the workflow completes", () => {
    const env = installCombatUtilsEnv();
    try {
        registerChrisPremadesIntegration();
        env.emitHook("midi-qol.preAttackRoll", {
            id: "wf-member",
            token: env.memberToken,
        });

        env.emitHook("midi-qol.RollComplete", { id: "wf-member" });

        // Tracker drained → falls back to CPR's original.
        assert.equal(env.combatUtils.getCurrentCombatantToken(), env.commanderToken);
        assert.equal(env.origGetCurrentCalls.length, 1);
    } finally {
        env.restore();
    }
});

test("combatUtils.getCurrentCombatantToken does not return an off-side tracked token", () => {
    const env = installCombatUtilsEnv();
    try {
        registerChrisPremadesIntegration();
        // An off-side workflow (e.g. a reaction on the opposing side) must not be
        // mistaken for the active turn-taker.
        env.emitHook("midi-qol.preAttackRoll", {
            id: "wf-offside",
            token: env.offsideToken,
        });
        assert.equal(env.combatUtils.getCurrentCombatantToken(), env.commanderToken);
    } finally {
        env.restore();
    }
});

test("combatUtils wrap is idempotent across repeated registration", () => {
    const env = installCombatUtilsEnv();
    try {
        registerChrisPremadesIntegration();
        const afterFirst = env.combatUtils.isOwnTurn;
        registerChrisPremadesIntegration();
        const afterSecond = env.combatUtils.isOwnTurn;

        // Second registration must not re-wrap (which would capture the wrapped fn
        // as the "original" and recurse on the non-side path).
        assert.equal(afterFirst, afterSecond);
    } finally {
        env.restore();
    }
});

test("CPR bridge fires an effect's combat turnEnd macro (Blink) for the side's token", async () => {
    const fired: Array<{ macro: string; tokenId: string }> = [];
    const blinkEnd = async ({ trigger }: { trigger: { token?: { id?: string } } }) => {
        fired.push({ macro: "blink-turnEnd", tokenId: trigger?.token?.id ?? "?" });
    };
    Object.defineProperty(blinkEnd, "name", { value: "blink-turnEnd" });
    const env = installGlobals({
        macros: {
            blinkBlinking: {
                combat: [{ pass: "turnEnd", priority: 50, macro: blinkEnd }],
            },
        },
        extraCombatants: [
            {
                id: "combatant-blinker",
                sideId: "players",
                tokenId: "blinker",
                effects: [effectWithCombatMacro("Blink: Blinking", ["blinkBlinking"])],
            },
        ],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnEnd("players");

        assert.deepEqual(fired, [{ macro: "blink-turnEnd", tokenId: "blinker" }]);
    } finally {
        env.restore();
    }
});

test("CPR bridge fires an effect's combat turnStart macro (Blink: Blinked Away) at side start", async () => {
    const fired: string[] = [];
    const blinkStart = async () => {
        fired.push("blink-turnStart");
    };
    Object.defineProperty(blinkStart, "name", { value: "blink-turnStart" });
    const env = installGlobals({
        macros: {
            blinkBlinkedAway: {
                combat: [{ pass: "turnStart", priority: 50, macro: blinkStart }],
            },
        },
        extraCombatants: [
            {
                id: "combatant-blinker",
                sideId: "players",
                tokenId: "blinker",
                effects: [effectWithCombatMacro("Blink: Blinked Away", ["blinkBlinkedAway"])],
            },
        ],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        assert.deepEqual(fired, ["blink-turnStart"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge fires an item's combat macro (covers the actor items path)", async () => {
    const fired: string[] = [];
    const hasteStart = async () => {
        fired.push("haste-turnStart");
    };
    Object.defineProperty(hasteStart, "name", { value: "haste-turnStart" });
    const env = installGlobals({
        macros: {
            hasteFeature: {
                combat: [{ pass: "turnStart", priority: 50, macro: hasteStart }],
            },
        },
        extraCombatants: [
            {
                id: "combatant-haster",
                sideId: "players",
                tokenId: "haster",
                items: [itemWithCombatMacro("Haste Feature", ["hasteFeature"])],
            },
        ],
    });
    try {
        registerChrisPremadesIntegration();
        await env.emitSideTurnStart("players");

        assert.deepEqual(fired, ["haste-turnStart"]);
    } finally {
        env.restore();
    }
});

test("CPR bridge does not fire an effect's combat macro for an off-side combatant", async () => {
    const fired: string[] = [];
    const blinkEnd = async () => {
        fired.push("blink-turnEnd");
    };
    Object.defineProperty(blinkEnd, "name", { value: "blink-turnEnd" });
    const env = installGlobals({
        macros: {
            blinkBlinking: {
                combat: [{ pass: "turnEnd", priority: 50, macro: blinkEnd }],
            },
        },
        extraCombatants: [
            {
                id: "combatant-enemy-blinker",
                sideId: "monsters",
                tokenId: "enemyblinker",
                effects: [effectWithCombatMacro("Blink: Blinking", ["blinkBlinking"])],
            },
        ],
    });
    try {
        registerChrisPremadesIntegration();
        // Advancing the PLAYERS side must not trigger the monsters-side Blink effect.
        await env.emitSideTurnEnd("players");

        assert.deepEqual(fired, []);
    } finally {
        env.restore();
    }
});
