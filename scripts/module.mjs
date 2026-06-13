import { COMMANDER_CONTROL_OPTIONS, MODULE_ID, SETTINGS } from "./constants.mjs";
import { SideInitiativeAPI } from "./api.mjs";
import { installCombatPatches } from "./combat-controller.mjs";
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
    Hooks.on("updateCombat", async (combat, changed) => {
        if (changed?.started) {
            await game.sideInitiative?.refreshCombatantSides?.(combat);
        }
    });
}

Hooks.once("init", () => {
    registerSettings();
    game.sideInitiative = SideInitiativeAPI;
    registerKeybindings();
    installCombatPatches();
    registerHooks();
});

Hooks.once("ready", () => {
    if (game.combat) {
        game.sideInitiative?.refreshCombatantSides?.(game.combat);
    }
    registerGambitsPremadesIntegration();
    if (game.modules.get("midi-qol")?.active) {
        registerMidiQolIntegration();
    }
});
