import { MODULE_ID, SETTINGS } from "./constants.js";
import { SideInitiativeAPI } from "./api.js";
import { registerMidiQolIntegration } from "./integration/midi-qol.js";
import { renderCombatTracker } from "./ui/tracker.js";

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
}

Hooks.once("init", () => {
  registerSettings();
  game.sideInitiative = SideInitiativeAPI;
  registerHooks();
});

Hooks.once("ready", () => {
  if (game.modules.get("midi-qol")?.active) {
    registerMidiQolIntegration();
  }
});
