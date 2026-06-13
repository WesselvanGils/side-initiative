import { SETTINGS } from "../constants.mjs";
import { getActiveSideId, getSideSummary, isOffSideWorkflow, normalizeSideId } from "../logic.mjs";
import { openSideEditor } from "./side-editor.mjs";

function getRoot(html) {
    return html?.[0] ?? html;
}

function iconButton(label, icon, dataset = {}) {
    const attrs = Object.entries(dataset)
        .map(([key, value]) => `data-${key}="${String(value)}"`)
        .join(" ");
    return `<button type="button" class="control" ${attrs} aria-label="${label}" title="${label}"><i class="${icon}"></i></button>`;
}

function renderSideChip(side, currentSideId) {
    const active = normalizeSideId(side.id) === normalizeSideId(currentSideId);
    const colorStyle = side.color ? `style="--side-chip-color:${side.color};"` : "";
    return `
    <span class="side-chip${active ? " is-current" : ""}" ${colorStyle}>
      <span>${side.name}</span>
    </span>
  `;
}

function resolveCombatantSide(combat, combatantId) {
    const sides = getSideSummary(combat);
    return sides.find((side) => side.combatantIds.includes(combatantId)) ?? null;
}

function injectSideStrip(row, side) {
    row.classList.add("side-initiative-row");
    row.dataset.sideId = side.id;
    row.style.position = "relative";

    row.querySelector(".side-initiative-strip")?.remove();

    const strip = document.createElement("span");
    strip.className = "side-initiative-strip";
    strip.style.backgroundColor = side.color ?? "#777";
    strip.title = side.name;
    row.prepend(strip);
}

function bindCombatTrackerRowData(app, html) {
    const root = getRoot(html);
    if (!root) return;
    const rows = Array.from(root.querySelectorAll(".combatant"));
    const combatants = Array.from(app?.combat?.combatants ?? []);
    for (const [index, row] of rows.entries()) {
        if (!row.dataset.combatantId && combatants[index]) {
            row.dataset.combatantId = combatants[index].id;
        }
    }
}

export function renderCombatTracker(app, html) {
    if (!game.user?.isGM && !game.user?.can?.("COMBAT_TRACKER")) return;
    if (!game.settings.get("side-initiative", SETTINGS.showTrackerControls)) return;

    const combat = game.combat;
    const root = getRoot(html);
    if (!combat || !root) return;

    root.querySelector(".side-initiative-panel")?.remove();

    const sides = getSideSummary(combat);
    const activeSideId = getActiveSideId(combat);

    const panel = document.createElement("section");
    panel.className = "side-initiative-panel";
    panel.innerHTML = `
    <div class="side-initiative-toolbar">
      ${iconButton(game.i18n.localize("SIDE-INITIATIVE.UI.RollSideInitiative"), "fas fa-dice-d20", { action: "roll-side-init" })}
      ${iconButton(game.i18n.localize("SIDE-INITIATIVE.UI.EditSides"), "fas fa-pen-to-square", { action: "edit-sides" })}
    </div>
    <div class="side-initiative-track">
      ${sides.length ? sides.map((side) => renderSideChip(side, activeSideId)).join("") : `<span class="side-chip is-current">${game.i18n.localize("SIDE-INITIATIVE.UI.NoSides")}</span>`}
    </div>
  `;
    root.prepend(panel);
    bindCombatTrackerRowData(app, html);

    panel.querySelector('[data-action="roll-side-init"]')?.addEventListener("click", async () => {
        await game.sideInitiative.rollSideInitiative(combat);
        ui.notifications.info(game.i18n.localize("SIDE-INITIATIVE.Notifications.SideRolled"));
        app.render?.();
    });

    panel.querySelector('[data-action="edit-sides"]')?.addEventListener("click", () => openSideEditor(combat));

    for (const row of root.querySelectorAll(".combatant")) {
        const combatantId = row.dataset.combatantId;
        if (!combatantId) continue;
        const side = resolveCombatantSide(combat, combatantId);
        if (!side) continue;
        injectSideStrip(row, side);
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
