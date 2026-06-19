import { MODULE_ID } from "../constants.js";
import { collectCombatantSides, getCombatState, normalizeCombatState, normalizeSideData, normalizeSideId, setCombatState, setCombatantSide, setCombatantSideSource } from "../logic.js";
import { getSideInitiative } from "../runtime.js";
import type { CombatLike, CombatantLike, SideData } from "../types.js";

interface SideEditorRow extends SideData {
    combatantIds: string[];
}

function getFormElement(html: unknown): HTMLElement | null {
    const element = (html as Array<unknown>)?.[0] ?? (html as { element?: Array<unknown> })?.element?.[0] ?? html;
    return (element as HTMLElement | null) ?? null;
}

function buildSideRows(combat: CombatLike): SideEditorRow[] {
    const state = getCombatState(combat);
    const sideMap = collectCombatantSides(combat);
    const order = [...new Set([...(state.order ?? []), ...sideMap.keys()])];

    return order
        .filter((sideId) => sideMap.has(sideId) || state.sides?.[sideId])
        .map((sideId): SideEditorRow => {
            const side = normalizeSideData(sideId, {
                ...(state.sides?.[sideId] ?? {}),
                ...(sideMap.get(sideId) ?? {})
            });
            return { ...side, combatantIds: sideMap.get(sideId)?.combatantIds ?? [] };
        });
}

function renderCombatantRow(combatant: CombatantLike, sideIds: string[]): string {
    const assigned = normalizeSideId(combatant?.getFlag?.(MODULE_ID, "sideId") ?? "");
    const id = combatant?.id ?? "";
    const name = combatant?.name ?? id;
    return `
    <tr data-combatant-id="${id}">
      <td>${name}</td>
      <td>
        <select name="combatant-${id}">
          ${sideIds.map((sideId) => `<option value="${sideId}"${sideId === assigned ? " selected" : ""}>${sideId}</option>`).join("")}
        </select>
      </td>
    </tr>
  `;
}

/**
 * Open the side editor dialog.
 */
export function openSideEditor(combat: CombatLike | null): void {
    if (!combat) return;
    const rows = buildSideRows(combat);
    const sideIds = rows.map((side) => side.id);
    const combatantsCollection = combat.combatants;
    const combatants: CombatantLike[] = combatantsCollection instanceof Map
        ? Array.from((combatantsCollection as Map<string, CombatantLike>).values())
        : Array.isArray(combatantsCollection)
            ? combatantsCollection
            : Array.from((combatantsCollection as Iterable<CombatantLike> | undefined) ?? []);

    const content = `
    <form class="side-initiative-editor">
      <section>
        <h3>Side order</h3>
        <table>
          <thead>
            <tr><th>Side</th><th>Name</th><th>Color</th></tr>
          </thead>
          <tbody>
            ${rows.map((side) => `
              <tr data-side-id="${side.id}">
                <td>${side.id}</td>
                <td><input type="text" name="side-name-${side.id}" value="${side.name ?? side.id}"></td>
                <td><input type="text" name="side-color-${side.id}" value="${side.color ?? "#666666"}"></td>
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
                callback: async (html: unknown) => {
                    const form = getFormElement(html)?.querySelector("form");
                    if (!form) return;
                    const formData = new FormData(form);
                    const state = normalizeCombatState(getCombatState(combat));
                    const nextSides: Record<string, SideData> = {};

                    for (const sideId of Object.keys(state.sides ?? {})) {
                        const existing = state.sides?.[sideId] ?? {};
                        nextSides[sideId] = normalizeSideData(sideId, {
                            ...existing,
                            name: (formData.get(`side-name-${sideId}`) as string | null) ?? existing.name,
                            color: (formData.get(`side-color-${sideId}`) as string | null) ?? existing.color
                        });
                    }

                    state.sides = nextSides;
                    await setCombatState(combat, state);

                    for (const combatant of combatants) {
                        const nextSide = formData.get(`combatant-${combatant.id ?? ""}`) as string | null;
                        if (nextSide) {
                            await setCombatantSide(combatant, nextSide);
                            await setCombatantSideSource(combatant, "manual");
                        }
                    }

                    await getSideInitiative()?.refreshCombatantSides?.(combat, { overwrite: false });
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
