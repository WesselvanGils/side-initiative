import {
    getCombatState,
    getCombatantsForSide,
    getSideCommanderId,
    isActorOnActiveSide
} from "../logic.js";
import { hooks, isPrimaryGMClient } from "../runtime.js";
import type { ActorLike, CombatLike, CombatantLike, SideTurnPayload } from "../types.js";

const REACTION_EFFECT_ID = "dnd5ereaction000";

function getActorKey(actor: ActorLike | null | undefined, combatant: CombatantLike | null | undefined): string | null {
    return actor?.uuid ?? combatant?.token?.uuid ?? combatant?.token?.document?.uuid ?? actor?.id ?? combatant?.id ?? null;
}

function collectCombatantActors(combatant: CombatantLike | null | undefined): ActorLike[] {
    const actors: ActorLike[] = [];
    const seen = new Set<string>();
    const tokenSources: Array<Record<string, any> | null | undefined> = [
        combatant?.token,
        combatant?.tokenDocument,
        combatant?.document?.token,
        combatant?.token?.document,
        combatant?.token?.object,
        combatant?.token?.object?.document
    ];

    const pushActor = (actor: ActorLike | null | undefined, fallbackKey: string | null = null): void => {
        if (!actor) return;
        const key = actor.uuid ?? fallbackKey ?? actor.id ?? null;
        if (!key || seen.has(key)) return;
        seen.add(key);
        actors.push(actor);
    };

    for (const token of tokenSources) {
        pushActor(token?.actor ?? token?.document?.actor ?? null, token?.uuid ?? token?.document?.uuid ?? combatant?.id ?? null);
    }

    for (const token of (combatant?.actor?.getActiveTokens?.() ?? []) as Array<Record<string, any>>) {
        pushActor(token?.actor ?? token?.document?.actor ?? null, token?.uuid ?? token?.document?.uuid ?? combatant?.id ?? null);
    }

    if (!actors.length) {
        pushActor(combatant?.actor ?? null, combatant?.id ?? null);
        pushActor(combatant?.document?.actor ?? null, combatant?.id ?? null);
    }

    return actors;
}

async function resetReactionUsed(actor: ActorLike | null | undefined): Promise<void> {
    if (!actor) return;

    try {
        await actor.effects?.get?.(REACTION_EFFECT_ID)?.delete?.();
    } catch (error) {
        const message = String((error as { message?: unknown })?.message ?? error ?? "");
        if (!message.includes(REACTION_EFFECT_ID) && !message.includes("does not exist")) {
            throw error;
        }
    }
    await actor.update?.({
        flags: {
            "midi-qol": {
                actions: {
                    reactionUsed: 0,
                    reactionsUsed: 0,
                    "-=reactionCombatRound": null
                }
            }
        }
    });
}

function getCommanderCombatantIds(combat: CombatLike | null | undefined, sideId: string | null | undefined): Set<string> {
    const ids = new Set<string>();
    const commanderId = getSideCommanderId(combat, sideId ?? "");
    if (commanderId) ids.add(commanderId);

    const state = getCombatState(combat);
    if (state.activeSideId === sideId && state.activeCombatantId) {
        ids.add(state.activeCombatantId);
    }

    return ids;
}

async function resetReactionsForSide(combat: CombatLike | null | undefined, sideId: string | null | undefined): Promise<void> {
    if (!combat?.started || !sideId) return;

    const actors = new Map<string, ActorLike>();
    const commanderCombatantIds = getCommanderCombatantIds(combat, sideId);
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        if (commanderCombatantIds.has(combatant?.id ?? "")) continue;
        for (const actor of collectCombatantActors(combatant)) {
            const key = getActorKey(actor, combatant);
            if (!actor || !key || actors.has(key)) continue;
            actors.set(key, actor);
        }
    }

    for (const actor of actors.values()) {
        try {
            await resetReactionUsed(actor);
        } catch (error) {
            console.warn("side-initiative | Failed to clear MidiQOL reaction state", actor, error);
        }
    }
}

/**
 * Register MidiQOL integration hooks.
 */
export function registerMidiQolIntegration(): void {
    hooks()?.on("midi-qol.preSetReactionUsed", (actor: ActorLike | null | undefined): boolean => {
        if (!actor) return true;
        return !isActorOnActiveSide(actor, game?.combat as CombatLike | null);
    });

    hooks()?.on("side-initiative.sideTurnStart", async ({ combat, sideId }: SideTurnPayload = {}): Promise<void> => {
        if (!game?.user?.isGM || !isPrimaryGMClient()) return;
        await resetReactionsForSide(combat ?? null, sideId ?? null);
    });
}
