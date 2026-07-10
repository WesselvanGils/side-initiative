import test from "node:test";
import assert from "node:assert/strict";
import {
    classifyActionActivity,
    getExpectedAttackCount,
    getLegendaryActionDocuments,
    getLegendaryActionsIntegrationState,
    registerLegendaryActionsIntegration,
    resetLegendaryActionsIntegrationState,
} from "../src/integration/legendary-actions.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function featureItem(name: string): any {
    return { id: `feat-${slug(name)}`, name, type: "feat", system: { identifier: slug(name) } };
}

function legendaryItem(
    overrides: {
        id?: string;
        activityType?: string;
        activationType?: string;
        cost?: number;
        targetCount?: number;
    } = {},
): any {
    const {
        id = "leg-1",
        activityType = "attack",
        activationType = "legendary",
        cost = 1,
        targetCount = 1,
    } = overrides;
    return {
        id,
        name: "Legendary Swipe",
        img: "icon.svg",
        type: "feat",
        labels: { activation: "Legendary" },
        system: {
            range: { value: 5 },
            activities: [
                {
                    type: activityType,
                    activation: { type: activationType, value: cost },
                    consumption: { targets: [{ target: "resources.legact.value" }] },
                    target: { affects: { count: targetCount }, template: { count: 0 } },
                },
            ],
        },
    };
}

interface MakeActorOptions {
    id: string;
    uuid?: string;
    items?: any[];
    legact?: number | null;
    combatant?: any;
}

function makeActor({ id, uuid, items = [], legact = null, combatant = null }: MakeActorOptions): any {
    const actor: any = {
        id,
        uuid: uuid ?? `${id}-uuid`,
        name: id,
        items,
        combatant,
        system: {
            resources: legact == null ? {} : { legact: { value: legact, max: legact } },
        },
    };
    if (combatant) combatant.actor = actor;
    return actor;
}

interface MakeCombatantOptions {
    id: string;
    sideId: string;
    actor?: any;
    defeated?: boolean;
}

function makeCombatant({ id, sideId, actor = null, defeated = false }: MakeCombatantOptions): any {
    return {
        id,
        defeated,
        actor,
        token: actor?.token ?? null,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "sideId") return sideId;
            return null;
        },
    };
}

function makeCombat(combatants: any[], activeSideId: string, started = true): any {
    const sideIds = [
        ...new Set(
            combatants
                .map((c) => (c && typeof c.getFlag === "function" ? c.getFlag("side-initiative", "sideId") : null))
                .filter(Boolean),
        ),
    ];
    return {
        id: "combat-1",
        round: 1,
        started,
        combatants,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId,
                    order: sideIds,
                    sides: {},
                    commanderIds: {},
                };
            }
            return null;
        },
    };
}

function makeWorkflow({
    actor,
    activationType = "action",
    activityType = "attack",
    item,
}: {
    actor: any;
    activationType?: string;
    activityType?: string;
    item?: any;
}): any {
    return {
        actor,
        item: item ?? (undefined as any),
        activity: { activation: { type: activationType }, type: activityType },
    };
}

interface InstalledEnv {
    hooks: ReturnType<typeof createHooks>;
    dialogCalls: Array<Record<string, unknown>>;
    completeItemUseCalls: Array<Record<string, unknown>>;
    warnings: string[];
    restore(): void;
}

function createHooks() {
    const registry = new Map<string, Array<(...args: unknown[]) => unknown>>();
    return {
        on(name: string, handler: (...args: unknown[]) => unknown) {
            (registry.get(name) ?? registry.set(name, []).get(name)!).push(handler);
        },
        once() {
            /* not used */
        },
        callAll() {
            /* not used */
        },
        get(name: string) {
            return registry.get(name) ?? [];
        },
    };
}

interface InstallOptions {
    combat?: any;
    primaryGM?: boolean;
    cprShape?: boolean;
    settingOn?: boolean;
    cprActive?: boolean;
    midiActive?: boolean;
    dialogResult?: unknown;
}

function installGlobals(options: InstallOptions = {}): InstalledEnv {
    const {
        combat = null,
        primaryGM = true,
        cprShape = true,
        settingOn = true,
        cprActive = true,
        midiActive = true,
        dialogResult = { buttons: false },
    } = options;

    const original = {
        game: globalThis.game,
        ui: globalThis.ui,
        Hooks: globalThis.Hooks,
        chrisPremades: (globalThis as { chrisPremades?: unknown }).chrisPremades,
    };

    const hooks = createHooks();
    const dialogCalls: Array<Record<string, unknown>> = [];
    const completeItemUseCalls: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];

    const chrisPremades: any = {
        DialogApp: cprShape
            ? {
                  async dialog(title: string, content: string, inputs: unknown, buttons: unknown) {
                      dialogCalls.push({ title, content, inputs, buttons });
                      return await Promise.resolve(dialogResult);
                  },
              }
            : {},
        utils: {
            workflowUtils: {
                async completeItemUse(item: unknown, opts: unknown, midiOpts: unknown) {
                    completeItemUseCalls.push({ item, opts, midiOpts });
                },
            },
            dialogUtils: {
                async selectTargetDialog() {
                    return [];
                },
            },
            tokenUtils: {
                findNearby() {
                    return [];
                },
            },
            actorUtils: {
                getFirstToken() {
                    return null;
                },
            },
            genericUtils: {},
        },
    };

    globalThis.Hooks = hooks as unknown as typeof Hooks;
    globalThis.ui = { notifications: { warn: (message: string) => warnings.push(message) } } as never;
    globalThis.game = {
        combat: combat,
        user: { id: primaryGM ? "gm-1" : "other", isGM: true },
        users: {
            activeGM: { id: "gm-1", isGM: true, active: true },
            contents: [{ id: "gm-1", isGM: true, active: true }],
        },
        i18n: { localize: (key: string) => key },
        modules: {
            get(id: string) {
                if (id === "chris-premades") return { active: cprActive };
                if (id === "midi-qol") return { active: midiActive };
                return undefined;
            },
        },
        settings: {
            get(scope: string, key: string) {
                if (scope === "side-initiative" && key === "useLegendaryActionWindows") return settingOn;
                return undefined;
            },
        },
    } as never;
    (globalThis as { chrisPremades?: unknown }).chrisPremades = chrisPremades;

    return {
        hooks,
        dialogCalls,
        completeItemUseCalls,
        warnings,
        restore() {
            globalThis.game = original.game;
            globalThis.ui = original.ui;
            globalThis.Hooks = original.Hooks;
            (globalThis as { chrisPremades?: unknown }).chrisPremades = original.chrisPremades;
        },
    };
}

/* ------------------------------------------------------------------ */
/* getExpectedAttackCount                                              */
/* ------------------------------------------------------------------ */

test("getExpectedAttackCount returns 1 with no Extra Attack feature", () => {
    const actor = makeActor({ id: "fighter", items: [featureItem("Fighting Style")] });
    assert.equal(getExpectedAttackCount(actor), 1);
});

test("getExpectedAttackCount treats 'Extra Attack' as 2 attacks", () => {
    const actor = makeActor({ id: "fighter", items: [featureItem("Extra Attack")] });
    assert.equal(getExpectedAttackCount(actor), 2);
});

test("getExpectedAttackCount treats 'Two Extra Attacks' as 3 attacks", () => {
    const actor = makeActor({ id: "fighter", items: [featureItem("Two Extra Attacks")] });
    assert.equal(getExpectedAttackCount(actor), 3);
});

test("getExpectedAttackCount treats 'Three Extra Attacks' as 4 attacks", () => {
    const actor = makeActor({ id: "fighter", items: [featureItem("Three Extra Attacks")] });
    assert.equal(getExpectedAttackCount(actor), 4);
});

test("getExpectedAttackCount detects Extra Attack via identifier slug", () => {
    const actor = makeActor({
        id: "fighter",
        items: [{ id: "x", name: "Weird Localized Name", type: "feat", system: { identifier: "two-extra-attacks" } }],
    });
    assert.equal(getExpectedAttackCount(actor), 3);
});

test("getExpectedAttackCount takes the maximum grant when multiple features are present", () => {
    const actor = makeActor({
        id: "fighter",
        items: [featureItem("Extra Attack"), featureItem("Three Extra Attacks")],
    });
    assert.equal(getExpectedAttackCount(actor), 4);
});

/* ------------------------------------------------------------------ */
/* classifyActionActivity                                              */
/* ------------------------------------------------------------------ */

test("classifyActionActivity flags a weapon attack action as a triggering attack", () => {
    const weapon = { type: "weapon", system: { type: "weapon" } };
    assert.deepEqual(classifyActionActivity({ activation: { type: "action" }, type: "attack" }, weapon), {
        triggers: true,
        isAttack: true,
    });
});

test("classifyActionActivity treats a non-attack action as triggering but not an attack", () => {
    assert.deepEqual(classifyActionActivity({ activation: { type: "action" }, type: "cast" }, { type: "spell" }), {
        triggers: true,
        isAttack: false,
    });
});

test("classifyActionActivity does not treat an attack-spell as an Extra-Attack attack", () => {
    // Eldritch Blast is an action + attack activity but not a weapon, so it opens a window at once.
    const spell = { type: "spell", system: { type: "spell" } };
    assert.deepEqual(classifyActionActivity({ activation: { type: "action" }, type: "attack" }, spell), {
        triggers: true,
        isAttack: false,
    });
});

test("classifyActionActivity ignores bonus actions, reactions, specials and legendary actions", () => {
    for (const activationType of ["bonus", "reaction", "special", "legendary", "lair", "mythic"]) {
        assert.deepEqual(
            classifyActionActivity({ activation: { type: activationType }, type: "attack" }, { type: "weapon" }),
            { triggers: false, isAttack: false },
        );
    }
});

/* ------------------------------------------------------------------ */
/* getLegendaryActionDocuments                                         */
/* ------------------------------------------------------------------ */

test("getLegendaryActionDocuments returns opposing legendary creatures with spendable items", () => {
    const monster = makeActor({ id: "aboleth", items: [legendaryItem()], legact: 3 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster });
    const combat = makeCombat([monsterCombatant], "players");

    const docs = getLegendaryActionDocuments(combat);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].actor, monster);
    assert.equal(docs[0].items.length, 1);
});

test("getLegendaryActionDocuments excludes creatures on the active side", () => {
    const monster = makeActor({ id: "aboleth", items: [legendaryItem()], legact: 3 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "players", actor: monster });
    const combat = makeCombat([monsterCombatant], "players");

    assert.equal(getLegendaryActionDocuments(combat).length, 0);
});

test("getLegendaryActionDocuments excludes defeated creatures", () => {
    const monster = makeActor({ id: "aboleth", items: [legendaryItem()], legact: 3 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster, defeated: true });
    const combat = makeCombat([monsterCombatant], "players");

    assert.equal(getLegendaryActionDocuments(combat).length, 0);
});

test("getLegendaryActionDocuments excludes creatures with no legendary actions remaining", () => {
    const monster = makeActor({ id: "aboleth", items: [legendaryItem()], legact: 0 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster });
    const combat = makeCombat([monsterCombatant], "players");

    assert.equal(getLegendaryActionDocuments(combat).length, 0);
});

test("getLegendaryActionDocuments drops creatures whose legendary actions cost more than they have", () => {
    const monster = makeActor({ id: "aboleth", items: [legendaryItem({ cost: 3 })], legact: 1 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster });
    const combat = makeCombat([monsterCombatant], "players");

    assert.equal(getLegendaryActionDocuments(combat).length, 0);
});

test("getLegendaryActionDocuments excludes creatures with no qualifying legendary item", () => {
    const monster = makeActor({ id: "aboleth", items: [featureItem("Amphibious")], legact: 3 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster });
    const combat = makeCombat([monsterCombatant], "players");

    assert.equal(getLegendaryActionDocuments(combat).length, 0);
});

/* ------------------------------------------------------------------ */
/* Burst flow via the registered midi-qol.RollComplete handler         */
/* ------------------------------------------------------------------ */

function setupSideCombat(): { combat: any; pcActor: any } {
    const monster = makeActor({ id: "aboleth", items: [legendaryItem()], legact: 3 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster });
    const pcActor = makeActor({ id: "fighter", items: [featureItem("Extra Attack")] });
    const pcCombatant = makeCombatant({ id: "pc-1", sideId: "players", actor: pcActor });
    pcActor.combatant = pcCombatant;
    pcCombatant.actor = pcActor;
    const combat = makeCombat([pcCombatant, monsterCombatant], "players");
    return { combat, pcActor };
}

test("a fighter with Extra Attack is only prompted after their second attack", async () => {
    const { combat, pcActor } = setupSideCombat();
    const env = installGlobals({ combat });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        const weapon = { type: "weapon", system: { type: "weapon" } };
        await handler(makeWorkflow({ actor: pcActor, activityType: "attack", item: weapon }));
        assert.equal(env.dialogCalls.length, 0, "no prompt after the first attack");

        await handler(makeWorkflow({ actor: pcActor, activityType: "attack", item: weapon }));
        assert.equal(env.dialogCalls.length, 1, "prompt after the second (Extra Attack) attack");
    } finally {
        env.restore();
    }
});

test("a single non-attack action opens a window immediately", async () => {
    const { combat, pcActor } = setupSideCombat();
    const env = installGlobals({ combat });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        await handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );
        assert.equal(env.dialogCalls.length, 1);
    } finally {
        env.restore();
    }
});

test("bonus actions and reactions do not open a window", async () => {
    const { combat, pcActor } = setupSideCombat();
    const env = installGlobals({ combat });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        for (const activationType of ["bonus", "reaction", "special"]) {
            await handler(
                makeWorkflow({ actor: pcActor, activationType, activityType: "attack", item: { type: "weapon" } }),
            );
        }
        assert.equal(env.dialogCalls.length, 0);
    } finally {
        env.restore();
    }
});

test("no prompt when no opposing legendary creature can act", async () => {
    // Monster is out of legendary actions.
    const monster = makeActor({ id: "aboleth", items: [legendaryItem()], legact: 0 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster });
    const pcActor = makeActor({ id: "fighter", items: [] });
    const pcCombatant = makeCombatant({ id: "pc-1", sideId: "players", actor: pcActor });
    pcActor.combatant = pcCombatant;
    const combat = makeCombat([pcCombatant, monsterCombatant], "players");

    const env = installGlobals({ combat });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        await handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );
        assert.equal(env.dialogCalls.length, 0);
    } finally {
        env.restore();
    }
});

test("windows only open on the primary GM client", async () => {
    const { combat, pcActor } = setupSideCombat();
    const env = installGlobals({ combat, primaryGM: false });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        await handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );
        assert.equal(env.dialogCalls.length, 0);
    } finally {
        env.restore();
    }
});

test("a second action taken while a prompt is open does not stack a second dialog", async () => {
    const { combat, pcActor } = setupSideCombat();
    let resolveDialog!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
        resolveDialog = resolve;
    });
    const env = installGlobals({ combat, dialogResult: pending });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        // First action opens a prompt (pending); second action arrives before it resolves.
        void handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );
        void handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );

        resolveDialog({ buttons: false });
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(env.dialogCalls.length, 1);
    } finally {
        env.restore();
    }
});

test("the feature is inert while the setting is off", async () => {
    const { combat, pcActor } = setupSideCombat();
    const env = installGlobals({ combat, settingOn: false });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        await handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );
        assert.equal(env.dialogCalls.length, 0);
    } finally {
        env.restore();
    }
});

test("registration warns once and stays inactive when Chris' Premades or MidiQOL is missing", () => {
    const env = installGlobals({ cprActive: false, settingOn: false });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const state = getLegendaryActionsIntegrationState();

        assert.equal(state.status, "inactive");
        assert.equal(env.hooks.get("midi-qol.RollComplete").length, 0);
        // Feature off → no nag about missing dependencies.
        assert.equal(env.warnings.length, 0);

        // Toggling the setting on surfaces the dependency warning (warned once).
        (globalThis.game as { settings: { get: (s: string, k: string) => unknown } }).settings.get = () => true;
        registerLegendaryActionsIntegration();
        assert.equal(env.warnings.length, 1);
    } finally {
        env.restore();
    }
});

test("a graceful disable (no dialog) when the CPR API shape is unsupported", async () => {
    const { combat, pcActor } = setupSideCombat();
    const env = installGlobals({ combat, cprShape: false });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        await handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );
        assert.equal(env.dialogCalls.length, 0);
        assert.equal(env.warnings.length, 1);
    } finally {
        env.restore();
    }
});

test("selecting a legendary action executes it via CPR workflowUtils.completeItemUse", async () => {
    const { combat, pcActor } = setupSideCombat();
    const leg = legendaryItem({ id: "leg-1" });
    // Rebuild the monster so the chosen item id matches the prompt result.
    const monster = makeActor({ id: "aboleth", items: [leg], legact: 3 });
    const monsterCombatant = makeCombatant({ id: "npc-1", sideId: "monsters", actor: monster });
    const pcCombatant = makeCombatant({ id: "pc-1", sideId: "players", actor: pcActor });
    pcActor.combatant = pcCombatant;
    const combat2 = makeCombat([pcCombatant, monsterCombatant], "players");

    const env = installGlobals({ combat: combat2, dialogResult: { buttons: "leg-1" } });
    try {
        resetLegendaryActionsIntegrationState();
        registerLegendaryActionsIntegration();
        const [handler] = env.hooks.get("midi-qol.RollComplete");

        await handler(
            makeWorkflow({ actor: pcActor, activationType: "action", activityType: "cast", item: { type: "spell" } }),
        );

        assert.equal(env.completeItemUseCalls.length, 1);
        assert.equal(env.completeItemUseCalls[0].item, leg);
        // No token available in the fixture, so execution proceeds without explicit targets.
        assert.deepEqual(env.completeItemUseCalls[0].midiOpts, {});
    } finally {
        env.restore();
    }
});
