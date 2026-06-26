import {
	COMMANDER_CONTROL_OPTIONS,
	COMBAT_DOCK_SIZE_OPTIONS,
	INITIATIVE_METHOD_OPTIONS,
	MODULE_ID,
	SETTINGS,
} from "./constants.js";
import { SideInitiativeAPI, registerSideInitiativeSocket } from "./api.js";
import { installCombatPatches } from "./controller/combat-controller.js";
import { registerChrisPremadesIntegration } from "./integration/chris-premades.js";
import { registerDnd5eIntegration } from "./integration/dnd5e.js";
import { registerGambitsPremadesIntegration } from "./integration/gambits-premades.js";
import { registerLegendaryActionsIntegration } from "./integration/legendary-actions.js";
import { registerMidiQolIntegration } from "./integration/midi-qol.js";
import { getCombatDock, registerCombatDock } from "./ui/combat-dock.js";
import {
	addCombatantContextOptions,
	renderCombatTracker,
} from "./ui/tracker.js";
import {
	getSideInitiative,
	getSetting,
	hooks,
	isActiveGMClient,
	setSideInitiative,
} from "./runtime.js";
import type { CombatLike } from "./types.js";

type SettingsRegistrar = {
	register?: (
		scope: string,
		key: string,
		config: Record<string, unknown>,
	) => unknown;
} | null;
type KeybindingsRegistrar = {
	register?: (
		scope: string,
		name: string,
		config: Record<string, unknown>,
	) => unknown;
} | null;

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
		default: true,
	});

	settings?.register?.(MODULE_ID, SETTINGS.showTrackerControls, {
		name: "SIDE-INITIATIVE.Settings.ShowTrackerControls.Name",
		hint: "SIDE-INITIATIVE.Settings.ShowTrackerControls.Hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	settings?.register?.(MODULE_ID, SETTINGS.commanderControl, {
		name: "SIDE-INITIATIVE.Settings.CommanderControl.Name",
		hint: "SIDE-INITIATIVE.Settings.CommanderControl.Hint",
		scope: "world",
		config: true,
		type: String,
		choices: {
			[COMMANDER_CONTROL_OPTIONS.sideOwners]:
				"SIDE-INITIATIVE.Settings.CommanderControl.SideOwners",
			[COMMANDER_CONTROL_OPTIONS.gmOnly]:
				"SIDE-INITIATIVE.Settings.CommanderControl.GMOnly",
		},
		default: COMMANDER_CONTROL_OPTIONS.sideOwners,
	});

	settings?.register?.(MODULE_ID, SETTINGS.initiativeMethod, {
		name: "SIDE-INITIATIVE.Settings.InitiativeMethod.Name",
		hint: "SIDE-INITIATIVE.Settings.InitiativeMethod.Hint",
		scope: "world",
		config: true,
		type: String,
		choices: {
			[INITIATIVE_METHOD_OPTIONS.sideD20]:
				"SIDE-INITIATIVE.Settings.InitiativeMethod.SideD20",
			[INITIATIVE_METHOD_OPTIONS.weightedAverage]:
				"SIDE-INITIATIVE.Settings.InitiativeMethod.WeightedAverage",
		},
		default: INITIATIVE_METHOD_OPTIONS.sideD20,
	});

	settings?.register?.(MODULE_ID, SETTINGS.legendaryActionWindows, {
		name: "SIDE-INITIATIVE.Settings.LegendaryActionWindows.Name",
		hint: "SIDE-INITIATIVE.Settings.LegendaryActionWindows.Hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
	});

	settings?.register?.(MODULE_ID, SETTINGS.useCombatDock, {
		name: "SIDE-INITIATIVE.Settings.UseCombatDock.Name",
		hint: "SIDE-INITIATIVE.Settings.UseCombatDock.Hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
		onChange: (value: unknown) => {
			const dock = getCombatDock();
			if (!value) dock.unmount();
			else dock.requestRefresh();
		},
	});

	settings?.register?.(MODULE_ID, SETTINGS.combatDockSize, {
		name: "SIDE-INITIATIVE.Settings.CombatDockSize.Name",
		hint: "SIDE-INITIATIVE.Settings.CombatDockSize.Hint",
		scope: "world",
		config: true,
		type: String,
		choices: {
			[COMBAT_DOCK_SIZE_OPTIONS.tiny]:
				"SIDE-INITIATIVE.Settings.CombatDockSize.Tiny",
			[COMBAT_DOCK_SIZE_OPTIONS.small]:
				"SIDE-INITIATIVE.Settings.CombatDockSize.Small",
			[COMBAT_DOCK_SIZE_OPTIONS.medium]:
				"SIDE-INITIATIVE.Settings.CombatDockSize.Medium",
			[COMBAT_DOCK_SIZE_OPTIONS.large]:
				"SIDE-INITIATIVE.Settings.CombatDockSize.Large",
			[COMBAT_DOCK_SIZE_OPTIONS.xlarge]:
				"SIDE-INITIATIVE.Settings.CombatDockSize.XLarge",
		},
		default: COMBAT_DOCK_SIZE_OPTIONS.medium,
		onChange: () => getCombatDock().requestRefresh(),
	});

	settings?.register?.(MODULE_ID, SETTINGS.hideConflictingTopUI, {
		name: "SIDE-INITIATIVE.Settings.HideConflictingTopUI.Name",
		hint: "SIDE-INITIATIVE.Settings.HideConflictingTopUI.Hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => getCombatDock().requestRefresh(),
	});

	settings?.register?.(MODULE_ID, SETTINGS.usePrimaryPartyArt, {
		name: "SIDE-INITIATIVE.Settings.UsePrimaryPartyArt.Name",
		hint: "SIDE-INITIATIVE.Settings.UsePrimaryPartyArt.Hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => getCombatDock().requestRefresh(),
	});
}

/**
 * Handle combat updates that start a new encounter.
 */
export async function handleCombatStartedUpdate(
	combat: CombatLike,
	changed: { started?: boolean } | null | undefined,
): Promise<void> {
	if (!changed?.started) return;
	if (!isActiveGMClient()) return;

	await getSideInitiative()?.refreshCombatantSides?.(combat);

	const initiativeMethod = getSetting(MODULE_ID, SETTINGS.initiativeMethod) as
		| string
		| undefined;
	if (initiativeMethod !== INITIATIVE_METHOD_OPTIONS.weightedAverage) return;

	const state = getSideInitiative()?.getSideState?.(combat);
	if (
		state &&
		"lastRolledRound" in state &&
		state.lastRolledRound === combat?.round
	)
		return;

	await getSideInitiative()?.rollWeightedSideInitiative?.(combat, {
		refresh: false,
	});
}

/**
 * Register module keybindings.
 */
function registerKeybindings(): void {
	const keybindings = game?.keybindings as unknown as KeybindingsRegistrar;
	keybindings?.register?.(MODULE_ID, "advanceSide", {
		name: "SIDE-INITIATIVE.Keybindings.AdvanceSide.Name",
		hint: "SIDE-INITIATIVE.Keybindings.AdvanceSide.Hint",
		editable: [{ key: "Enter" }],
		onDown: () => {
			const combat = (game?.combat as CombatLike | null) ?? null;
			if (
				!getSideInitiative()?.canUserAdvanceSide?.(combat, game?.user as never)
			)
				return false;

			try {
				void Promise.resolve(game?.combat?.nextTurn?.()).catch(
					(error: unknown) => {
						console.error(
							`${MODULE_ID} | Failed to advance side via Enter`,
							error,
						);
					},
				);
			} catch (error) {
				console.error(`${MODULE_ID} | Failed to advance side via Enter`, error);
			}
			return true;
		},
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
	registerCombatDock();
}

Hooks.once("init", () => {
	registerSettings();
	setSideInitiative(SideInitiativeAPI);
	registerKeybindings();
	installCombatPatches();
	registerHooks();
});

Hooks.once("ready", () => {
	registerSideInitiativeSocket();
	if (game?.combat) {
		getSideInitiative()?.refreshCombatantSides?.(game.combat as CombatLike);
	}
	getCombatDock().requestRefresh();
	registerDnd5eIntegration();
	registerGambitsPremadesIntegration();
	if (game?.modules?.get?.("chris-premades")?.active) {
		registerChrisPremadesIntegration();
	}
	if (game?.modules?.get?.("midi-qol")?.active) {
		registerMidiQolIntegration();
	}
	registerLegendaryActionsIntegration();
});
