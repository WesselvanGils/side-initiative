import { registerSideTurnEndFlusher, registerSideTurnStartFlusher } from "../api.js";
import { MODULE_ID } from "../constants.js";
import { getActiveSideId, getCombatantsForSide, isSideCombat, isTokenOnActiveSide } from "../logic.js";
import { getGame, getCat, hooks, isActiveGMClient } from "../runtime.js";
import type { CombatLike, SideTurnPayload, TokenLike } from "../types.js";
import { flushMidiSideTurnStart } from "./midi-qol.js";

const PATCH = Symbol.for("side-initiative.cat-combat");
const SUPPORTED_VERSION = "0.0.7";
let pending = Promise.resolve();
let registered = false;
let status = "inactive";

/** Foundry embedded collections are non-configurable own properties. A separate
 * proxy target permits a view without violating document property invariants. */
function documentView<T extends object>(document: T, overrides: Record<string, unknown>): T {
    return new Proxy(Object.create(Object.getPrototypeOf(document)), {
        get(_target, key) {
            if (typeof key === "string" && Object.hasOwn(overrides, key)) return overrides[key];
            const value = Reflect.get(document, key, document);
            return typeof value === "function" ? value.bind(document) : value;
        },
    });
}

export function getCatIntegrationState(): string {
    return status;
}

/** CAT 0.0.7 bundles this private handler; identifiers are minified, properties are not. */
export function isCatCombatHandler(fn: unknown): fn is (...args: any[]) => Promise<void> {
    if (typeof fn !== "function") return false;
    const source = Function.prototype.toString.call(fn);
    return [".processRegionActivities(", ".CombatEvent(", ".combatPasses.everyTurn", ".combatPasses.turnEnd"].every(
        (marker) => source.includes(marker),
    );
}

/**
 * Replay CAT's own dispatcher so region stacking, activity targets, turn stamps,
 * and registered CPR/embedded macros retain their native behavior. The synthetic
 * combat view selects one member without updating the real Combat document.
 */
export async function dispatchCatSide(
    original: (...args: any[]) => Promise<void>,
    { combat, sideId }: SideTurnPayload,
    start: boolean,
): Promise<void> {
    if (!combat?.started || !sideId || !isActiveGMClient()) return;
    if (start) await flushMidiSideTurnStart();
    const members = getCombatantsForSide(combat, sideId, { includeDefeated: false }).filter(
        (member) => member.token?.actor,
    );
    for (const [index, member] of members.entries()) {
        let token = member.token as any;
        if (start && index > 0) {
            // CAT runs everyTurn for the entire scene before turnStart. Only the
            // first member should do that. These read-only views leave all live
            // documents and collections untouched, including during awaits.
            const originalScene = token.parent;
            let skipEveryTurn = true;
            const scene = documentView(originalScene, {
                get tokens() {
                    if (!skipEveryTurn) return originalScene.tokens;
                    return documentView(originalScene.tokens, {
                        filter: () => {
                            skipEveryTurn = false;
                            return [];
                        },
                    });
                },
            });
            token = documentView(token, { parent: scene });
        }
        const selected = documentView(member, { token });
        const turn = combat.turn ?? 0;
        const round = combat.round ?? 1;
        const ref = { combatantId: member.id, tokenId: token.id, turn, round };
        const empty = { combatantId: null, tokenId: null, turn, round };
        const view = documentView(combat, {
            current: start ? ref : empty,
            previous: start ? empty : ref,
            combatants: { get: (id: string) => (id === member.id ? selected : undefined) },
        });
        // A nonzero round also handles turn index zero in CAT's truthy update guard.
        await original(view, { turn, round }, { sideInitiative: true });
    }
}

function enqueue(original: (...args: any[]) => Promise<void>, payload: SideTurnPayload, start: boolean): void {
    pending = pending
        .then(() => dispatchCatSide(original, payload, start))
        .catch((error) => {
            console.error(`${MODULE_ID} | CAT side-turn dispatch failed`, error);
        });
}

function activate(): void {
    if (registered) return;
    const game = getGame();
    const cat = getCat();
    if (!game?.modules?.get("cat")?.active) return;
    const registry = (globalThis as any).Hooks?.events?.updateCombat as any[] | undefined;
    const entry = registry?.find((entry) => isCatCombatHandler(entry.fn ?? entry));
    const utils = cat?.utils?.combatUtils;
    if (
        game.modules.get("cat")?.version !== SUPPORTED_VERSION ||
        typeof cat?.lib?.Events?.CombatEvent !== "function" ||
        typeof utils?.isOwnTurn !== "function" ||
        (isActiveGMClient() && !entry)
    ) {
        status = "unsupported";
        if (game.user?.isGM)
            (globalThis as any).ui?.notifications?.warn(
                game.i18n.localize("SIDE-INITIATIVE.Notifications.CatUnsupported"),
            );
        return;
    }
    if (!utils[PATCH]) {
        const original = utils.isOwnTurn;
        utils.isOwnTurn = function (token: TokenLike): boolean {
            const combat = (token?.document ?? token)?.combatant as any;
            const encounter = combat?.combat as CombatLike | undefined;
            if (encounter?.started && isSideCombat(encounter)) return isTokenOnActiveSide(token, encounter);
            return original.call(this, token);
        };
        utils[PATCH] = true;
    }
    if (entry) {
        const original = entry.fn ?? entry;
        const wrapped = function (this: unknown, combat: CombatLike, ...args: any[]) {
            if (isSideCombat(combat)) {
                // Starting combat uses Foundry's native update, not advanceSide,
                // so no sideTurnStart event is emitted for the first round.
                if (args[0]?.round === 1 && combat.previous?.round === 0) {
                    enqueue(original, { combat, sideId: getActiveSideId(combat) }, true);
                    return pending;
                }
                return;
            }
            return original.call(this, combat, ...args);
        };
        if (typeof entry === "function") registry![registry!.indexOf(entry)] = wrapped;
        else entry.fn = wrapped;
        hooks()?.on("side-initiative.sideTurnEnd", (payload: SideTurnPayload) => enqueue(original, payload, false));
        hooks()?.on("side-initiative.sideTurnStart", (payload: SideTurnPayload) => enqueue(original, payload, true));
        registerSideTurnEndFlusher(() => pending);
        registerSideTurnStartFlusher(() => pending);
    }
    registered = true;
    status = "active";
}

export function registerCatIntegration(): void {
    // CAT registers its combat hooks during ready and CPR registers its macros
    // at catReady. Wait for that event regardless of module loading order.
    hooks()?.once("catReady", activate);
}
