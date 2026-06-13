import { MODULE_ID, SETTINGS } from "./constants.mjs";
import { SideInitiativeAPI } from "./api.mjs";
import { installCombatPatches } from "./combat-controller.mjs";
import { registerMidiQolIntegration } from "./integration/midi-qol.mjs";
import { renderCombatTracker } from "./ui/tracker.mjs";

function registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS.warnOnOffSide, {
        name: "SIDE-INITIATIVE.Settings.WarnOnOffSide.Name",
        hint: "SIDE-INITIATIVE.Settings.WarnOnOffSide.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

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
}

function registerHooks() {
    Hooks.on("renderCombatTracker", renderCombatTracker);
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
    installCombatPatches();
    registerHooks();
});

Hooks.once("ready", () => {
    if (game.combat) {
        game.sideInitiative?.refreshCombatantSides?.(game.combat);
    }
    if (game.modules.get("midi-qol")?.active) {
        registerMidiQolIntegration();
    }
});
