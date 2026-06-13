import { SETTINGS } from "../constants.js";
import { getActiveSideId, getCombatantFromWorkflow, getSideLabel, isOffSideWorkflow } from "../logic.js";

function shouldWarn(workflow) {
  const combat = game.combat;
  if (!combat || !combat.started) return false;
  if (!game.settings.get("side-initiative", SETTINGS.warnOnOffSide)) return false;
  if (workflow?.isReaction || workflow?.workflowOptions?.isReaction || workflow?.options?.isReaction) return false;
  const combatant = getCombatantFromWorkflow(workflow);
  if (!combatant) return false;
  return isOffSideWorkflow(combat, combatant);
}

export function registerMidiQolIntegration() {
  const onWorkflowStart = async (workflow) => {
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
}
