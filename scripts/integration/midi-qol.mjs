import {
    getCombatantsForSide,
    isActorOnActiveSide
} from "../logic.mjs";

function getReactionResetUpdates(actor) {
    const updates = {};
    const reaction = actor?.system?.attributes?.reaction;

    if (reaction && typeof reaction === "object") {
        if (Object.hasOwn(reaction, "used")) {
            updates["system.attributes.reaction.used"] = false;
        }
        if (Object.hasOwn(reaction, "value")) {
            if (typeof reaction.value === "boolean") {
                updates["system.attributes.reaction.value"] = true;
            } else if (Number.isFinite(Number(reaction.max))) {
                updates["system.attributes.reaction.value"] = Number(reaction.max);
            } else if (Number.isFinite(Number(reaction.value))) {
                updates["system.attributes.reaction.value"] = 1;
            }
        }
    }

    if (actor?.flags?.["midi-qol"] && Object.hasOwn(actor.flags["midi-qol"], "reactionUsed")) {
        updates["flags.midi-qol.reactionUsed"] = false;
    }

    return updates;
}

async function resetReactionUsed(actor) {
    if (!actor) return;
    const updates = getReactionResetUpdates(actor);
    if (!Object.keys(updates).length) return;
    await actor.update?.(updates);
}

async function resetReactionsForSide(combat, sideId) {
    if (!combat?.started || !sideId) return;

    const actors = new Map();
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        const actor = combatant?.actor ?? combatant?.document?.actor ?? null;
        if (!actor?.id && !actor) continue;
        const key = actor.id ?? combatant.id;
        if (actors.has(key)) continue;
        actors.set(key, actor);
    }

    for (const actor of actors.values()) {
        await resetReactionUsed(actor);
    }
}

/**
 * Register MidiQOL integration hooks.
 * @returns {void}
 */
export function registerMidiQolIntegration() {
    Hooks.on("midi-qol.preSetReactionUsed", async (actor) => {
        if (!actor) return true;
        return !isActorOnActiveSide(actor, game.combat);
    });

    Hooks.on("side-initiative.sideTurnStart", async ({ combat, sideId } = {}) => {
        await resetReactionsForSide(combat, sideId);
    });
}
