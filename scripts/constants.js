export const MODULE_ID = "side-initiative";
export const FLAG_SCOPE = MODULE_ID;
export const SIDE_STATE_FLAG = "state";
export const COMBATANT_SIDE_FLAG = "sideId";
export const COMBATANT_SIDE_SOURCE_FLAG = "sideSource";

export const DEFAULT_SIDE_ORDER = ["players", "allies", "neutral", "monsters"];

export const DEFAULT_SIDE_DATA = {
  players: { id: "players", name: "Players", color: "#2d8f5f" },
  allies: { id: "allies", name: "Allies", color: "#4aa86e" },
  neutral: { id: "neutral", name: "Neutral", color: "#777777" },
  monsters: { id: "monsters", name: "Monsters", color: "#b93a3a" }
};

export const SETTINGS = {
  warnOnOffSide: "warnOnOffSide",
  groupByDisposition: "groupByDisposition",
  showTrackerControls: "showTrackerControls"
};
