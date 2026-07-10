import { getCombatantsForSide, isSideCombat } from "../logic.js";
import { hooks, isPrimaryGMClient } from "../runtime.js";
import type { ActorLike, CombatLike, CombatantLike, SideTurnPayload } from "../types.js";

/**
 * dnd5e-system compatibility for side initiative.
 *
 * Legendary actions (`system.resources.legact`) are recovered by dnd5e at the
 * END of a creature's turn — `NpcData5e.recoverCombatUses` resets `legact.value`
 * to `max` for the period `"turnEnd"`, and that period is only attached to the
 * single combatant whose turn is ending (`Combat5e._onEndTurn`). In side
 * initiative only the side representative is ever "current", so recovery lands
 * at the END of the side's turn (with a chat card) and every other legendary
 * creature on the side never recovers at all.
 *
 * The rules state legendary actions are regained at the START of each of the
 * creature's turns, so for side combats this module:
 *   - fully suppresses dnd5e's native END-of-turn recovery (via
 *     `dnd5e.preCombatRecovery`, which blocks the reset AND the chat card), and
 *   - at `sideTurnStart` runs dnd5e's own `recoverCombatUses(["turnEnd"])` for
 *     every legendary creature on the side that has actions to recover, which
 *     resets `legact` and posts the same chat card — just at the start.
 *
 * The two pieces share one `recoverCombatUses` code path, so a reentrancy guard
 * (`sideTurnRecoveryInProgress`) marks our own start-of-turn calls so the
 * suppression hook does not block them.
 *
 * This is a general side-initiative correctness fix; it is NOT gated on the
 * Legendary Action Windows setting.
 */

interface LegactResource {
    value?: unknown;
    max?: unknown;
}

/** Reentrancy guard: true while we are driving recovery from `sideTurnStart`. */
let sideTurnRecoveryInProgress = false;

function resolveActor(combatant: CombatantLike | null | undefined): ActorLike | null {
    return combatant?.actor ?? combatant?.document?.actor ?? combatant?.token?.actor ?? null;
}

function resolveCombat(combatant: CombatantLike | null | undefined): CombatLike | null {
    const c = combatant as (CombatantLike & { combat?: CombatLike; parent?: CombatLike }) | null | undefined;
    return c?.combat ?? c?.parent ?? (game?.combat as CombatLike | null) ?? null;
}

function readLegact(actor: ActorLike | null | undefined): { value: number; max: number } | null {
    const legact = (actor as { system?: { resources?: { legact?: LegactResource } } })?.system?.resources?.legact;
    if (!legact) return null;
    const max = Number(legact.max);
    if (!Number.isFinite(max) || max <= 0) return null;
    const value = Number(legact.value);
    return { value: Number.isFinite(value) ? value : max, max };
}

/**
 * Legendary creatures on the side that still have actions to recover
 * (`legact.value < max`). Pure, for testing.
 */
export function getLegendaryCombatantsToRecover(
    combat: CombatLike | null | undefined,
    sideId: string | null | undefined,
): CombatantLike[] {
    if (!combat?.started || !sideId) return [];
    return getCombatantsForSide(combat, sideId, { includeDefeated: false }).filter((combatant) => {
        const legact = readLegact(resolveActor(combatant));
        return Boolean(legact && legact.value < legact.max);
    });
}

/**
 * Whether to suppress dnd5e's native recovery for this combatant/period. We
 * block the native END-of-turn recovery for side combats (unless we are driving
 * the recovery ourselves via `sideTurnStart`). Pure, for testing.
 */
export function shouldSuppressNativeRecovery(
    combatant: CombatantLike | null | undefined,
    periods: unknown,
    guarded: boolean,
): boolean {
    if (guarded) return false;
    if (!Array.isArray(periods) || !periods.includes("turnEnd")) return false;
    return isSideCombat(resolveCombat(combatant));
}

async function recoverLegendaryActionsForSide(
    combat: CombatLike | null | undefined,
    sideId: string | null | undefined,
): Promise<void> {
    const combatants = getLegendaryCombatantsToRecover(combat, sideId);
    if (!combatants.length) return;

    sideTurnRecoveryInProgress = true;
    try {
        for (const combatant of combatants) {
            try {
                await (
                    combatant as CombatantLike & { recoverCombatUses?(periods: string[]): Promise<unknown> }
                ).recoverCombatUses?.(["turnEnd"]);
            } catch (error) {
                console.warn("side-initiative | Failed to recover legendary actions for", combatant?.name, error);
            }
        }
    } finally {
        sideTurnRecoveryInProgress = false;
    }
}

/**
 * Register dnd5e-system side-initiative fixes:
 *  - recover legendary actions for the whole side at the start of its turn
 *    (with dnd5e's own chat card);
 *  - suppress dnd5e's native end-of-turn recovery for side combats.
 */
export function registerDnd5eIntegration(): void {
    hooks()?.on("side-initiative.sideTurnStart", async ({ combat, sideId }: SideTurnPayload = {}) => {
        if (!isPrimaryGMClient()) return;
        await recoverLegendaryActionsForSide(combat ?? null, sideId ?? null);
    });
    hooks()?.on("dnd5e.preCombatRecovery", (combatant: CombatantLike, periods: unknown): boolean | void => {
        if (shouldSuppressNativeRecovery(combatant, periods, sideTurnRecoveryInProgress)) return false;
    });
}
