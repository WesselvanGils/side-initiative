/** @type {string} */
export const MODULE_ID = "side-initiative";
/** @type {string} */
export const FLAG_SCOPE = MODULE_ID;
/** @type {string} */
export const SIDE_STATE_FLAG = "state";
/** @type {string} */
export const COMBATANT_SIDE_FLAG = "sideId";
/** @type {string} */
export const COMBATANT_SIDE_SOURCE_FLAG = "sideSource";
/** @type {string} */
export const COMMANDER_CONTROL_SETTING = "commanderControl";
/** @type {string} */
export const SOCKET_EVENT = `module.${MODULE_ID}`;

/** @type {{ sideOwners: string, gmOnly: string }} */
export const COMMANDER_CONTROL_OPTIONS = {
    sideOwners: "side-owners",
    gmOnly: "gm-only"
};

/** @type {readonly string[]} */
export const DEFAULT_SIDE_ORDER = ["players", "allies", "neutral", "monsters"];

/** @type {Record<string, { id: string, name: string, color: string }>} */
export const DEFAULT_SIDE_DATA = {
    players: { id: "players", name: "Players", color: "#2d8f5f" },
    allies: { id: "allies", name: "Allies", color: "#4aa86e" },
    neutral: { id: "neutral", name: "Neutral", color: "#777777" },
    monsters: { id: "monsters", name: "Monsters", color: "#b93a3a" }
};

/** @type {{ groupByDisposition: string, showTrackerControls: string, commanderControl: string }} */
export const SETTINGS = {
    groupByDisposition: "groupByDisposition",
    showTrackerControls: "showTrackerControls",
    commanderControl: COMMANDER_CONTROL_SETTING
};
