import { COMMANDER_CONTROL_OPTIONS, INITIATIVE_METHOD_OPTIONS, MODULE_ID, SETTINGS, SOCKET_EVENT } from "./constants.mjs";
import { SideInitiativeAPI } from "./api.mjs";
import { installCombatPatches } from "./combat-controller.mjs";
import { handleCommanderSocketRequest } from "./api.mjs";
import { registerGambitsPremadesIntegration } from "./integration/gambits-premades.mjs";
import { registerMidiQolIntegration } from "./integration/midi-qol.mjs";
import { addCombatantContextOptions, renderCombatTracker } from "./ui/tracker.mjs";

/**
 * Register module settings.
 * @returns {void}
 */
function registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS.groupByDisposition, {
        name: "SIDE-INITIATIVE.Settings.GroupByDisposition.Name",
        hint: "SIDE-INITIATIVE.Settings.GroupByDisposition.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTINGS.showTrackerControls, {
        name: "SIDE-INITIATIVE.Settings.ShowTrackerControls.Name",
        hint: "SIDE-INITIATIVE.Settings.ShowTrackerControls.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTINGS.commanderControl, {
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

    game.settings.register(MODULE_ID, SETTINGS.initiativeMethod, {
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
 * @param {object} combat
 * @param {object} changed
 * @returns {Promise<void>}
 */
export async function handleCombatStartedUpdate(combat, changed) {
    if (!changed?.started) return;

    await game.sideInitiative?.refreshCombatantSides?.(combat);

    const initiativeMethod = game.settings?.get?.(MODULE_ID, SETTINGS.initiativeMethod);
    if (initiativeMethod !== INITIATIVE_METHOD_OPTIONS.weightedAverage) return;

    const state = game.sideInitiative?.getSideState?.(combat);
    if (state?.lastRolledRound === combat?.round) return;

    await game.sideInitiative?.rollWeightedSideInitiative?.(combat, { refresh: false });
}

/**
 * Register module keybindings.
 * @returns {void}
 */
function registerKeybindings() {
    game.keybindings?.register(MODULE_ID, "advanceSide", {
        name: "SIDE-INITIATIVE.Keybindings.AdvanceSide.Name",
        hint: "SIDE-INITIATIVE.Keybindings.AdvanceSide.Hint",
        editable: [
            { key: "Enter" }
        ],
        onDown: () => {
            const combat = game.combat ?? null;
            if (!game.sideInitiative?.canUserAdvanceSide?.(combat, game.user)) return false;

            try {
                void Promise.resolve(game.combat?.nextTurn?.()).catch((error) => {
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
 * @returns {void}
 */
function registerHooks() {
    Hooks.on("renderCombatTracker", renderCombatTracker);
    Hooks.on("getCombatantContextOptions", addCombatantContextOptions);
    Hooks.on("createCombat", async (combat) => {
        await game.sideInitiative?.refreshCombatantSides?.(combat);
    });
    Hooks.on("updateCombat", handleCombatStartedUpdate);
}

Hooks.once("init", () => {
    registerSettings();
    game.sideInitiative = SideInitiativeAPI;
    registerKeybindings();
    installCombatPatches();
    registerHooks();
});

Hooks.once("ready", () => {
    game.socket?.on?.(SOCKET_EVENT, handleCommanderSocketRequest);
    if (game.combat) {
        game.sideInitiative?.refreshCombatantSides?.(game.combat);
    }
    registerGambitsPremadesIntegration();
    if (game.modules.get("midi-qol")?.active) {
        registerMidiQolIntegration();
    }
});
