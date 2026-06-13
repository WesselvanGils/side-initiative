import test from "node:test";
import assert from "node:assert/strict";
import { renderCombatTracker } from "../scripts/ui/tracker.mjs";

function createClassList(owner) {
    const values = new Set();
    return {
        add(...tokens) {
            for (const token of tokens) {
                values.add(token);
            }
            owner.className = Array.from(values).join(" ");
        },
        remove(...tokens) {
            for (const token of tokens) {
                values.delete(token);
            }
            owner.className = Array.from(values).join(" ");
        },
        contains(token) {
            return values.has(token);
        },
        toggle(token, force) {
            if (force === undefined ? !values.has(token) : force) {
                values.add(token);
                owner.className = Array.from(values).join(" ");
                return true;
            }
            values.delete(token);
            owner.className = Array.from(values).join(" ");
            return false;
        }
    };
}

function createElement(tagName = "div") {
    const element = {
        tagName,
        className: "",
        attributes: {},
        dataset: {},
        listeners: {},
        children: [],
        style: {},
        classList: null,
        parentNode: null,
        _innerHTML: "",
        setAttribute(name, value) {
            this.attributes[name] = String(value);
            if (name === "class") this.className = String(value);
            if (name.startsWith("data-")) {
                const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
                this.dataset[key] = String(value);
            }
        },
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        },
        append(...nodes) {
            for (const node of nodes) {
                this.children.push(node);
                node.parentNode = this;
            }
        },
        prepend(...nodes) {
            this.children.unshift(...nodes);
            for (const node of nodes) {
                node.parentNode = this;
            }
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        remove() {
            this.removed = true;
        },
        before(node) {
            this.beforeNode = node;
            node.parentNode = this.parentNode;
        },
        set innerHTML(value) {
            this._innerHTML = String(value);
        },
        get innerHTML() {
            return this._innerHTML;
        }
    };
    element.classList = createClassList(element);
    return element;
}

function createTrackerRow(combatantId) {
    const row = createElement("div");
    row.dataset.combatantId = combatantId;
    row.sideStrip = null;
    row.commanderButton = null;
    row.tokenEffectsAnchor = {
        before(node) {
            row.commanderButton = node;
            node.parentNode = row;
        }
    };
    row.querySelector = (selector) => {
        if (selector === ".side-initiative-strip") return row.sideStrip;
        if (selector === ".side-initiative-commander-control") return row.commanderButton;
        if (selector === ".token-effects") return row.tokenEffectsAnchor;
        return null;
    };
    row.prepend = (node) => {
        if (node.className?.includes("side-initiative-strip")) {
            row.sideStrip = node;
        }
        node.parentNode = row;
    };
    row.append = (node) => {
        if (node.className?.includes("side-initiative-commander-control")) {
            row.commanderButton = node;
        }
        node.parentNode = row;
    };
    return row;
}

function createCombatant({ id, sideId, owner = false }) {
    return {
        id,
        name: id,
        hasPlayerOwner: sideId === "players",
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "sideId") return sideId;
            return null;
        },
        testUserPermission(user, permission) {
            return permission === "OWNER" && (user?.isGM || owner);
        }
    };
}

function createCombat(combatants, commanderIds = {}) {
    return {
        combatants: new Map(combatants.map((combatant) => [combatant.id, combatant])),
        getFlag(scope, key) {
            if (scope === "side-initiative" && key === "state") {
                return {
                    activeSideId: "players",
                    order: ["players", "monsters"],
                    sides: {
                        players: { id: "players", combatantIds: ["pc-1", "pc-2"] },
                        monsters: { id: "monsters", combatantIds: ["npc-1"] }
                    },
                    commanderIds
                };
            }
            return null;
        }
    };
}

function installGlobals({ combat, user, can = true, commanderMap }) {
    const original = {
        document: globalThis.document,
        game: globalThis.game
    };

    globalThis.document = {
        createElement
    };
    globalThis.game = {
        combat,
        user,
        settings: {
            get(namespace, key) {
                if (namespace === "side-initiative" && key === "showTrackerControls") return true;
                return null;
            }
        },
        i18n: {
            localize(key) {
                return key;
            }
        },
        sideInitiative: {
            canUserSetCommander() {
                return can;
            },
            getSideCommander(_combat, sideId) {
                const commanderId = commanderMap.get(sideId) ?? null;
                return commanderId ? combat.combatants.get(commanderId) : null;
            },
            setSideCommander(_combat, combatant) {
                commanderMap.set(combatant.getFlag("side-initiative", "sideId"), combatant.id);
                return Promise.resolve(combatant);
            }
        }
    };

    return {
        restore() {
            globalThis.document = original.document;
            globalThis.game = original.game;
        }
    };
}

function createTrackerRoot(rows) {
    return {
        panel: null,
        querySelector(selector) {
            if (selector === ".side-initiative-panel") return this.panel;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === ".combatant") return rows;
            return [];
        },
        prepend(node) {
            this.panel = node;
            node.parentNode = this;
        }
    };
}

test("renderCombatTracker adds commander buttons for eligible rows across sides", () => {
    const combatants = [
        createCombatant({ id: "pc-1", sideId: "players", owner: true }),
        createCombatant({ id: "pc-2", sideId: "players", owner: true }),
        createCombatant({ id: "npc-1", sideId: "monsters", owner: true })
    ];
    const combat = createCombat(combatants, {
        players: "pc-2",
        monsters: "npc-1"
    });
    const rows = combatants.map((combatant) => createTrackerRow(combatant.id));
    const app = {
        viewed: combat
    };
    const root = createTrackerRoot(rows);
    const env = installGlobals({
        combat,
        user: { id: "gm-1", isGM: true, can: () => true },
        can: true,
        commanderMap: new Map([["players", "pc-2"], ["monsters", "npc-1"]])
    });

    try {
        renderCombatTracker(app, [root]);

        assert.ok(rows[0].sideStrip);
        assert.ok(rows[1].sideStrip);
        assert.ok(rows[2].sideStrip);

        assert.ok(rows[0].commanderButton);
        assert.ok(rows[1].commanderButton);
        assert.ok(rows[2].commanderButton);

        assert.equal(rows[0].commanderButton.classList.contains("active"), false);
        assert.equal(rows[1].commanderButton.classList.contains("active"), true);
        assert.equal(rows[2].commanderButton.classList.contains("active"), true);
        assert.equal(rows[0].commanderButton.parentNode, rows[0]);
    } finally {
        env.restore();
    }
});

test("renderCombatTracker commander button updates the commander and rerenders", async () => {
    const combatants = [
        createCombatant({ id: "pc-1", sideId: "players", owner: true }),
        createCombatant({ id: "pc-2", sideId: "players", owner: true })
    ];
    const combat = createCombat(combatants, {
        players: "pc-1"
    });
    const row = createTrackerRow("pc-2");
    const app = {
        viewed: combat,
        renderCalls: 0,
        render() {
            this.renderCalls += 1;
        }
    };
    const root = createTrackerRoot([row]);
    const commanderMap = new Map([["players", "pc-1"]]);
    const env = installGlobals({
        combat,
        user: { id: "gm-1", isGM: true, can: () => true },
        can: true,
        commanderMap
    });

    try {
        renderCombatTracker(app, [root]);

        assert.ok(row.commanderButton);
        assert.equal(row.commanderButton.classList.contains("active"), false);

        await row.commanderButton.listeners.click({
            preventDefault() {},
            stopPropagation() {}
        });

        assert.equal(commanderMap.get("players"), "pc-2");
        assert.equal(app.renderCalls, 1);
    } finally {
        env.restore();
    }
});

test("renderCombatTracker omits commander buttons when the user cannot set them", () => {
    const combatants = [
        createCombatant({ id: "pc-1", sideId: "players", owner: false })
    ];
    const combat = createCombat(combatants, {});
    const row = createTrackerRow("pc-1");
    const root = createTrackerRoot([row]);
    const env = installGlobals({
        combat,
        user: { id: "user-1", isGM: false, can: () => true },
        can: false,
        commanderMap: new Map()
    });

    try {
        renderCombatTracker({ viewed: combat }, [root]);
        assert.equal(row.commanderButton, null);
    } finally {
        env.restore();
    }
});
