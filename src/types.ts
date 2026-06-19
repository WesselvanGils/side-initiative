/**
 * Side Initiative type definitions.
 *
 * `SideData` and `CombatState` are the module's own persisted data shapes and
 * are fully typed. The `*Like` interfaces describe the structural subsets of
 * Foundry documents (Combatant, Actor, Token, Combat, Workflow) that the pure
 * logic layer depends on. They are intentionally loose: the defensive runtime
 * code accepts partial objects (including the lightweight mocks used by the test
 * suite), and real Foundry documents satisfy them structurally. Deeply nested,
 * system-specific trees (dnd5e `system.*`, token `object`/`document` chains) are
 * typed as `unknown`/`any` because they are accessed dynamically on purpose.
 */

/**
 * A persisted or summarized side record.
 */
export interface SideData {
    id: string;
    name: string;
    color: string;
    roll?: number | null;
    combatantIds?: string[];
    count?: number;
    active?: boolean;
    commanderId?: string | null;
    tone?: string;
}

/**
 * The side-initiative combat state persisted on the combat document flag.
 */
export interface CombatState {
    version: number;
    order: string[];
    sides: Record<string, SideData>;
    lastRolledRound: number | null;
    lastRolls: Record<string, number>;
    activeSideId: string | null;
    activeSideIndex: number | null;
    activeCombatantId: string | null;
    commanderIds: Record<string, string>;
}

/** A document that exposes Foundry flag accessors. */
export interface Flaggable {
    getFlag?(scope: string, key: string): unknown;
    setFlag?(scope: string, key: string, value: unknown): Promise<unknown>;
    unsetFlag?(scope: string, key: string): Promise<unknown>;
}

/** Result of grouping items by a derived key. */
export type GroupMap<T> = Map<string | number | symbol, T[]>;

/**
 * Structural subset of a Foundry {@link Actor} as used by the logic layer.
 */
export interface ActorLike extends Flaggable {
    id?: string;
    uuid?: string;
    name?: string;
    type?: string;
    hasPlayerOwner?: boolean;
    combatant?: CombatantLike | null;
    prototypeToken?: Record<string, any> & { disposition?: number; combatant?: CombatantLike | null };
    token?: Record<string, any> & { combatant?: CombatantLike | null };
    /** dnd5e system data is accessed dynamically (xp weighting, etc.). */
    system?: Record<string, any>;
    getActiveTokens?(): Array<{ combatant?: CombatantLike | null } | null | undefined>;
    effects?: { get?(id: string): { delete?(): Promise<unknown> | unknown } | null | undefined; [key: string]: any };
    update?(data: Record<string, unknown>): Promise<unknown>;
}

/**
 * Structural subset of a Foundry {@link TokenDocument} / token placeable.
 */
export interface TokenLike {
    id?: string;
    uuid?: string;
    disposition?: number;
    combatant?: CombatantLike | null;
    actor?: ActorLike | null;
    document?: TokenLike & { actor?: ActorLike | null; combatant?: CombatantLike | null; disposition?: number };
    object?: { id?: string; document?: TokenLike };
    regions?: Set<unknown>;
    testInsideRegion?(region: unknown): boolean;
}

/**
 * Structural subset of a Foundry {@link Combatant}.
 */
export interface CombatantLike extends Flaggable {
    id?: string;
    name?: string;
    hasPlayerOwner?: boolean;
    defeated?: boolean;
    disposition?: number;
    initiative?: number;
    isOwner?: boolean;
    actor?: ActorLike | null;
    token?: TokenLike | null;
    tokenDocument?: TokenLike | null;
    document?: Record<string, any> & { actor?: ActorLike | null; token?: TokenLike | null; disposition?: number };
    group?: { members: Set<CombatantLike> | CombatantLike[] } | null;
    testUserPermission?(user: unknown, permission: string): boolean;
    getInitiativeRoll?(): unknown;
    update?(data: Record<string, unknown>): Promise<unknown>;
}

/**
 * A collection of combatants as exposed by Foundry combat documents. Foundry
 * uses an embedded collection (`.contents`, iterable, `.get`, `.values`); tests
 * use plain arrays or {@link Map} instances.
 */
export interface CombatantsCollection {
    get?(id: string): CombatantLike | null | undefined;
    contents?: CombatantLike[];
    values?(): IterableIterator<CombatantLike> | CombatantLike[];
    size?: number;
    [Symbol.iterator]?(): IterableIterator<CombatantLike>;
}

/**
 * Anything the combatant-resolution helpers can pull combatants from: a combat
 * document, an embedded collection, a plain array, or a {@link Map}.
 */
export type CombatantSource =
    | CombatLike
    | CombatantsCollection
    | CombatantLike[]
    | Map<string, CombatantLike>
    | null
    | undefined;

/**
 * Structural subset of a Foundry {@link Combat} document.
 */
export interface CombatLike extends Flaggable {
    id?: string;
    round?: number;
    turn?: number;
    started?: boolean;
    combatant?: CombatantLike | null;
    current?: Record<string, any> & { tokenId?: string | null };
    combatants?: CombatantsCollection | CombatantLike[] | Map<string, CombatantLike>;
    turns?: CombatantsCollection | CombatantLike[] | Map<string, CombatantLike>;
    groups?: Record<string, any> & { get?(id: string): { members: Set<CombatantLike> | CombatantLike[] } | null };
    update?(data: Record<string, unknown>): Promise<unknown>;
    updateEmbeddedDocuments?(type: string, docs: unknown[]): Promise<unknown>;
    rollAll?(options?: Record<string, unknown>): Promise<unknown>;
    rollInitiative?(ids: string[], options?: Record<string, unknown>): Promise<unknown>;
    nextTurn?(): Promise<unknown>;
    previousTurn?(): Promise<unknown>;
    nextRound?(): Promise<unknown>;
}

/**
 * Structural subset of a MidiQOL workflow object.
 */
export interface WorkflowLike {
    token?: TokenLike | null;
    tokenDocument?: TokenLike | null;
    speaker?: Record<string, any> & { token?: TokenLike | null };
    actor?: ActorLike | null;
}

/** Side-turn lifecycle hook payload. */
export interface SideTurnPayload {
    combat?: CombatLike | null;
    sideId?: string | null;
    nextSideId?: string | null;
    previousSideId?: string | null;
}

/** Options accepted by side grouping helpers. */
export interface SideGroupOptions {
    groupByDisposition?: boolean;
}

/** Options accepted by side filtering helpers. */
export interface SideFilterOptions extends SideGroupOptions {
    includeDefeated?: boolean;
}

/** Result of a side initiative roll. */
export interface SideRollResult {
    rolls: Array<SideData & { roll: number; tieBreaker: number }>;
    order: string[];
    fallbackUsed: boolean;
}

/** A function that produces a pseudo-random number in [0, 1). */
export type RandomFn = () => number;

/** Structural subset of a Foundry {@link User}. */
export interface UserLike {
    id?: string;
    isGM?: boolean;
    active?: boolean;
    color?: string;
}
