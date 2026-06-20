import { getCombatantsForSide, isSideCombat } from "../logic.js";
import { hooks, isPrimaryGMClient } from "../runtime.js";
import type { ActorLike, CombatLike, CombatantLike, SideTurnPayload } from "../types.js";

/**
 * dnd5e-system compatibility for side initiative.
 *
 * Legendary actions (`system.resources.legact`) are recovered by dnd5e at the
 * END of a creature's turn — `NpcData5e.recoverCombatUses` resets
 * `legact.value` to `max` for the period `"turnEnd"`, and that period is only
 * attached to the single combatant whose turn is ending (`Combat5e._onEndTurn`
 * → `_recoverUses({ turnEnd: combatant })`). In side initiative only the side
 * representative is ever the "current" combatant, so:
 *   1. recovery lands at the END of the side's turn, and
 *   2. every other legendary creature on the side is never recovered at all.
 *
 * The rules state legendary actions are regained at the START of each of the
 * creature's turns. Two pieces fix this for side combats:
 *   - `sideTurnStart`: reset `legact` for every combatant on the side.
 *   - `dnd5e.combatRecovery`: suppress dnd5e's native END-of-turn `legact`
 *     reset (the `"turnEnd"` period) so recovery happens once, at the start.
 * Encounter-start recovery is left untouched, and item-use recovery is never
 * touched — only the `legact` key on the `turnEnd` period is removed.
 *
 * This is a general side-initiative correctness fix; it is NOT gated on the
 * Legendary Action Windows setting.
 */

const LEGACT_VALUE_KEY = "system.resources.legact.value";

interface LegactResource {
    value?: unknown;
    max?: unknown;
}

interface CombatRecoveryResults {
    actor?: Record<string, unknown>;
    item?: unknown[];
    rolls?: unknown[];
}

function resolveActor(combatant: CombatantLike | null | undefined): ActorLike | null {
    return combatant?.actor ?? combatant?.document?.actor ?? combatant?.token?.actor ?? null;
}

function resolveCombat(combatant: CombatantLike | null | undefined): CombatLike | null {
    const parent = (combatant as { parent?: CombatLike } | null | undefined)?.parent;
    return parent ?? (game?.combat as CombatLike | null) ?? null;
}

function readLegact(actor: ActorLike | null | undefined): { value: number; max: number } | null {
    const legact = (actor as { system?: { resources?: { legact?: LegactResource } } })
        ?.system?.resources?.legact;
    if (!legact) return null;
    const max = Number(legact.max);
    if (!Number.isFinite(max) || max <= 0) return null;
    const value = Number(legact.value);
    return { value: Number.isFinite(value) ? value : max, max };
}

async function recoverLegendaryActionsForSide(
    combat: CombatLike | null | undefined,
    sideId: string | null | undefined
): Promise<void> {
    if (!combat?.started || !sideId) return;

    for (const combatant of getCombatantsForSide(combat, sideId, { includeDefeated: false })) {
        const actor = resolveActor(combatant);
        const legact = readLegact(actor);
        if (!legact || legact.value === legact.max) continue;
        try {
            await actor?.update?.({ [LEGACT_VALUE_KEY]: legact.max });
        } catch (error) {
            console.warn("side-initiative | Failed to recover legendary actions for", actor?.name, error);
        }
    }
}

/**
 * `dnd5e.combatRecovery` hook: drop dnd5e's native END-of-turn legendary-action
 * reset for side combats so recovery only happens at the start of the side's
 * turn (handled above). Mutates `results` in place; never returns `false`, so
 * item-use recovery and encounter-start recovery are unaffected.
 */
function suppressEndOfTurnLegendaryRecovery(
    combatant: CombatantLike | null | undefined,
    periods: unknown,
    results: CombatRecoveryResults | null | undefined
): void {
    if (!Array.isArray(periods) || !periods.includes("turnEnd")) return;
    if (!results?.actor || typeof results.actor !== "object") return;
    if (!isSideCombat(resolveCombat(combatant))) return;
    delete results.actor[LEGACT_VALUE_KEY];
}

/**
 * Register dnd5e-system side-initiative fixes:
 *  - recover legendary actions for the whole side at the start of its turn;
 *  - suppress dnd5e's native end-of-turn legendary-action reset for side combats.
 */
export function registerDnd5eIntegration(): void {
    hooks()?.on("side-initiative.sideTurnStart", async ({ combat, sideId }: SideTurnPayload = {}) => {
        if (!isPrimaryGMClient()) return;
        await recoverLegendaryActionsForSide(combat ?? null, sideId ?? null);
    });
    hooks()?.on("dnd5e.combatRecovery", (combatant: CombatantLike, periods: unknown, results: CombatRecoveryResults) => {
        suppressEndOfTurnLegendaryRecovery(combatant, periods, results);
    });
}

