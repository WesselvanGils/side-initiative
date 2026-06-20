import { getCombatantsForSide } from "../logic.js";
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
 * creature's turns, so this resets `legact` for every combatant on the side at
 * `sideTurnStart`. dnd5e's native end-of-turn reset is left in place — it
 * becomes a harmless no-op because the value is already at `max`.
 *
 * This is a general side-initiative correctness fix; it is NOT gated on the
 * Legendary Action Windows setting.
 */

interface LegactResource {
    value?: unknown;
    max?: unknown;
}

function resolveActor(combatant: CombatantLike | null | undefined): ActorLike | null {
    return combatant?.actor ?? combatant?.document?.actor ?? combatant?.token?.actor ?? null;
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
            await actor?.update?.({ "system.resources.legact.value": legact.max });
        } catch (error) {
            console.warn("side-initiative | Failed to recover legendary actions for", actor?.name, error);
        }
    }
}

/**
 * Register dnd5e-system side-initiative fixes. Currently: recover legendary
 * actions for the whole side at the start of its turn.
 */
export function registerDnd5eIntegration(): void {
    hooks()?.on("side-initiative.sideTurnStart", async ({ combat, sideId }: SideTurnPayload = {}) => {
        if (!isPrimaryGMClient()) return;
        await recoverLegendaryActionsForSide(combat ?? null, sideId ?? null);
    });
}
