import { SETTINGS } from "../constants.js";
import { getActiveSideId, getSideSummary, hasCombatantActedThisRound, isOffSideWorkflow, normalizeSideId } from "../logic.js";
import { openSideEditor } from "./side-editor.js";

function getRoot(html) {
  return html?.[0] ?? html;
}

function iconButton(label, icon, dataset = {}) {
  const attrs = Object.entries(dataset).map(([key, value]) => `data-${key}="${String(value)}"`).join(" ");
  return `<button type="button" class="control" ${attrs} aria-label="${label}" title="${label}"><i class="${icon}"></i></button>`;
}

function renderSideChip(side, currentSideId) {
  const active = normalizeSideId(side.id) === normalizeSideId(currentSideId);
  const colorStyle = side.color ? `style="border-color:${side.color};"` : "";
  return `
    <span class="side-chip${active ? " is-current" : ""}" ${colorStyle}>
      <span>${side.name}</span>
      <strong>${side.roll ?? "?"}</strong>
    </span>
  `;
}

export function renderCombatTracker(app, html) {
  if (!game.user?.isGM && !game.user?.can?.("COMBAT_TRACKER")) return;
  if (!game.settings.get("side-initiative", SETTINGS.showTrackerControls)) return;

  const combat = game.combat;
  const root = getRoot(html);
  if (!combat || !root) return;

  const existing = root.querySelector(".side-initiative-panel");
  existing?.remove();

  const sides = getSideSummary(combat);
  const activeSideId = getActiveSideId(combat);
  const panel = document.createElement("section");
  panel.className = "side-initiative-panel";

  const statusLines = [];
  statusLines.push(`<div class="side-initiative-row"><strong>${game.i18n.localize("SIDE-INITIATIVE.UI.SideOrder")}:</strong> ${sides.length ? sides.map((side) => renderSideChip(side, activeSideId)).join("") : game.i18n.localize("SIDE-INITIATIVE.UI.NoSides")}</div>`);
  statusLines.push(`<div class="side-initiative-row"><strong>${game.i18n.localize("SIDE-INITIATIVE.UI.ActiveSide")}:</strong> <span class="side-chip is-current">${activeSideId ?? game.i18n.localize("SIDE-INITIATIVE.UI.NoCombat")}</span></div>`);

  const toolbar = document.createElement("div");
  toolbar.className = "side-initiative-toolbar";
  toolbar.innerHTML = [
    iconButton(game.i18n.localize("SIDE-INITIATIVE.UI.RollSideInitiative"), "fas fa-dice-d20", { action: "roll-side-init" }),
    iconButton(game.i18n.localize("SIDE-INITIATIVE.UI.EditSides"), "fas fa-pen-to-square", { action: "edit-sides" }),
    iconButton(game.i18n.localize("SIDE-INITIATIVE.UI.MarkActed"), "fas fa-check", { action: "mark-acted" }),
    iconButton(game.i18n.localize("SIDE-INITIATIVE.UI.ClearActed"), "fas fa-eraser", { action: "clear-acted" })
  ].join("");

  const status = document.createElement("div");
  status.innerHTML = statusLines.join("");

  panel.appendChild(status);
  panel.appendChild(toolbar);
  root.prepend(panel);

  const combatantRows = Array.from(root.querySelectorAll(".combatant"));
  const combatantList = Array.from(combat.combatants ?? []);
  for (const [index, row] of combatantRows.entries()) {
    if (!row.dataset.combatantId && combatantList[index]) {
      row.dataset.combatantId = combatantList[index].id;
    }
  }

  toolbar.querySelector('[data-action="roll-side-init"]')?.addEventListener("click", async () => {
    await game.sideInitiative.rollSideInitiative(combat);
    ui.notifications.info(game.i18n.localize("SIDE-INITIATIVE.Notifications.SideRolled"));
    app.render?.();
  });

  toolbar.querySelector('[data-action="edit-sides"]')?.addEventListener("click", () => openSideEditor(combat));

  toolbar.querySelector('[data-action="mark-acted"]')?.addEventListener("click", async () => {
    const currentCombatant = combat.combatant;
    if (!currentCombatant) return;
    await game.sideInitiative.markActed(currentCombatant, combat.round);
    app.render?.();
  });

  toolbar.querySelector('[data-action="clear-acted"]')?.addEventListener("click", async () => {
    for (const combatant of combat.combatants ?? []) {
      await combatant.unsetFlag("side-initiative", "actedRound");
    }
    app.render?.();
  });

  for (const row of root.querySelectorAll(".combatant")) {
    const combatantId = row.dataset.combatantId;
    const combatant = combat.combatants?.get?.(combatantId) ?? Array.from(combat.combatants ?? []).find((entry) => entry.id === combatantId);
    if (!combatant) continue;

    const rowState = getSideSummary(combat).find((side) => side.combatantIds.includes(combatant.id));
    const badge = document.createElement("span");
    badge.className = `side-initiative-badge${rowState?.active ? " is-active" : ""}${hasCombatantActedThisRound(combatant, combat) ? " is-acted" : ""}`;
    badge.textContent = rowState?.name ?? normalizeSideId(combatant.getFlag("side-initiative", "sideId") ?? "neutral");
    badge.style.borderColor = rowState?.color ?? "";
    const controls = row.querySelector(".combatant-controls") ?? row;
    controls.appendChild(badge);
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "control";
    jump.title = "Take Turn";
    jump.innerHTML = '<i class="fas fa-person-running"></i>';
    jump.addEventListener("click", async () => {
      const index = Array.from(combat.combatants ?? []).findIndex((entry) => entry.id === combatant.id);
      if (index >= 0) await combat.update({ turn: index });
    });
    controls.appendChild(jump);
  }
}

export function bindCombatTrackerRowData(app, html) {
  const root = getRoot(html);
  if (!root) return;
  for (const [index, row] of Array.from(root.querySelectorAll(".combatant")).entries()) {
    if (!row.dataset.combatantId) {
      const combatant = app?.combat?.combatants?.[index] ?? app?.combat?.combatants?.contents?.[index];
      if (combatant) row.dataset.combatantId = combatant.id;
    }
  }
}

export function warnOffSideWorkflow(workflow) {
  const combat = game.combat;
  if (!combat || !combat.started) return false;
  if (!game.settings.get("side-initiative", SETTINGS.warnOnOffSide)) return false;
  if (workflow?.isReaction || workflow?.workflowOptions?.isReaction || workflow?.options?.isReaction) return false;
  const combatant = workflow?.token?.combatant ?? workflow?.actor?.combatant;
  if (!combatant) return false;
  return isOffSideWorkflow(combat, combatant);
}
