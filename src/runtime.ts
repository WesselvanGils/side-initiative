import type { SideInitiativeApi } from "./api.js";
import type { GambitsPremadesApi } from "./types/augmentations.js";
import type { UserLike } from "./types.js";

/**
 * Runtime accessors for Foundry globals whose fvtt-types shapes are awkward for
 * this module's defensive usage:
 *  - `game` is typed as a lifecycle-stage union, so module-added properties
 *    (`sideInitiative`, `gps`) are not visible on every stage.
 *  - `Users` has `activeGM` but the legacy `getActiveGM` helper is not typed.
 *  - Module-scoped `settings.get` is generically constrained to `"core"`.
 *
 * These helpers centralize the unavoidable casts instead of scattering them.
 */

interface UsersLike {
    activeGM?: UserLike;
    getActiveGM?(): UserLike | null;
    get?(id: string): UserLike | null | undefined;
    contents?: UserLike[];
}

export function getUsers(): UsersLike | null {
    return (game?.users ?? null) as UsersLike | null;
}

export function getActiveGMUser(): UserLike | null {
    const users = getUsers();
    return users?.activeGM ?? users?.getActiveGM?.() ?? Array.from(users?.contents ?? []).find((user) => user?.isGM && user?.active) ?? null;
}

export function isActiveGMClient(): boolean {
    const activeGM = getActiveGMUser();
    if (activeGM) return activeGM.id === game?.user?.id;
    return Boolean(game?.user?.isGM);
}

export function getPrimaryGMId(): string | null {
    return getGps()?.getPrimaryGM?.() ?? getActiveGMUser()?.id ?? game?.user?.id ?? null;
}

export function isPrimaryGMClient(): boolean {
    const primaryGMId = getPrimaryGMId();
    if (primaryGMId) return game?.user?.id === primaryGMId;
    return isActiveGMClient();
}

export function getSideInitiative(): SideInitiativeApi | undefined {
    return (game as ({ sideInitiative?: SideInitiativeApi } | null))?.sideInitiative;
}

export function setSideInitiative(api: SideInitiativeApi): void {
    const g = game as { sideInitiative?: SideInitiativeApi } | null;
    if (g) g.sideInitiative = api;
}

export function getGps(): GambitsPremadesApi | undefined {
    return (game as ({ gps?: GambitsPremadesApi } | null))?.gps;
}

export function getSetting(scope: string, key: string): unknown {
    return (game?.settings as { get?: (scope: string, key: string) => unknown } | null | undefined)?.get?.(scope, key);
}

/**
 * Loose view of the global `Hooks`. fvtt-types constrains `Hooks.on`/`callAll`
 * to `keyof HookConfig`, which rejects module/third-party events like
 * `side-initiative.sideTurnStart` or `midi-qol.preSetReactionUsed`. The wrappers
 * below target the same live `Hooks` instance (so registrations are still
 * observed by Foundry and by the test harness) with permissive signatures.
 */
interface LooseHooks {
    on(name: string, fn: (...args: any[]) => unknown, options?: unknown): number;
    once(name: string, fn: (...args: any[]) => unknown): number;
    callAll(name: string, ...args: unknown[]): void;
}

/**
 * Defensive view of the global `Hooks`. Read via `globalThis` so it is
 * `undefined` (rather than throwing) when the hook bus is not present — the
 * module's emit paths no-op in that case, matching the original behavior.
 */
export function hooks(): LooseHooks | undefined {
    return (globalThis as unknown as { Hooks?: LooseHooks }).Hooks;
}

/**
 * Defensive accessors for other Foundry globals that the original code read via
 * `globalThis.X?.` so they degrade gracefully in environments (and tests) where
 * they are not present.
 */
export function getFoundry(): typeof foundry | undefined {
    return (globalThis as unknown as { foundry?: typeof foundry }).foundry;
}

export function getConst(): typeof CONST | undefined {
    return (globalThis as unknown as { CONST?: typeof CONST }).CONST;
}
