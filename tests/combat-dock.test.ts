import test from "node:test";
import assert from "node:assert/strict";
import { getDockState, resolveCombatantImg, resolvePrimaryPartyArt } from "../src/ui/combat-dock.js";

interface CombatantOptions {
    id: string;
    sideId: string;
    name?: string;
    img?: string | null;
    actorImg?: string | null;
    defeated?: boolean;
}

function makeCombatant(options: CombatantOptions): Record<string, unknown> {
    const { id, sideId, name = id, img = null, actorImg = null, defeated = false } = options;
    return {
        id,
        name,
        defeated,
        img,
        actor: actorImg ? { img: actorImg } : null,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "sideId") return sideId;
            return undefined;
        },
    };
}

interface CombatOptions {
    activeSideId?: string | null;
    order?: string[];
    commanderIds?: Record<string, string>;
    round?: number;
    started?: boolean;
}

function makeCombat(combatants: Array<Record<string, unknown>>, options: CombatOptions = {}): Record<string, unknown> {
    const map = new Map(combatants.map((combatant) => [combatant.id as string, combatant]));
    return {
        id: "combat-1",
        round: options.round ?? 1,
        turn: 0,
        started: options.started ?? true,
        combatants: map,
        turns: combatants,
        getFlag(scope: string, key: string) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: options.activeSideId ?? null,
                    order: options.order ?? ["players", "monsters"],
                    sides: {},
                    commanderIds: options.commanderIds ?? {},
                };
            }
            return undefined;
        },
    };
}

test("getDockState maps players to the left and monsters to the right with the active side flagged", () => {
    const combat = makeCombat(
        [
            makeCombatant({ id: "pc-1", sideId: "players", img: "pc1.png" }),
            makeCombatant({ id: "npc-1", sideId: "monsters", img: "npc1.png" }),
        ],
        { activeSideId: "players" },
    );

    const state = getDockState(combat);

    assert.equal(state.visible, true);
    assert.equal(state.started, true);
    assert.equal(state.round, 1);
    assert.equal(state.activeSideId, "players");
    assert.equal(state.dividerActive, false);

    assert.equal(state.left?.sideId, "players");
    assert.equal(state.left?.combatantId, "pc-1");
    assert.equal(state.left?.img, "pc1.png");
    assert.equal(state.left?.active, true);
    assert.equal(state.left?.empty, false);

    assert.equal(state.right?.sideId, "monsters");
    assert.equal(state.right?.combatantId, "npc-1");
    assert.equal(state.right?.active, false);
});

test("getDockState flags the right panel when monsters are the active side", () => {
    const combat = makeCombat(
        [makeCombatant({ id: "pc-1", sideId: "players" }), makeCombatant({ id: "npc-1", sideId: "monsters" })],
        { activeSideId: "monsters" },
    );

    const state = getDockState(combat);

    assert.equal(state.activeSideId, "monsters");
    assert.equal(state.left?.active, false);
    assert.equal(state.right?.active, true);
    assert.equal(state.dividerActive, false);
});

test("getDockState highlights the divider when the active side is neither players nor monsters", () => {
    const combat = makeCombat(
        [
            makeCombatant({ id: "pc-1", sideId: "players" }),
            makeCombatant({ id: "ally-1", sideId: "allies" }),
            makeCombatant({ id: "npc-1", sideId: "monsters" }),
        ],
        { activeSideId: "allies" },
    );

    const state = getDockState(combat);

    assert.equal(state.activeSideId, "allies");
    assert.equal(state.dividerActive, true);
    assert.equal(state.left?.active, false);
    assert.equal(state.right?.active, false);
});

test("getDockState resolves a configured commander as the side representative", () => {
    const combat = makeCombat(
        [
            makeCombatant({ id: "pc-1", sideId: "players", img: "pc1.png" }),
            makeCombatant({ id: "pc-2", sideId: "players", img: "pc2.png" }),
        ],
        { activeSideId: "players", commanderIds: { players: "pc-2" } },
    );

    const state = getDockState(combat);

    assert.equal(state.left?.combatantId, "pc-2");
    assert.equal(state.left?.img, "pc2.png");
});

test("getDockState falls back to the actor image when the token image is missing", () => {
    const combat = makeCombat([makeCombatant({ id: "pc-1", sideId: "players", img: null, actorImg: "actor.png" })], {
        activeSideId: "players",
    });

    const state = getDockState(combat);

    assert.equal(state.left?.img, "actor.png");
});

test("getDockState marks a panel empty when its side has no representatives", () => {
    const combat = makeCombat([makeCombatant({ id: "pc-1", sideId: "players", img: "pc1.png" })], {
        activeSideId: "players",
    });

    const state = getDockState(combat);

    assert.equal(state.left?.empty, false);
    assert.equal(state.right?.empty, true);
    assert.equal(state.right?.img, null);
    assert.equal(state.right?.combatantId, null);
});

test("getDockState is hidden when the feature is disabled", () => {
    const combat = makeCombat(
        [makeCombatant({ id: "pc-1", sideId: "players" }), makeCombatant({ id: "npc-1", sideId: "monsters" })],
        { activeSideId: "players" },
    );

    const state = getDockState(combat, { enabled: false });

    assert.equal(state.visible, false);
});

test("getDockState is visible as soon as a combat exists, even before sides are rolled", () => {
    const combatants = [
        makeCombatant({ id: "pc-1", sideId: "players" }),
        makeCombatant({ id: "npc-1", sideId: "monsters" }),
    ];
    const map = new Map(combatants.map((combatant) => [combatant.id as string, combatant]));
    const combat = {
        id: "combat-new",
        round: 0,
        turn: 0,
        started: false,
        combatants: map,
        turns: combatants,
        getFlag() {
            return undefined;
        },
    };

    const state = getDockState(combat);

    assert.equal(state.visible, true);
    assert.equal(state.started, false);
});

test("getDockState reports the round and started flag from the combat", () => {
    const combat = makeCombat(
        [makeCombatant({ id: "pc-1", sideId: "players" }), makeCombatant({ id: "npc-1", sideId: "monsters" })],
        { activeSideId: "monsters", round: 4, started: false },
    );

    const state = getDockState(combat);

    assert.equal(state.round, 4);
    assert.equal(state.started, false);
});

test("resolveCombatantImg prefers the actor (avatar) image then the token image", () => {
    assert.equal(
        resolveCombatantImg(makeCombatant({ id: "a", sideId: "players", img: "token.png", actorImg: "actor.png" })),
        "actor.png",
    );
    assert.equal(
        resolveCombatantImg(makeCombatant({ id: "a", sideId: "players", img: "token.png", actorImg: null })),
        "token.png",
    );
    assert.equal(resolveCombatantImg(makeCombatant({ id: "a", sideId: "players", img: null, actorImg: null })), null);
    assert.equal(resolveCombatantImg(null), null);
});

test("getDockState uses the primary party art for the players panel when enabled", () => {
    const combat = makeCombat(
        [
            makeCombatant({ id: "pc-1", sideId: "players", img: "commander.png" }),
            makeCombatant({ id: "npc-1", sideId: "monsters", img: "monster.png" }),
        ],
        { activeSideId: "players" },
    );

    const state = getDockState(combat, {
        usePrimaryPartyArt: true,
        primaryParty: { img: "party.png", name: "The Brave" },
    });

    assert.equal(state.left?.img, "party.png");
    assert.equal(state.left?.label, "The Brave");
    // The monsters panel is unaffected.
    assert.equal(state.right?.img, "monster.png");
});

test("getDockState falls back to the commander when primary party art is unavailable", () => {
    const combat = makeCombat([makeCombatant({ id: "pc-1", sideId: "players", img: "commander.png" })], {
        activeSideId: "players",
    });

    const withParty = getDockState(combat, { usePrimaryPartyArt: true, primaryParty: null });
    assert.equal(withParty.left?.img, "commander.png");

    const noArt = getDockState(combat, { usePrimaryPartyArt: true, primaryParty: { img: null, name: "The Brave" } });
    assert.equal(noArt.left?.img, "commander.png");
});

test("getDockState ignores the primary party when the setting is off", () => {
    const combat = makeCombat([makeCombatant({ id: "pc-1", sideId: "players", img: "commander.png" })], {
        activeSideId: "players",
    });

    const state = getDockState(combat, {
        usePrimaryPartyArt: false,
        primaryParty: { img: "party.png", name: "The Brave" },
    });

    assert.equal(state.left?.img, "commander.png");
});

test("resolvePrimaryPartyArt reads the dnd5e primary party setting and falls back gracefully", () => {
    const original = globalThis.game;

    // dnd5e active, primary party resolves to a group actor with art.
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: {
            get(scope, key) {
                if (scope === "dnd5e" && key === "primaryParty")
                    return { actor: { img: "party.png", name: "The Brave" } };
                return null;
            },
        },
    } as never;
    assert.deepEqual(resolvePrimaryPartyArt(), { img: "party.png", name: "The Brave" });

    // `.actor` may be a lazy getter function returning the actor.
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: {
            get() {
                return { actor: () => ({ img: "lazy.png", name: "Lazy" }) };
            },
        },
    } as never;
    assert.deepEqual(resolvePrimaryPartyArt(), { img: "lazy.png", name: "Lazy" });

    // No party set.
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: {
            get() {
                return null;
            },
        },
    } as never;
    assert.equal(resolvePrimaryPartyArt(), null);

    // Non-dnd5e system: never touches the setting.
    let touched = false;
    globalThis.game = {
        system: { id: "pf2e" },
        settings: {
            get() {
                touched = true;
                return null;
            },
        },
    } as never;
    assert.equal(resolvePrimaryPartyArt(), null);
    assert.equal(touched, false);

    globalThis.game = original;
});
