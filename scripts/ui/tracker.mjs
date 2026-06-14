import { SETTINGS } from "../constants.mjs";
import { getActiveSideId, getCombatantSideId, getSideRepresentativeCombatant, getSideSummary, normalizeSideId } from "../logic.mjs";
import { openSideEditor } from "./side-editor.mjs";

/**
 * @param {unknown} html
 * @returns {HTMLElement | JQuery | unknown}
 */
function getRoot(html) {
    return html?.[0] ?? html;
}

/**
 * @param {object | null | undefined} app
 * @returns {object | null}
 */
function getTrackerCombat(app) {
    return app?.viewed ?? game.combat ?? null;
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
 * Resolve the display side for a combatant or combatant group row.
 * @param {object} combat
 * @param {object | null | undefined} combatant
 * @param {string | null} [groupId]
 * @returns {{ id: string, name: string, color: string, combatantIds: string[] } | null}
 */
function resolveDisplaySide(combat, combatant, groupId = null) {
    const sides = getSideSummary(combat);
    const sideById = new Map(sides.map((side) => [side.id, side]));

    const members = [];
    if (groupId && combat?.groups?.get) {
        const group = combat.groups.get(groupId);
        if (group?.members?.size) members.push(...group.members);
    } else if (combatant?.group?.members?.size) {
        members.push(...combatant.group.members);
    }

    if (members.length > 1) {
        const counts = new Map();
        for (const member of members) {
            const sideId = getCombatantSideId(member);
            counts.set(sideId, (counts.get(sideId) ?? 0) + 1);
        }
        const [bestSideId] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
        if (bestSideId && sideById.has(bestSideId)) return sideById.get(bestSideId);
    }

    const combatantId = combatant?.id ?? null;
    if (combatantId) return sides.find((side) => side.combatantIds.includes(combatantId)) ?? null;
    return null;
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
/**
 * Resolve a combatant for a tracker row.
 * @param {object} app
 * @param {HTMLElement} row
 * @returns {object | null}
 */
function getCombatantForRow(app, row) {
    const combatantId = row?.dataset?.combatantId;
    if (combatantId) {
        return app?.viewed?.combatants?.get?.(combatantId) ?? app?.combat?.combatants?.get?.(combatantId) ?? null;
    }

    const groupId = row?.dataset?.groupId ?? row?.dataset?.combatantGroupId ?? null;
    if (!groupId) return null;
    const group = app?.viewed?.groups?.get?.(groupId) ?? app?.combat?.groups?.get?.(groupId) ?? null;
    if (!group?.members?.size) return null;
    return group.members.values().next().value ?? null;
}

/**
 * Create the commander button for a tracker row.
 * @param {object} app
 * @param {object} combat
 * @param {object} combatant
 * @returns {HTMLButtonElement | null}
 */
function createCommanderControl(app, combat, combatant) {
    if (!globalThis.document?.createElement) return null;

    const button = document.createElement("button");
    const label = game.i18n.localize("SIDE-INITIATIVE.UI.MakeCommander");
    const sideId = getCombatantSideId(combatant);
    const isCommander = Boolean(sideId && getSideRepresentativeCombatant(combat, sideId)?.id === combatant.id);

    button.type = "button";
    button.className = "control inline-control combatant-control icon fa-solid fa-crown side-initiative-commander-control";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tooltip", label);
    button.setAttribute("aria-pressed", String(isCommander));
    if (isCommander) {
        button.classList.add("active");
    }

    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        if (isCommander) return;
        const requested = await game.sideInitiative?.requestSideCommander?.(combat, combatant);
        if (requested && game.user?.isGM) {
            app.render?.();
        }
    });

    return button;
}

/**
 * Add commander controls to a combat tracker row.
 * @param {object} app
 * @param {HTMLElement} row
 * @param {object} combat
 * @returns {HTMLButtonElement | null}
 */
export function addCommanderControl(app, row, combat) {
    row?.querySelector?.(".side-initiative-commander-control")?.remove?.();

    const combatant = getCombatantForRow(app, row);
    if (!combatant) return null;
    if (!game.sideInitiative?.canUserSetCommander?.(combatant, game.user)) return null;

    const button = createCommanderControl(app, combat, combatant);
    if (!button) return null;

    const anchor = row.querySelector?.(".token-effects");
    if (anchor?.before) {
        anchor.before(button);
    } else if (row.append) {
        row.append(button);
    }

    return button;
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
            const requested = await game.sideInitiative?.requestSideCommander?.(combat, combatant);
            if (requested && game.user?.isGM) {
                app.render?.();
            }
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
    const combat = getTrackerCombat(app);
    const root = getRoot(html);
    if (!combat || !root) return;

    const canViewTrackerControls = Boolean(game.user?.isGM || game.user?.can?.("COMBAT_TRACKER"));
    const showTrackerControls = canViewTrackerControls && game.settings.get("side-initiative", SETTINGS.showTrackerControls);

    root.querySelector(".side-initiative-panel")?.remove();

    const sides = getSideSummary(combat);
    const activeSideId = getActiveSideId(combat);

    if (showTrackerControls) {
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

        panel.querySelector('[data-action="roll-side-init"]')?.addEventListener("click", async () => {
            await game.sideInitiative.rollSideInitiative(combat);
            ui.notifications.info(game.i18n.localize("SIDE-INITIATIVE.Notifications.SideRolled"));
            app.render?.();
        });

        panel.querySelector('[data-action="edit-sides"]')?.addEventListener("click", () => openSideEditor(combat));
    }

    for (const row of root.querySelectorAll(".combatant")) {
        const combatant = getCombatantForRow(app, row);
        const groupId = row.dataset.groupId ?? row.dataset.combatantGroupId ?? null;
        const side = resolveDisplaySide(combat, combatant, groupId);
        if (!side) continue;
        injectSideStrip(row, side);
        addCommanderControl(app, row, combat);
    }
}
