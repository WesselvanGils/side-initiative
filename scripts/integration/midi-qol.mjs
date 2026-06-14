import {
    getCombatantsForSide,
    isActorOnActiveSide
} from "../logic.mjs";


function isActiveGMClient() {
    const activeGM = game.users?.activeGM ?? game.users?.getActiveGM?.() ?? Array.from(game.users?.contents ?? []).find((user) => user?.isGM && user?.active) ?? null;
    if (activeGM) return activeGM.id === game.user?.id;
    return Boolean(game.user?.isGM);
}

function getActorKey(actor, combatant) {
    return actor?.uuid ?? combatant?.token?.uuid ?? combatant?.token?.document?.uuid ?? actor?.id ?? combatant?.id ?? null;
}

function collectCombatantActors(combatant) {
    const actors = [];
    const seen = new Set();
    const tokenSources = [
        combatant?.token,
        combatant?.tokenDocument,
        combatant?.document?.token,
        combatant?.token?.document,
        combatant?.token?.object,
        combatant?.token?.object?.document
    ];
    const pushActor = (actor, fallbackKey = null) => {
        if (!actor) return;
        const key = actor?.uuid ?? fallbackKey ?? actor?.id ?? null;
        if (!key || seen.has(key)) return;
        seen.add(key);
        actors.push(actor);
    };

    for (const token of tokenSources) {
        pushActor(token?.actor ?? token?.document?.actor ?? null, token?.uuid ?? token?.document?.uuid ?? combatant?.id ?? null);
    }

    for (const token of combatant?.actor?.getActiveTokens?.() ?? []) {
        pushActor(token?.actor ?? token?.document?.actor ?? null, token?.uuid ?? token?.document?.uuid ?? combatant?.id ?? null);
    }

    if (!actors.length) {
        pushActor(combatant?.actor, combatant?.id ?? null);
        pushActor(combatant?.document?.actor, combatant?.id ?? null);
    }

    return actors;
}

async function resetReactionUsed(actor) {
    if (!actor) return;

    const reactionEffectId = "dnd5ereaction000";
    try {
        await actor.effects?.get?.(reactionEffectId)?.delete?.();
    } catch (error) {
        const message = String(error?.message ?? error ?? "");
        if (!message.includes(reactionEffectId) && !message.includes("does not exist")) {
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

function isPrimaryGMClient() {
    const primaryGMId = game.gps?.getPrimaryGM?.() ?? game.users?.activeGM?.id ?? game.users?.getActiveGM?.()?.id ?? null;
    if (primaryGMId) return game.user?.id === primaryGMId;
    return isActiveGMClient();
}

async function resetReactionsForSide(combat, sideId) {
    if (!combat?.started || !sideId) return;

    const actors = new Map();
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
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
 * @returns {void}
 */
export function registerMidiQolIntegration() {
    Hooks.on("midi-qol.preSetReactionUsed", (actor) => {
        if (!actor) return true;
        return !isActorOnActiveSide(actor, game.combat);
    });

    Hooks.on("side-initiative.sideTurnStart", async ({ combat, sideId } = {}) => {
        if (!game.user?.isGM || !isPrimaryGMClient()) return;
        await resetReactionsForSide(combat, sideId);
    });
}
