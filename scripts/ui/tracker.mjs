import { SETTINGS } from "../constants.mjs";
import { getActiveSideId, getCombatantSideId, getSideSummary, normalizeSideId } from "../logic.mjs";
import { openSideEditor } from "./side-editor.mjs";

/**
 * @param {unknown} html
 * @returns {HTMLElement | JQuery | unknown}
 */
function getRoot(html) {
    return html?.[0] ?? html;
}

/**
 * @param {string} label
 * @param {string} icon
 * @param {Record<string, string | number | boolean>} [dataset]
 * @returns {string}
 */
function iconButton(label, icon, dataset = {}) {
    const attrs = Object.entries(dataset)
        .map(([key, value]) => `data-${key}="${String(value)}"`)
        .join(" ");
    return `<button type="button" class="control" ${attrs} aria-label="${label}" title="${label}"><i class="${icon}"></i></button>`;
}

/**
 * @param {{ id: string, name: string, color?: string | null }} side
 * @param {string | null} currentSideId
 * @returns {string}
 */
function renderSideChip(side, currentSideId) {
    const active = normalizeSideId(side.id) === normalizeSideId(currentSideId);
    const colorStyle = side.color ? `style="--side-chip-color:${side.color};"` : "";
    return `
    <span class="side-chip${active ? " is-current" : ""}" ${colorStyle}>
      <span>${side.name}</span>
    </span>
  `;
}

/**
 * @param {object} combat
 * @param {string} combatantId
 * @returns {{ id: string, name: string, color: string, combatantIds: string[] } | null}
 */
function resolveCombatantSide(combat, combatantId) {
    const sides = getSideSummary(combat);
    return sides.find((side) => side.combatantIds.includes(combatantId)) ?? null;
}

/**
 * @param {HTMLElement} row
 * @param {{ id: string, name: string, color?: string | null }} side
 * @returns {void}
 */
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

/**
 * @param {object} app
 * @param {unknown} html
 * @returns {void}
 */
function bindCombatTrackerRowData(app, html) {
    const root = getRoot(html);
    if (!root) return;
    const rows = Array.from(root.querySelectorAll(".combatant"));
    const combatants = Array.from(app?.viewed?.combatants ?? app?.combat?.combatants ?? []);
    for (const [index, row] of rows.entries()) {
        if (!row.dataset.combatantId && combatants[index]) {
            row.dataset.combatantId = combatants[index].id;
        }
    }
}

/**
 * Resolve a combatant for a tracker row.
 * @param {object} app
 * @param {HTMLElement} row
 * @returns {object | null}
 */
function getCombatantForRow(app, row) {
    const combatantId = row?.dataset?.combatantId;
    if (!combatantId) return null;
    return app?.viewed?.combatants?.get?.(combatantId) ?? app?.combat?.combatants?.get?.(combatantId) ?? null;
}

/**
 * Add commander controls to the combatant context menu.
 * @param {object} app
 * @param {Array<object>} menuItems
 * @returns {void}
 */
export function addCombatantContextOptions(app, menuItems) {
    if (!Array.isArray(menuItems)) return;
    const combat = app?.viewed ?? game.combat ?? null;
    if (!combat) return;

    menuItems.splice(1, 0, {
        name: "SIDE-INITIATIVE.UI.MakeCommander",
        icon: '<i class="fa-solid fa-crown"></i>',
        condition: (li) => {
            const combatant = getCombatantForRow(app, li);
            if (!combatant) return false;
            if (!game.sideInitiative?.canUserSetCommander?.(combatant, game.user)) return false;
            const sideId = getCombatantSideId(combatant);
            if (!sideId) return false;
            return game.sideInitiative?.getSideCommander?.(combat, sideId)?.id !== combatant.id;
        },
        callback: async (li) => {
            const combatant = getCombatantForRow(app, li);
            if (!combatant) return;
            await game.sideInitiative?.setSideCommander?.(combat, combatant);
            app.render?.();
        }
    });
}

/**
 * Render the side initiative toolbar inside the combat tracker.
 * @param {object} app
 * @param {unknown} html
 * @returns {void}
 */
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
