import { COMBAT_DOCK_SIZE_OPTIONS, MODULE_ID, SETTINGS } from "../constants.js";
import {
    getActiveSideId,
    getSideColor,
    getSideLabel,
    getSideRepresentativeCombatant,
    getSideSummary,
    normalizeSideId
} from "../logic.js";
import { getSideInitiative, getSetting, hooks } from "../runtime.js";
import type { CombatLike, CombatantLike } from "../types.js";

/**
 * Combat Dock — an optional, docked combat tracker that shows the two opposing
 * sides' representatives facing each other inside a fantasy frame, inspired by
 * theripper93's "Combat Tracker Dock" but built natively on this module's side
 * data model (no external dependency).
 *
 * The display model is produced by the pure {@link getDockState} helper so the
 * logic is unit-testable without a DOM; the {@link CombatDockManager} only turns
 * that model into DOM and keeps it in sync with combat changes.
 */

/** The side shown on the left of the dock. */
export const DOCK_LEFT_SIDE_ID = "players";
/** The side shown on the right of the dock. */
export const DOCK_RIGHT_SIDE_ID = "monsters";
const DOCK_ELEMENT_ID = "side-initiative-combat-dock";
const DOCK_HIDDEN_CLASS = "side-dock-hidden";
const HIDE_CONFLICTING_CLASS = "side-initiative-hide-conflicting";
const SIDETURN_START_HOOK = "side-initiative.sideTurnStart";

/** Structural view of a combatant for portrait image resolution. */
interface CombatantWithImg {
    img?: string | null;
    name?: string | null;
    token?: { img?: string | null; texture?: { src?: string | null } } | null;
    actor?: { img?: string | null; prototypeToken?: { texture?: { src?: string | null } } | null } | null;
    document?: { img?: string | null; actor?: { img?: string | null } | null } | null;
}

/** Foundry combat lifecycle actions the dock invokes (optional on {@link CombatLike}). */
type DockCombat = CombatLike & {
    startCombat?(): Promise<unknown>;
    endCombat?(): Promise<unknown>;
    resetAll?(): Promise<unknown>;
};

/** Display model for one side panel (left or right). */
export interface DockSidePanel {
    sideId: string;
    name: string;
    color: string;
    img: string | null;
    label: string | null;
    combatantId: string | null;
    count: number;
    active: boolean;
    empty: boolean;
}

/** Display model for the whole dock. */
export interface DockState {
    visible: boolean;
    started: boolean;
    round: number | null;
    activeSideId: string | null;
    leftSideId: string;
    rightSideId: string;
    left: DockSidePanel | null;
    right: DockSidePanel | null;
    /** Active side is neither the left nor the right side ⇒ the center divider highlights. */
    dividerActive: boolean;
}

export interface DockStateOptions {
    enabled?: boolean;
    groupByDisposition?: boolean;
}

/**
 * Resolve the best portrait image for a combatant. The actor's avatar image is
 * preferred (full character art) and the token image is only a fallback.
 */
export function resolveCombatantImg(combatant: CombatantLike | null | undefined): string | null {
    const c = combatant as (CombatantLike & CombatantWithImg) | null | undefined;
    const candidates = [
        c?.actor?.img,
        c?.document?.actor?.img,
        c?.img,
        c?.token?.texture?.src,
        c?.token?.img,
        c?.document?.img,
        c?.actor?.prototypeToken?.texture?.src
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    return null;
}

/**
 * Build a side panel model for a side id by resolving its representative
 * combatant (the configured commander, else the first living member).
 */
function buildSidePanel(
    combat: CombatLike | null | undefined,
    sideId: string,
    activeSideId: string | null,
    { groupByDisposition = true }: { groupByDisposition?: boolean }
): DockSidePanel | null {
    const normalizedId = normalizeSideId(sideId);
    const summary = getSideSummary(combat, { groupByDisposition }).find((side) => normalizeSideId(side.id) === normalizedId) ?? null;
    const representative = getSideRepresentativeCombatant(combat, normalizedId, { groupByDisposition });
    const count = summary?.combatantIds?.length ?? summary?.count ?? 0;
    const name = summary?.name ?? getSideLabel(normalizedId);
    const color = summary?.color ?? getSideColor(normalizedId);

    return {
        sideId: normalizedId,
        name,
        color,
        img: resolveCombatantImg(representative),
        label: representative?.name ?? null,
        combatantId: representative?.id ?? null,
        count,
        active: normalizeSideId(activeSideId) === normalizedId,
        empty: !representative
    };
}

/**
 * Produce the pure display model for the dock from a combat. Does not touch the
 * DOM and is safe to call in tests with lightweight combat mocks.
 */
export function getDockState(combat: CombatLike | null | undefined, options: DockStateOptions = {}): DockState {
    const enabled = options.enabled ?? true;
    const groupByDisposition = options.groupByDisposition ?? true;
    const activeSideId = getActiveSideId(combat, { groupByDisposition });

    // The dock appears as soon as a combat exists in the current scene — even
    // before it is started or sides are rolled — so representatives are derived
    // from disposition. It hides again once the combat is deleted.
    const visible = Boolean(enabled && combat);
    const started = Boolean(combat?.started);
    const round = Number.isFinite(combat?.round) ? (combat?.round as number) : null;

    const left = buildSidePanel(combat, DOCK_LEFT_SIDE_ID, activeSideId, { groupByDisposition });
    const right = buildSidePanel(combat, DOCK_RIGHT_SIDE_ID, activeSideId, { groupByDisposition });

    const normalizedActive = activeSideId ? normalizeSideId(activeSideId) : null;
    const dividerActive = Boolean(normalizedActive)
        && normalizedActive !== DOCK_LEFT_SIDE_ID
        && normalizedActive !== DOCK_RIGHT_SIDE_ID;

    return {
        visible,
        started,
        round,
        activeSideId: normalizedActive,
        leftSideId: DOCK_LEFT_SIDE_ID,
        rightSideId: DOCK_RIGHT_SIDE_ID,
        left,
        right,
        dividerActive
    };
}

function canManageCombat(): boolean {
    return Boolean(game?.user?.isGM || game?.user?.can?.("COMBAT_TRACKER" as never));
}

function getViewedCombat(): CombatLike | null {
    return (game?.combat as CombatLike | null) ?? null;
}

function localize(key: string, fallback: string): string {
    return game?.i18n?.localize?.(key) ?? fallback;
}

/** Localization keys for the dock control buttons (action → i18n key). */
const CONTROL_LABELS: Record<string, string> = {
    "start-combat": "SIDE-INITIATIVE.UI.DockStartCombat",
    "end-combat": "SIDE-INITIATIVE.UI.DockEndCombat",
    "roll-init": "SIDE-INITIATIVE.UI.DockRollInitiative",
    advance: "SIDE-INITIATIVE.UI.DockAdvanceSide",
    reset: "SIDE-INITIATIVE.UI.DockResetInitiative"
};

/**
 * Manages the docked combat-tracker DOM element: builds it once, mounts it into
 * `#ui-top`, and re-applies the current {@link DockState} on combat changes.
 */
export class CombatDockManager {
    private element: HTMLElement | null = null;
    private hookIds: number[] = [];
    private lastActiveSideId: string | null = null;
    private refreshQueued = false;
    private installed = false;

    isEnabled(): boolean {
        return Boolean(getSetting(MODULE_ID, SETTINGS.useCombatDock));
    }

    isHideConflictingEnabled(): boolean {
        return Boolean(getSetting(MODULE_ID, SETTINGS.hideConflictingTopUI));
    }

    getSize(): string {
        const value = getSetting(MODULE_ID, SETTINGS.combatDockSize) as string | undefined;
        const sizes = Object.values(COMBAT_DOCK_SIZE_OPTIONS);
        return value && sizes.includes(value as never) ? value : COMBAT_DOCK_SIZE_OPTIONS.medium;
    }

    /** Register the Foundry hooks that keep the dock in sync. Idempotent. */
    install(): void {
        if (this.installed) return;
        const h = hooks();
        if (!h) return;
        this.installed = true;

        const refresh = () => this.requestRefresh();

        this.track(h.on("createCombat", refresh));
        this.track(h.on("deleteCombat", refresh));
        this.track(h.on("combatStart", refresh));
        this.track(h.on("updateCombat", refresh));
        this.track(h.on("updateCombatant", refresh));
        this.track(h.on("deleteCombatant", refresh));
        this.track(h.on(SIDETURN_START_HOOK, refresh));
        // When the viewed scene changes the active combat may change too.
        this.track(h.on("canvasReady", refresh));
    }

    private track(id: number | undefined): void {
        if (typeof id === "number") this.hookIds.push(id);
    }

    /** Coalesce multiple synchronous combat updates into a single refresh. */
    requestRefresh(): void {
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        const run = (): void => {
            this.refreshQueued = false;
            this.refresh();
        };
        if (typeof queueMicrotask === "function") queueMicrotask(run);
        else this.refresh();
    }

    /** Re-evaluate visibility and re-apply state. */
    refresh(): void {
        const combat = getViewedCombat();
        const state = getDockState(combat, { enabled: this.isEnabled() });

        if (!state.visible) {
            this.applyHideConflicting(false);
            if (this.element) this.element.classList.add(DOCK_HIDDEN_CLASS);
            return;
        }

        if (!this.element) this.mount();
        if (this.element) {
            this.element.classList.remove(DOCK_HIDDEN_CLASS);
            this.applyHideConflicting(true);
            this.applyState(state);
        }
    }

    /** Build the dock element and insert it at the top of `#ui-top`. */
    mount(): void {
        if (this.element || !globalThis.document?.createElement) return;

        const element = document.createElement("section");
        element.id = DOCK_ELEMENT_ID;
        element.className = "side-initiative-combat-dock";
        element.setAttribute("aria-label", "Side Initiative Combat Dock");
        element.innerHTML = DOCK_TEMPLATE;

        this.element = element;
        this.attachControlListeners();

        const uiTop = document.getElementById("ui-top");
        if (uiTop) uiTop.prepend(element);
        else document.body.prepend(element);
    }

    /** Fully remove the dock element and clear the hide-conflicting state. */
    unmount(): void {
        this.applyHideConflicting(false);
        this.element?.remove();
        this.element = null;
        this.lastActiveSideId = null;
    }

    private applyHideConflicting(active: boolean): void {
        const uiTop = globalThis.document?.getElementById?.("ui-top");
        if (!uiTop) return;
        if (active && this.isHideConflictingEnabled()) uiTop.classList.add(HIDE_CONFLICTING_CLASS);
        else uiTop.classList.remove(HIDE_CONFLICTING_CLASS);
    }

    private applyState(state: DockState): void {
        const el = this.element;
        if (!el) return;

        const size = this.getSize();
        for (const candidate of Object.values(COMBAT_DOCK_SIZE_OPTIONS)) {
            el.classList.remove(`side-dock-size-${candidate}`);
        }
        el.classList.add(`side-dock-size-${size}`);

        const leftEl = el.querySelector('[data-side="players"]');
        const rightEl = el.querySelector('[data-side="monsters"]');
        if (leftEl) this.applySidePanel(leftEl as HTMLElement, state.left);
        if (rightEl) this.applySidePanel(rightEl as HTMLElement, state.right);

        const divider = el.querySelector(".side-dock-divider");
        divider?.classList.toggle("is-active", state.dividerActive);

        // The divider ornament has a pointer; flip it to face the active side.
        const ornament = el.querySelector(".side-dock-divider-ornament");
        if (ornament) {
            ornament.classList.toggle("points-right", normalizeSideId(state.activeSideId ?? "") === DOCK_RIGHT_SIDE_ID);
        }

        const roundEl = el.querySelector(".side-dock-round");
        if (roundEl) roundEl.textContent = state.round != null ? String(state.round) : "";

        // Steady active-side highlight.
        leftEl?.classList.toggle("is-active", Boolean(state.left?.active));
        rightEl?.classList.toggle("is-active", Boolean(state.right?.active));

        // One-shot flow sweep whenever the active side changes. This diff fires on
        // every client because combat updates (turn/round) sync to all clients and
        // re-run applyState, so the flow is seen table-wide, not just by the GM.
        const previous = this.lastActiveSideId;
        const next = state.activeSideId;
        if (previous != null && next != null && normalizeSideId(previous) !== normalizeSideId(next)) {
            this.triggerFlow(el, next);
        }
        if (next) this.lastActiveSideId = normalizeSideId(next);

        this.applyControls(el, state);
    }

    private applySidePanel(panel: HTMLElement, side: DockSidePanel | null): void {
        if (!side) {
            panel.classList.add("is-empty");
            return;
        }
        panel.classList.toggle("is-empty", side.empty);
        panel.style.setProperty("--side-dock-color", side.color || "");

        const img = panel.querySelector(".side-dock-portrait-img") as HTMLImageElement | null;
        if (img) {
            if (side.img) {
                img.src = side.img;
                img.removeAttribute("hidden");
            } else {
                img.setAttribute("hidden", "");
                img.removeAttribute("src");
            }
            img.alt = side.label ?? side.name;
        }

        const label = panel.querySelector(".side-dock-label");
        if (label) label.textContent = side.label ?? side.name;

        const meta = panel.querySelector(".side-dock-meta");
        if (meta) meta.textContent = String(side.count);
    }

    private triggerFlow(el: HTMLElement, activeSideId: string): void {
        const normalized = normalizeSideId(activeSideId);
        if (normalized === DOCK_LEFT_SIDE_ID) {
            const target = el.querySelector('[data-side="players"]');
            if (target) this.playFlowAnimation(target, "panel");
        } else if (normalized === DOCK_RIGHT_SIDE_ID) {
            const target = el.querySelector('[data-side="monsters"]');
            if (target) this.playFlowAnimation(target, "panel");
        } else {
            const target = el.querySelector(".side-dock-divider");
            if (target) this.playFlowAnimation(target, "divider");
        }
    }

    /**
     * Play the one-shot "flow" highlight. Side panels (roughly card-shaped) get a
     * gold box-shadow sweep; the thin vertical divider gets an in-place brightness
     * pulse instead, so the flash matches its shape instead of reading as a square.
     */
    private playFlowAnimation(target: Element, kind: "panel" | "divider"): void {
        const animatable = target as Element & { animate?: (keyframes: never[], options: Record<string, unknown>) => unknown };
        if (typeof animatable.animate !== "function") return;
        const keyframes = kind === "divider"
            ? [
                { filter: "brightness(1)" },
                { filter: "brightness(2.4)", offset: 0.4 },
                { filter: "brightness(1)" }
            ]
            : [
                { boxShadow: "0 0 0 0 rgba(255, 215, 0, 0)", filter: "brightness(1)" },
                { boxShadow: "0 0 28px 8px rgba(255, 215, 0, 0.9)", filter: "brightness(1.3)", offset: 0.4 },
                { boxShadow: "0 0 0 0 rgba(255, 215, 0, 0)", filter: "brightness(1)" }
            ];
        try {
            animatable.animate(keyframes as never[], { duration: 720, easing: "ease-out" });
        } catch {
            // Animations are non-essential; ignore environments without WAAPI.
        }
    }

    private applyControls(el: HTMLElement, state: DockState): void {
        const combat = getViewedCombat();
        const manage = canManageCombat();
        const canAdvance = Boolean(combat && getSideInitiative()?.canUserAdvanceSide?.(combat));

        this.toggleControl(el, "start-combat", manage && !state.started);
        this.toggleControl(el, "end-combat", manage && state.started);
        this.toggleControl(el, "roll-init", manage);
        this.toggleControl(el, "reset", manage);

        // The gap separates the roll group from the combat group; only relevant
        // when the combat controls are visible (i.e. for a manager).
        el.querySelector(".side-dock-control-gap")?.classList.toggle(DOCK_HIDDEN_CLASS, !manage);

        const advance = el.querySelector('[data-action="advance"]') as HTMLButtonElement | null;
        if (advance) {
            advance.classList.toggle(DOCK_HIDDEN_CLASS, !canAdvance);
            advance.disabled = !canAdvance;
        }
    }

    private toggleControl(el: HTMLElement, action: string, visible: boolean): void {
        const button = el.querySelector(`[data-action="${action}"]`);
        button?.classList.toggle(DOCK_HIDDEN_CLASS, !visible);
    }

    private attachControlListeners(): void {
        const el = this.element;
        if (!el) return;
        el.querySelectorAll("[data-action]").forEach((node) => {
            const button = node as HTMLElement;
            const action = button.dataset.action;
            if (!action) return;
            const labelKey = CONTROL_LABELS[action];
            if (labelKey) {
                const label = localize(labelKey, action);
                button.title = label;
                button.setAttribute("aria-label", label);
            }
            button.addEventListener("click", (event: Event) => {
                event.preventDefault();
                void this.handleAction(action);
            });
        });
    }

    private async handleAction(action: string): Promise<void> {
        const combat = getViewedCombat() as DockCombat | null;
        if (!combat) return;
        try {
            switch (action) {
                case "advance":
                    await combat.nextTurn?.();
                    break;
                case "roll-init":
                    await getSideInitiative()?.rollSideInitiative?.(combat);
                    ui?.notifications?.info?.(localize("SIDE-INITIATIVE.Notifications.SideRolled", "Side initiative rolled."));
                    break;
                case "start-combat":
                    await combat.startCombat?.();
                    break;
                case "end-combat":
                    await combat.endCombat?.();
                    break;
                case "reset":
                    await this.resetInitiative(combat);
                    break;
            }
        } catch (error) {
            console.error(`${MODULE_ID} | Combat dock action "${action}" failed`, error);
        } finally {
            this.requestRefresh();
        }
    }

    private async resetInitiative(combat: DockCombat): Promise<void> {
        // Foundry's resetAll clears per-combatant initiative; side state persists.
        await combat.resetAll?.();
    }
}

const DOCK_TEMPLATE = `
  <div class="side-dock-frame">
    <div class="side-dock-content">
      <div class="side-dock-side" data-side="players">
        <div class="side-dock-portrait">
          <img class="side-dock-portrait-img" alt="" />
          <div class="side-dock-meta"></div>
          <div class="side-dock-label"></div>
        </div>
      </div>
      <div class="side-dock-divider">
        <div class="side-dock-divider-ornament"></div>
        <div class="side-dock-round"></div>
      </div>
      <div class="side-dock-side" data-side="monsters">
        <div class="side-dock-portrait">
          <img class="side-dock-portrait-img" alt="" />
          <div class="side-dock-meta"></div>
          <div class="side-dock-label"></div>
        </div>
      </div>
    </div>
  </div>
  <menu class="side-dock-controls">
    <li><button type="button" class="ui-control icon fa-solid fa-rotate-left side-dock-control" data-action="reset"></button></li>
    <li><button type="button" class="ui-control icon fa-solid fa-dice-d20 side-dock-control" data-action="roll-init"></button></li>
    <li class="side-dock-control-gap" aria-hidden="true"></li>
    <li><button type="button" class="ui-control icon fa-solid fa-play side-dock-control" data-action="start-combat"></button></li>
    <li><button type="button" class="ui-control icon fa-solid fa-stop side-dock-control" data-action="end-combat"></button></li>
    <li><button type="button" class="ui-control icon fa-solid fa-forward side-dock-control" data-action="advance"></button></li>
  </menu>
`;

let manager: CombatDockManager | null = null;

export function getCombatDock(): CombatDockManager {
    if (!manager) manager = new CombatDockManager();
    return manager;
}

/**
 * Register the combat dock. Called once during module hook setup. The dock only
 * mounts when the setting is enabled and a side combat is being viewed.
 */
export function registerCombatDock(): void {
    const dock = getCombatDock();
    dock.install();
}
