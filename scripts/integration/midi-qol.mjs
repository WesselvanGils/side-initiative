import { SETTINGS } from "../constants.mjs";
import {
    getActiveSideId,
    getCombatantFromWorkflow,
    getCombatantSideId,
    getSideLabel,
    isOffSideWorkflow
} from "../logic.mjs";

const seenWorkflows = new WeakSet();
const seenWorkflowKeys = new Set();

function getWorkflowKey(workflow) {
    return workflow?.itemCardUuid ?? workflow?.uuid ?? workflow?.id ?? null;
}

function isReactionWorkflow(workflow) {
    return Boolean(
        workflow?.isReaction ||
        workflow?.workflowOptions?.isReaction ||
        workflow?.options?.isReaction ||
        workflow?.actionType === "reaction"
    );
}

function getWorkflowSideContext(workflow) {
    const combat = game.combat;
    const combatant = getCombatantFromWorkflow(workflow);
    const activeSideId = getActiveSideId(combat);
    const combatantSideId = getCombatantSideId(combatant);
    return {
        combatant,
        activeSideId,
        combatantSideId,
        sameSide: Boolean(activeSideId && combatantSideId && activeSideId === combatantSideId),
        isReaction: isReactionWorkflow(workflow)
    };
}

function shouldWarn(workflow) {
    const combat = game.combat;
    if (!combat || !combat.started) return false;
    if (!game.settings.get("side-initiative", SETTINGS.warnOnOffSide)) return false;
    const context = getWorkflowSideContext(workflow);
    if (context.isReaction) return false;
    return Boolean(context.combatant && isOffSideWorkflow(combat, context.combatant));
}

export function registerMidiQolIntegration() {
    const rememberContext = (workflow) => {
        const workflowKey = getWorkflowKey(workflow);
        if (!workflow || seenWorkflows.has(workflow) || (workflowKey && seenWorkflowKeys.has(workflowKey))) return false;
        seenWorkflows.add(workflow);
        if (workflowKey) seenWorkflowKeys.add(workflowKey);
        workflow.__sideInitiative = getWorkflowSideContext(workflow);
        return true;
    };

    const clearWorkflowContext = (workflow) => {
        const workflowKey = getWorkflowKey(workflow);
        if (workflowKey) seenWorkflowKeys.delete(workflowKey);
    };

    const onWorkflowStart = async (workflow) => {
        if (!rememberContext(workflow)) return true;
        if (!shouldWarn(workflow)) return true;

        const combat = game.combat;
        const combatant = getCombatantFromWorkflow(workflow);
        const activeSideId = getActiveSideId(combat);
        const activeSide = getSideLabel(activeSideId);
        const actorName = combatant?.name ?? workflow?.actor?.name ?? game.i18n.localize("SIDE-INITIATIVE.Notifications.NoCombatant");

        ui.notifications.warn(game.i18n.format("SIDE-INITIATIVE.Notifications.OffSide", {
            name: actorName,
            side: activeSide
        }));

        if (game.user?.isGM) {
            const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
            await ChatMessage.create({
                content: `<p><strong>Side Initiative</strong>: ${actorName} is acting outside the active side (${activeSide}). The workflow continues.</p>`,
                speaker: ChatMessage.getSpeaker({ user: game.user }),
                whisper
            });
        }

        return true;
    };

    Hooks.on("midi-qol.preItemRoll", onWorkflowStart);
    Hooks.on("midi-qol.preItemRollV2", onWorkflowStart);
    Hooks.on("midi-qol.preTargeting", onWorkflowStart);
    Hooks.on("midi-qol.preTargetingV2", onWorkflowStart);
    Hooks.on("midi-qol.RollComplete", clearWorkflowContext);
}
