import { COMMANDER_CONTROL_OPTIONS, INITIATIVE_METHOD_OPTIONS, MODULE_ID, SETTINGS, SOCKET_EVENT } from "./constants.js";
import { SideInitiativeAPI, handleCommanderSocketRequest } from "./api.js";
import { installCombatPatches } from "./controller/combat-controller.js";
import { registerChrisPremadesIntegration } from "./integration/chris-premades.js";
import { registerGambitsPremadesIntegration } from "./integration/gambits-premades.js";
import { registerMidiQolIntegration } from "./integration/midi-qol.js";
import { addCombatantContextOptions, renderCombatTracker } from "./ui/tracker.js";
import { getSideInitiative, getSetting, hooks, isActiveGMClient, setSideInitiative } from "./runtime.js";
import type { CombatLike } from "./types.js";

type SettingsRegistrar = { register?: (scope: string, key: string, config: Record<string, unknown>) => unknown } | null;
type KeybindingsRegistrar = { register?: (scope: string, name: string, config: Record<string, unknown>) => unknown } | null;

/**
 * Register module settings.
 */
function registerSettings(): void {
    const settings = game?.settings as SettingsRegistrar;
    settings?.register?.(MODULE_ID, SETTINGS.groupByDisposition, {
        name: "SIDE-INITIATIVE.Settings.GroupByDisposition.Name",
        hint: "SIDE-INITIATIVE.Settings.GroupByDisposition.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    settings?.register?.(MODULE_ID, SETTINGS.showTrackerControls, {
        name: "SIDE-INITIATIVE.Settings.ShowTrackerControls.Name",
        hint: "SIDE-INITIATIVE.Settings.ShowTrackerControls.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    settings?.register?.(MODULE_ID, SETTINGS.commanderControl, {
        name: "SIDE-INITIATIVE.Settings.CommanderControl.Name",
        hint: "SIDE-INITIATIVE.Settings.CommanderControl.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            [COMMANDER_CONTROL_OPTIONS.sideOwners]: "SIDE-INITIATIVE.Settings.CommanderControl.SideOwners",
            [COMMANDER_CONTROL_OPTIONS.gmOnly]: "SIDE-INITIATIVE.Settings.CommanderControl.GMOnly"
        },
        default: COMMANDER_CONTROL_OPTIONS.sideOwners
    });

    settings?.register?.(MODULE_ID, SETTINGS.initiativeMethod, {
        name: "SIDE-INITIATIVE.Settings.InitiativeMethod.Name",
        hint: "SIDE-INITIATIVE.Settings.InitiativeMethod.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            [INITIATIVE_METHOD_OPTIONS.sideD20]: "SIDE-INITIATIVE.Settings.InitiativeMethod.SideD20",
            [INITIATIVE_METHOD_OPTIONS.weightedAverage]: "SIDE-INITIATIVE.Settings.InitiativeMethod.WeightedAverage"
        },
        default: INITIATIVE_METHOD_OPTIONS.sideD20
    });
}

/**
 * Handle combat updates that start a new encounter.
 */
export async function handleCombatStartedUpdate(combat: CombatLike, changed: { started?: boolean } | null | undefined): Promise<void> {
    if (!changed?.started) return;
    if (!isActiveGMClient()) return;

    await getSideInitiative()?.refreshCombatantSides?.(combat);

    const initiativeMethod = getSetting(MODULE_ID, SETTINGS.initiativeMethod) as string | undefined;
    if (initiativeMethod !== INITIATIVE_METHOD_OPTIONS.weightedAverage) return;

    const state = getSideInitiative()?.getSideState?.(combat);
    if (state && "lastRolledRound" in state && state.lastRolledRound === combat?.round) return;

    await getSideInitiative()?.rollWeightedSideInitiative?.(combat, { refresh: false });
}

/**
 * Register module keybindings.
 */
function registerKeybindings(): void {
    const keybindings = game?.keybindings as unknown as KeybindingsRegistrar;
    keybindings?.register?.(MODULE_ID, "advanceSide", {
        name: "SIDE-INITIATIVE.Keybindings.AdvanceSide.Name",
        hint: "SIDE-INITIATIVE.Keybindings.AdvanceSide.Hint",
        editable: [
            { key: "Enter" }
        ],
        onDown: () => {
            const combat = (game?.combat as CombatLike | null) ?? null;
            if (!getSideInitiative()?.canUserAdvanceSide?.(combat, game?.user as never)) return false;

            try {
                void Promise.resolve(game?.combat?.nextTurn?.()).catch((error: unknown) => {
                    console.error(`${MODULE_ID} | Failed to advance side via Enter`, error);
                });
            } catch (error) {
                console.error(`${MODULE_ID} | Failed to advance side via Enter`, error);
            }
            return true;
        }
    });
}

/**
 * Register Foundry hooks used by the module.
 */
function registerHooks(): void {
    hooks()?.on("renderCombatTracker", renderCombatTracker);
    hooks()?.on("getCombatantContextOptions", addCombatantContextOptions);
    hooks()?.on("createCombat", async (combat: CombatLike) => {
        if (!isActiveGMClient()) return;
        await getSideInitiative()?.refreshCombatantSides?.(combat);
    });
    hooks()?.on("updateCombat", handleCombatStartedUpdate);
}

Hooks.once("init", () => {
    registerSettings();
    setSideInitiative(SideInitiativeAPI);
    registerKeybindings();
    installCombatPatches();
    registerHooks();
});

Hooks.once("ready", () => {
    game?.socket?.on?.(SOCKET_EVENT, handleCommanderSocketRequest as (...args: unknown[]) => void);
    if (game?.combat) {
        getSideInitiative()?.refreshCombatantSides?.(game.combat as CombatLike);
    }
    registerGambitsPremadesIntegration();
    if (game?.modules?.get?.("chris-premades")?.active) {
        registerChrisPremadesIntegration();
    }
    if (game?.modules?.get?.("midi-qol")?.active) {
        registerMidiQolIntegration();
    }
});
