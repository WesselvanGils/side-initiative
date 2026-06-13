import { MODULE_ID } from "../constants.js";
import { collectCombatantSides, getCombatState, normalizeCombatState, normalizeSideData, normalizeSideId, setCombatState, setCombatantSide, setCombatantSideSource } from "../logic.js";

function getFormElement(html) {
  return html?.[0] ?? html?.element?.[0] ?? html;
}

function buildSideRows(combat) {
  const state = getCombatState(combat);
  const sideMap = collectCombatantSides(combat);
  const order = [...new Set([...(state.order ?? []), ...sideMap.keys()])];

  return order
    .filter((sideId) => sideMap.has(sideId) || state.sides?.[sideId])
    .map((sideId) => {
      const side = normalizeSideData(sideId, {
        ...(state.sides?.[sideId] ?? {}),
        ...(sideMap.get(sideId) ?? {})
      });
      return { ...side, combatantIds: sideMap.get(sideId)?.combatantIds ?? [] };
    });
}

function renderCombatantRow(combatant, sideIds) {
  const assigned = normalizeSideId(combatant.getFlag(MODULE_ID, "sideId") ?? "");
  return `
    <tr data-combatant-id="${combatant.id}">
      <td>${combatant.name}</td>
      <td>
        <select name="combatant-${combatant.id}">
          ${sideIds.map((sideId) => `<option value="${sideId}"${sideId === assigned ? " selected" : ""}>${sideId}</option>`).join("")}
        </select>
      </td>
    </tr>
  `;
}

export function openSideEditor(combat) {
  if (!combat) return;
  const rows = buildSideRows(combat);
  const sideIds = rows.map((side) => side.id);
  const combatants = Array.from(combat.combatants ?? []);

  const content = `
    <form class="side-initiative-editor">
      <section>
        <h3>Side order</h3>
        <table>
          <thead>
            <tr><th>Side</th><th>Name</th><th>Color</th><th>Roll</th></tr>
          </thead>
          <tbody>
            ${rows.map((side) => `
              <tr data-side-id="${side.id}">
                <td>${side.id}</td>
                <td><input type="text" name="side-name-${side.id}" value="${side.name ?? side.id}"></td>
                <td><input type="text" name="side-color-${side.id}" value="${side.color ?? "#666666"}"></td>
                <td>${side.roll ?? ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
      <section>
        <h3>Combatants</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Side</th></tr>
          </thead>
          <tbody>
            ${combatants.map((combatant) => renderCombatantRow(combatant, sideIds)).join("")}
          </tbody>
        </table>
      </section>
    </form>
  `;

  new Dialog({
    title: "Side Initiative Editor",
    content,
    buttons: {
      save: {
        label: "Save",
        icon: '<i class="fas fa-check"></i>',
        callback: async (html) => {
          const form = getFormElement(html)?.querySelector("form");
          if (!form) return;
          const formData = new FormData(form);
          const state = normalizeCombatState(getCombatState(combat));
          const nextSides = {};

          for (const sideId of Object.keys(state.sides ?? {})) {
            nextSides[sideId] = normalizeSideData(sideId, {
              ...state.sides[sideId],
              name: formData.get(`side-name-${sideId}`) ?? state.sides[sideId].name,
              color: formData.get(`side-color-${sideId}`) ?? state.sides[sideId].color
            });
          }

          state.sides = nextSides;
          await setCombatState(combat, state);

          for (const combatant of combat.combatants ?? []) {
            const nextSide = formData.get(`combatant-${combatant.id}`);
            if (nextSide) {
              await setCombatantSide(combatant, nextSide);
              await setCombatantSideSource(combatant, "manual");
            }
          }

          await game.sideInitiative?.refreshCombatantSides?.(combat, { overwrite: false });
        }
      },
      cancel: {
        label: "Cancel",
        icon: '<i class="fas fa-xmark"></i>'
      }
    },
    default: "save"
  }).render(true);
}
