export const MODULE_ID = "side-initiative";
export const FLAG_SCOPE = MODULE_ID;
export const SIDE_STATE_FLAG = "state";
export const COMBATANT_SIDE_FLAG = "sideId";
export const COMBATANT_SIDE_SOURCE_FLAG = "sideSource";
export const COMMANDER_CONTROL_SETTING = "commanderControl";
export const INITIATIVE_METHOD_SETTING = "initiativeMethod";
export const SOCKET_EVENT = `module.${MODULE_ID}`;

export const COMMANDER_CONTROL_OPTIONS = {
    sideOwners: "side-owners",
    gmOnly: "gm-only"
} as const;

export const INITIATIVE_METHOD_OPTIONS = {
    sideD20: "side-d20",
    weightedAverage: "weighted-combatant-average"
} as const;

export const DEFAULT_SIDE_ORDER: readonly string[] = ["players", "allies", "neutral", "monsters"];

export interface SideSeed {
    id: string;
    name: string;
    color: string;
}

export const DEFAULT_SIDE_DATA: Record<string, SideSeed> = {
    players: { id: "players", name: "Players", color: "#2d8f5f" },
    allies: { id: "allies", name: "Allies", color: "#4aa86e" },
    neutral: { id: "neutral", name: "Neutral", color: "#777777" },
    monsters: { id: "monsters", name: "Monsters", color: "#b93a3a" }
};

export const SETTINGS = {
    groupByDisposition: "groupByDisposition",
    showTrackerControls: "showTrackerControls",
    commanderControl: COMMANDER_CONTROL_SETTING,
    initiativeMethod: INITIATIVE_METHOD_SETTING
} as const;
