import {
    isActorOnActiveSide
} from "../logic.mjs";

export function registerMidiQolIntegration() {
    Hooks.on("midi-qol.preSetReactionUsed", async (actor) => {
        if (!actor) return true;
        return !isActorOnActiveSide(actor, game.combat);
    });
}
