/**
 * Subset of the Gambits Premades (`game.gps`) runtime API that Side Initiative
 * integrates with. The full API is far larger and untyped; only the surface
 * used by this module is described here.
 */
export interface GambitsPremadesApi {
    getPrimaryGM?(): string | null;
    getBrowserUser?(input: Record<string, unknown>): string | null;
    opportunityAttackScenarios?(payload: Record<string, unknown>): Promise<unknown>;
    [key: string]: unknown;
}
