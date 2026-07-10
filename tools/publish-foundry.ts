#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getRepositoryBaseUrl, normalizeReleaseTag } from "./build-release.js";

/**
 * Foundry VTT Package Release API.
 * @see https://foundryvtt.com/article/package-release-api/
 */
const FOUNDRY_RELEASE_ENDPOINT = "https://foundryvtt.com/_api/packages/release_version/";

const MODULE_ID = "side-initiative";
const STAGED_MANIFEST = join("dist", "release", MODULE_ID, "module.json");

/** The release token, including the leading `fvttp_`. Read from the environment. */
const TOKEN_ENV = "FOUNDRY_RELEASE_TOKEN";
/** Set to "true" to validate the request without saving (no public release is created). */
const DRY_RUN_ENV = "FOUNDRY_DRY_RUN";

interface FoundryCompatibility {
    minimum: string;
    verified: string;
    maximum: string;
}

interface ReleaseUrls {
    manifest: string;
    notes: string;
}

interface FoundryReleasePayloadOptions {
    id: string;
    version: string;
    manifest: string;
    notes: string;
    compatibility: FoundryCompatibility;
    dryRun?: boolean;
}

/**
 * Build the per-version manifest/notes URLs. The Foundry `manifest` field must
 * point at a SPECIFIC release (not the `latest` manifest in module.json), and
 * `notes` at the release's tag page — both derived from the repo base + tag.
 */
function buildReleaseUrls({ repositoryBaseUrl, tagName }: { repositoryBaseUrl: string; tagName: string }): ReleaseUrls {
    return {
        manifest: `${repositoryBaseUrl}/releases/download/${tagName}/module.json`,
        notes: `${repositoryBaseUrl}/releases/tag/${tagName}`,
    };
}

/**
 * Coerce a manifest's `compatibility` block into the Foundry payload shape:
 * `maximum` is optional in module.json but required (may be empty) by the API.
 */
function readCompatibility(compatibility: unknown): FoundryCompatibility {
    const block = (compatibility ?? {}) as { minimum?: unknown; verified?: unknown; maximum?: unknown };
    const asString = (value: unknown): string => {
        const text = String(value ?? "").trim();
        return text === "" ? "" : text;
    };
    return {
        minimum: asString(block.minimum),
        verified: asString(block.verified),
        maximum: asString(block.maximum),
    };
}

/** Assemble the JSON body for the Foundry Package Release API. Pure. */
export function buildFoundryReleasePayload(options: FoundryReleasePayloadOptions): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        id: options.id,
        release: {
            version: options.version,
            manifest: options.manifest,
            notes: options.notes,
            compatibility: options.compatibility,
        },
    };
    if (options.dryRun) payload["dry-run"] = true;
    return payload;
}

export type FoundryOutcome = "success" | "already-released" | "rate-limited" | "error";

interface FoundryFieldError {
    message?: string;
    code?: string;
}

interface FoundryErrorBody {
    status?: string;
    errors?: Record<string, FoundryFieldError[] | undefined> & { __all__?: FoundryFieldError[] };
}

/**
 * The API returns a `400` with `errors.__all__[].code === "unique_together"`
 * when the package version already exists. The release pipeline runs on two CI
 * systems (self-hosted Gitea, then the public GitHub mirror); the second run
 * always hits this, so we treat it as an idempotent success rather than a
 * failure. Also tolerates older/variant "already exists" phrasings defensively.
 */
export function isAlreadyReleasedError(body: unknown): boolean {
    const errorBody = body as FoundryErrorBody | null;
    const allErrors = errorBody?.errors?.__all__ ?? [];
    if (allErrors.some((entry) => entry?.code === "unique_together")) return true;
    return JSON.stringify(body ?? "")
        .toLowerCase()
        .includes("already exists");
}

interface ClassifyInput {
    status: number;
    body: unknown;
}

/** Map an API response to a coarse outcome. Pure. */
export function classifyFoundryResponse({ status, body }: ClassifyInput): FoundryOutcome {
    if (status === 200) return "success";
    if (status === 429) return "rate-limited";
    if (status === 400 && isAlreadyReleasedError(body)) return "already-released";
    return "error";
}

export interface FoundryPublishError extends Error {
    status: number;
    body: unknown;
}

function makePublishError(status: number, body: unknown): FoundryPublishError {
    const error = new Error(`Foundry release API rejected the request (HTTP ${status}).`) as FoundryPublishError;
    error.name = "FoundryPublishError";
    error.status = status;
    error.body = body;
    return error;
}

type FetchLike = (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
    status: number;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
}>;

interface PublishOptions {
    token: string;
    payload: Record<string, unknown>;
    fetchImpl?: FetchLike;
    sleep?: (seconds: number) => Promise<void>;
    maxAttempts?: number;
    endpoint?: string;
}

interface PublishResult {
    outcome: FoundryOutcome;
    attempts: number;
}

/**
 * POST the payload to the Foundry release API, retrying on `429 Too Many
 * Requests` (honouring `Retry-After`) and treating an already-released version
 * as success. `fetchImpl`/`sleep` are injectable for deterministic tests.
 */
export async function publishToFoundry({
    token,
    payload,
    fetchImpl = fetch as FetchLike,
    sleep = defaultSleep,
    maxAttempts = 5,
    endpoint = FOUNDRY_RELEASE_ENDPOINT,
}: PublishOptions): Promise<PublishResult> {
    let attempt = 0;
    while (true) {
        attempt += 1;
        const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null);
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const outcome = classifyFoundryResponse({ status: response.status, body });

        if (outcome === "success" || outcome === "already-released") {
            return { outcome, attempts: attempt };
        }
        if (outcome === "rate-limited" && attempt < maxAttempts) {
            await sleep(retryAfter ?? 2 ** attempt);
            continue;
        }
        throw makePublishError(response.status, body);
    }
}

async function defaultSleep(seconds: number): Promise<void> {
    await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, Math.max(0, seconds) * 1000);
    });
}

function parseRetryAfter(header: string | null | undefined): number | null {
    if (!header) return null;
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

interface StagedManifest {
    id?: string;
    version?: string;
    manifest?: string;
    compatibility?: unknown;
}

/** Build the payload from the staged release manifest + tag. Pure (no I/O). */
export function buildPayloadFromManifest(
    manifest: StagedManifest,
    tag: string,
    options: { dryRun?: boolean } = {},
): Record<string, unknown> {
    const { tagName, version } = normalizeReleaseTag(tag);
    if (manifest.id !== MODULE_ID) {
        throw new Error(`Expected staged manifest id to be "${MODULE_ID}", got "${manifest.id ?? ""}".`);
    }
    const repositoryBaseUrl = getRepositoryBaseUrl(String(manifest.manifest ?? ""));
    const { manifest: manifestUrl, notes } = buildReleaseUrls({ repositoryBaseUrl, tagName });
    return buildFoundryReleasePayload({
        id: MODULE_ID,
        version,
        manifest: manifestUrl,
        notes,
        compatibility: readCompatibility(manifest.compatibility),
        dryRun: options.dryRun,
    });
}

async function main(): Promise<void> {
    const rootDir = resolve(process.cwd());
    const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
    const token = process.env[TOKEN_ENV];
    const dryRun = process.env[DRY_RUN_ENV] === "true";

    if (!tag) {
        throw new Error("A release tag is required (pass it as the first argument or via GITHUB_REF_NAME).");
    }
    if (!token) {
        throw new Error(
            `${TOKEN_ENV} is not set. Copy the "Package Release Token" from the package page on foundryvtt.com and add it as a CI secret.`,
        );
    }

    const manifestPath = join(rootDir, STAGED_MANIFEST);
    let manifest: StagedManifest;
    try {
        manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as StagedManifest;
    } catch {
        throw new Error(
            `Could not read the staged release manifest at ${manifestPath}. Run "npm run release:build -- ${tag}" first.`,
        );
    }
    const payload = buildPayloadFromManifest(manifest, tag, { dryRun });

    const { version } = normalizeReleaseTag(tag);
    console.log(`Publishing ${MODULE_ID} v${version} to the Foundry package registry${dryRun ? " (dry-run)" : ""}...`);

    const result = await publishToFoundry({ token, payload });
    if (result.outcome === "already-released") {
        console.log(
            `Version ${version} is already published (the other CI instance released it first). Nothing to do.`,
        );
    } else {
        console.log(`Published ${MODULE_ID} v${version} to the Foundry package registry.`);
    }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}

export { buildReleaseUrls, readCompatibility };
