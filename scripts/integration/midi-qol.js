import { SETTINGS } from "../constants.js";
import {
  getActiveSideId,
  getCombatantFromWorkflow,
  getCombatantSideId,
  getSideLabel,
  isOffSideWorkflow
} from "../logic.js";

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

function isSameSideAction(actor) {
  const combat = game.combat;
  if (!combat || !combat.started || !actor) return false;
  const combatant = actor.combatant ?? actor.token?.combatant ?? null;
  if (!combatant) return false;
  return getCombatantSideId(combatant) === getActiveSideId(combat);
}

export function registerMidiQolIntegration() {
  const rememberContext = (workflow) => {
    workflow.__sideInitiative = getWorkflowSideContext(workflow);
    return true;
  };

  const onWorkflowStart = async (workflow) => {
    rememberContext(workflow);
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

  Hooks.on("midi-qol.preSetReactionUsed", (actor) => {
    if (isSameSideAction(actor)) return false;
    return true;
  });

  Hooks.on("midi-qol.setReactionUsed", (actor, reactionEffect) => {
    if (!isSameSideAction(actor)) return true;
    if (reactionEffect?.updateSource) {
      reactionEffect.updateSource({ disabled: false });
    }
    return false;
  });
}
