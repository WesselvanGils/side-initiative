const MODULE_ID = "side-initiative";
const WORLD_ID = "side-initiative-playtest";
const PLAYER_NAME = "Player2";
const FIXTURE_FLAG = "playtestFixture";

const ACTORS = [
    { name: "Playtest Hero A", type: "character", disposition: 1, playerOwned: true, x: 900 },
    { name: "Playtest Hero B", type: "character", disposition: 1, playerOwned: true, x: 1200 },
    { name: "Playtest Ally", type: "npc", disposition: 0, playerOwned: false, x: 1500 },
    { name: "Playtest Goblin A", type: "npc", disposition: -1, playerOwned: false, x: 1900 },
    { name: "Playtest Goblin B", type: "npc", disposition: -1, playerOwned: false, x: 2200 },
];

function requirePlaytestWorld() {
    if (!globalThis.game?.ready || !game.user?.isGM) {
        throw new Error("The playtest fixture must be seeded by a GM after the Foundry world is ready.");
    }
    if (game.world?.id !== WORLD_ID) {
        throw new Error(`Refusing to seed fixtures outside the ${WORLD_ID} world.`);
    }
    if (game.system?.id !== "dnd5e") {
        throw new Error("The playtest fixture requires the dnd5e system.");
    }
    if (!game.modules?.get(MODULE_ID)?.active || !game.sideInitiative) {
        throw new Error("Enable Side Initiative and reload the world before seeding fixtures.");
    }
    if (!canvas?.scene) throw new Error("Open a scene before seeding fixtures.");
}

function fixtureCombat() {
    return (
        game.combats?.find((combat) => combat.getFlag(MODULE_ID, FIXTURE_FLAG)) ??
        game.combats?.find((combat) =>
            ACTORS.every(({ name }) => combat.combatants.some((entry) => entry.name === name)),
        ) ??
        null
    );
}

export function getSideInitiativePlaytestStatus() {
    const scene = canvas?.scene ?? null;
    const combat = fixtureCombat();
    return {
        world: game.world?.id ?? null,
        system: game.system?.id ?? null,
        moduleActive: Boolean(game.modules?.get(MODULE_ID)?.active),
        scene: scene?.name ?? null,
        player: game.users?.getName(PLAYER_NAME)?.id ?? null,
        actors: ACTORS.map(({ name }) => ({
            name,
            actorId: game.actors?.getName(name)?.id ?? null,
            tokenId: scene?.tokens?.find((token) => token.name === name)?.id ?? null,
        })),
        combat: combat
            ? {
                  id: combat.id,
                  started: combat.started,
                  round: combat.round,
                  combatants: combat.combatants.size,
              }
            : null,
    };
}

export async function seedSideInitiativePlaytestFixture() {
    requirePlaytestWorld();

    const player =
        game.users.getName(PLAYER_NAME) ??
        (await User.create({
            name: PLAYER_NAME,
            role: CONST.USER_ROLES.PLAYER,
        }));
    if (!player) throw new Error(`Unable to create ${PLAYER_NAME}.`);

    const actors = new Map();
    for (const definition of ACTORS) {
        let actor = game.actors.getName(definition.name);
        const ownership = definition.playerOwned
            ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
            : { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
        const data = {
            name: definition.name,
            type: definition.type,
            ownership,
            prototypeToken: {
                name: definition.name,
                disposition: definition.disposition,
            },
        };
        if (actor) await actor.update(data);
        else actor = await Actor.create(data);
        if (!actor) throw new Error(`Unable to create ${definition.name}.`);
        actors.set(definition.name, actor);
    }

    const scene = canvas.scene;
    const missingTokens = ACTORS.filter(({ name }) => !scene.tokens.find((token) => token.name === name));
    if (missingTokens.length) {
        await scene.createEmbeddedDocuments(
            "Token",
            missingTokens.map((definition) => ({
                name: definition.name,
                actorId: actors.get(definition.name).id,
                disposition: definition.disposition,
                x: definition.x,
                y: 700,
            })),
        );
    }

    let combat = fixtureCombat();
    if (!combat) {
        combat = await Combat.create({
            scene: scene.id,
            active: true,
            flags: { [MODULE_ID]: { [FIXTURE_FLAG]: true } },
        });
    }
    if (!combat) throw new Error("Unable to create the playtest encounter.");

    const existingTokenIds = new Set(combat.combatants.map((entry) => entry.tokenId));
    const missingCombatants = ACTORS.map(({ name }) => scene.tokens.find((token) => token.name === name)).filter(
        (token) => token && !existingTokenIds.has(token.id),
    );
    if (missingCombatants.length) {
        await combat.createEmbeddedDocuments(
            "Combatant",
            missingCombatants.map((token) => ({
                tokenId: token.id,
                actorId: token.actorId,
            })),
        );
    }

    await combat.setFlag(MODULE_ID, FIXTURE_FLAG, true);
    await game.sideInitiative.refreshCombatantSides(combat, { overwrite: true });
    return getSideInitiativePlaytestStatus();
}
