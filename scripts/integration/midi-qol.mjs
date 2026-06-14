import {
    getCombatantsForSide,
    isActorOnActiveSide
} from "../logic.mjs";

function getMidiQolApi() {
    return globalThis.MidiQOL ?? globalThis.midiQOL ?? null;
}

function isActiveGMClient() {
    const activeGM = game.users?.activeGM ?? game.users?.getActiveGM?.() ?? Array.from(game.users?.contents ?? []).find((user) => user?.isGM && user?.active) ?? null;
    if (activeGM) return activeGM.id === game.user?.id;
    return Boolean(game.user?.isGM);
}

function getActorKey(actor, combatant) {
    return actor?.id ?? actor?.uuid ?? combatant?.id ?? null;
}

async function resetReactionUsed(actor) {
    if (!actor) return;
    const midiQol = getMidiQolApi();

    if (typeof midiQol?.setReactionUsed === "function") {
        await midiQol.setReactionUsed(actor, false);
        return;
    }

    if (typeof midiQol?.removeReactionUsed === "function") {
        await midiQol.removeReactionUsed(actor, true);
    }
}

async function resetReactionsForSide(combat, sideId) {
    if (!combat?.started || !sideId) return;

    const actors = new Map();
    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        const actor = combatant?.actor ?? combatant?.document?.actor ?? null;
        const key = getActorKey(actor, combatant);
        if (!actor || !key || actors.has(key)) continue;
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
    Hooks.on("midi-qol.preSetReactionUsed", (actor) => {
        if (!actor) return true;
        return !isActorOnActiveSide(actor, game.combat);
    });

    Hooks.on("side-initiative.sideTurnStart", async ({ combat, sideId } = {}) => {
        if (!game.user?.isGM || !isActiveGMClient()) return;
        await resetReactionsForSide(combat, sideId);
    });
}
