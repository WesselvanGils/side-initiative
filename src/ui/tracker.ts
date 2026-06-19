import { SETTINGS } from "../constants.js";
import { getActiveSideId, getCombatantSideId, getSideRepresentativeCombatant, getSideSummary, normalizeSideId } from "../logic.js";
import { getSideInitiative, getSetting } from "../runtime.js";
import type { CombatLike, CombatantLike, SideData } from "../types.js";
import { openSideEditor } from "./side-editor.js";

interface TrackerApp {
    viewed?: CombatLike | null;
    combat?: CombatLike | null;
    render?(): void;
}

interface ContextMenuItem {
    name?: string;
    icon?: string;
    condition?: (li: HTMLElement) => boolean;
    callback?: (li: HTMLElement) => void | Promise<void>;
}

function getRoot(html: unknown): HTMLElement | null {
    const root = (html as Array<unknown>)?.[0] ?? html;
    return (root as HTMLElement | null) ?? null;
}

function getTrackerCombat(app: TrackerApp | null | undefined): CombatLike | null {
    return app?.viewed ?? (game?.combat as CombatLike | null) ?? null;
}

function iconButton(label: string, icon: string, dataset: Record<string, string | number | boolean> = {}): string {
    const attrs = Object.entries(dataset)
        .map(([key, value]) => `data-${key}="${String(value)}"`)
        .join(" ");
    return `<button type="button" class="control" ${attrs} aria-label="${label}" title="${label}"><i class="${icon}"></i></button>`;
}

function renderSideChip(side: { id: string; name: string; color?: string | null }, currentSideId: string | null): string {
    const active = normalizeSideId(side.id) === normalizeSideId(currentSideId);
    const colorStyle = side.color ? `style="--side-chip-color:${side.color};"` : "";
    return `
    <span class="side-chip${active ? " is-current" : ""}" ${colorStyle}>
      <span>${side.name}</span>
    </span>
  `;
}

function resolveDisplaySide(
    combat: CombatLike | null,
    combatant: CombatantLike | null | undefined,
    groupId: string | null = null
): (SideData & { combatantIds: string[] }) | null {
    const sides = getSideSummary(combat);
    const sideById = new Map(sides.map((side) => [side.id, side]));

    const members: CombatantLike[] = [];
    if (groupId && combat?.groups?.get) {
        const group = combat.groups.get(groupId);
        if (group?.members) {
            const groupMembers = group.members instanceof Set ? Array.from(group.members) : Array.from(group.members as CombatantLike[]);
            members.push(...groupMembers);
        }
    } else if (combatant?.group?.members) {
        const groupMembers = combatant.group.members instanceof Set ? Array.from(combatant.group.members) : Array.from(combatant.group.members as CombatantLike[]);
        members.push(...groupMembers);
    }

    if (members.length > 1) {
        const counts = new Map<string, number>();
        for (const member of members) {
            const sideId = getCombatantSideId(member);
            counts.set(sideId, (counts.get(sideId) ?? 0) + 1);
        }
        const bestSideId = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
        if (bestSideId && sideById.has(bestSideId)) {
            const side = sideById.get(bestSideId);
            if (side) return { ...side, combatantIds: side.combatantIds ?? [] };
        }
    }

    const combatantId = combatant?.id ?? null;
    if (combatantId) {
        const side = sides.find((entry) => (entry.combatantIds ?? []).includes(combatantId)) ?? null;
        if (side) return { ...side, combatantIds: side.combatantIds ?? [] };
    }
    return null;
}

function injectSideStrip(row: HTMLElement, side: { id: string; name: string; color?: string | null }): void {
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

function getCombatantForRow(app: TrackerApp | null | undefined, row: HTMLElement | null | undefined): CombatantLike | null {
    const combatantId = row?.dataset?.combatantId;
    if (combatantId) {
        const viewed = app?.viewed?.combatants;
        if (viewed && typeof (viewed as { get?: unknown }).get === "function") {
            return (viewed as { get: (id: string) => CombatantLike | null }).get(combatantId) ?? null;
        }
        const combat = app?.combat?.combatants;
        if (combat && typeof (combat as { get?: unknown }).get === "function") {
            return (combat as { get: (id: string) => CombatantLike | null }).get(combatantId) ?? null;
        }
        return null;
    }

    const groupId = row?.dataset?.groupId ?? row?.dataset?.combatantGroupId ?? null;
    if (!groupId) return null;
    const viewedGroups = app?.viewed?.groups;
    const combatGroups = app?.combat?.groups;
    const group = (viewedGroups?.get?.(groupId) ?? combatGroups?.get?.(groupId)) ?? null;
    const members = group?.members ? (group.members instanceof Set ? Array.from(group.members) : Array.from(group.members as CombatantLike[])) : [];
    if (!members.length) return null;
    return members[0] ?? null;
}

function createCommanderControl(app: TrackerApp, combat: CombatLike, combatant: CombatantLike): HTMLButtonElement | null {
    if (!globalThis.document?.createElement) return null;

    const button = document.createElement("button");
    const label = game?.i18n?.localize?.("SIDE-INITIATIVE.UI.MakeCommander") ?? "SIDE-INITIATIVE.UI.MakeCommander";
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

    button.addEventListener("click", async (event: Event) => {
        event.preventDefault();
        (event as MouseEvent).stopPropagation?.();
        if (isCommander) return;
        const requested = await getSideInitiative()?.requestSideCommander?.(combat, combatant);
        if (requested && game?.user?.isGM) {
            app.render?.();
        }
    });

    return button;
}

export function addCommanderControl(app: TrackerApp, row: HTMLElement, combat: CombatLike): HTMLButtonElement | null {
    row?.querySelector?.(".side-initiative-commander-control")?.remove?.();

    const combatant = getCombatantForRow(app, row);
    if (!combatant) return null;
    if (!getSideInitiative()?.canUserSetCommander?.(combatant, game?.user as never)) return null;

    const button = createCommanderControl(app, combat, combatant);
    if (!button) return null;

    const anchor = row.querySelector?.(".token-effects") ?? null;
    if (anchor) {
        anchor.before(button);
    } else {
        row.append(button);
    }

    return button;
}

export function addCombatantContextOptions(app: TrackerApp, menuItems: ContextMenuItem[]): void {
    if (!Array.isArray(menuItems)) return;
    const combat = getTrackerCombat(app);
    if (!combat) return;

    menuItems.splice(1, 0, {
        name: "SIDE-INITIATIVE.UI.MakeCommander",
        icon: '<i class="fa-solid fa-crown"></i>',
        condition: (li: HTMLElement) => {
            const combatant = getCombatantForRow(app, li);
            if (!combatant) return false;
            if (!getSideInitiative()?.canUserSetCommander?.(combatant, game?.user as never)) return false;
            const sideId = getCombatantSideId(combatant);
            if (!sideId) return false;
            return getSideInitiative()?.getSideCommander?.(combat, sideId)?.id !== combatant.id;
        },
        callback: async (li: HTMLElement) => {
            const combatant = getCombatantForRow(app, li);
            if (!combatant) return;
            const requested = await getSideInitiative()?.requestSideCommander?.(combat, combatant);
            if (requested && game?.user?.isGM) {
                app.render?.();
            }
        }
    });
}

export function renderCombatTracker(app: TrackerApp, html: unknown): void {
    const combat = getTrackerCombat(app);
    const root = getRoot(html);
    if (!combat || !root) return;

    const canViewTrackerControls = Boolean(game?.user?.isGM || game?.user?.can?.("COMBAT_TRACKER" as never));
    const showTrackerControls = canViewTrackerControls && Boolean(getSetting("side-initiative", SETTINGS.showTrackerControls));

    root.querySelector(".side-initiative-panel")?.remove();

    const sides = getSideSummary(combat);
    const activeSideId = getActiveSideId(combat);

    if (showTrackerControls) {
        const panel = document.createElement("section");
        panel.className = "side-initiative-panel";
        panel.innerHTML = `
    <div class="side-initiative-toolbar">
      ${iconButton(game?.i18n?.localize?.("SIDE-INITIATIVE.UI.RollSideInitiative") ?? "SIDE-INITIATIVE.UI.RollSideInitiative", "fas fa-dice-d20", { action: "roll-side-init" })}
      ${iconButton(game?.i18n?.localize?.("SIDE-INITIATIVE.UI.EditSides") ?? "SIDE-INITIATIVE.UI.EditSides", "fas fa-pen-to-square", { action: "edit-sides" })}
    </div>
    <div class="side-initiative-track">
      ${sides.length ? sides.map((side) => renderSideChip(side, activeSideId)).join("") : `<span class="side-chip is-current">${game?.i18n?.localize?.("SIDE-INITIATIVE.UI.NoSides") ?? "SIDE-INITIATIVE.UI.NoSides"}</span>`}
    </div>
  `;
        root.prepend(panel);

        panel.querySelector('[data-action="roll-side-init"]')?.addEventListener("click", async () => {
            await getSideInitiative()?.rollSideInitiative?.(combat);
            ui?.notifications?.info?.(game?.i18n?.localize?.("SIDE-INITIATIVE.Notifications.SideRolled") ?? "SIDE-INITIATIVE.Notifications.SideRolled");
            app.render?.();
        });

        panel.querySelector('[data-action="edit-sides"]')?.addEventListener("click", () => openSideEditor(combat));
    }

    for (const row of root.querySelectorAll(".combatant")) {
        const combatant = getCombatantForRow(app, row as HTMLElement);
        const groupId = (row as HTMLElement).dataset.groupId ?? (row as HTMLElement).dataset.combatantGroupId ?? null;
        const side = resolveDisplaySide(combat, combatant, groupId);
        if (!side) continue;
        injectSideStrip(row as HTMLElement, side);
        addCommanderControl(app, row as HTMLElement, combat);
    }
}
