#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ID = "side-initiative";
const RELEASE_ROOT = join("dist", "release");
const RELEASE_ENTRIES = [
    "module.json",
    "README.md",
    "LICENSE",
    "scripts",
    "styles",
    "lang"
];

interface NormalizedTag {
    tagName: string;
    version: string;
}

interface ReleaseManifestOptions {
    tagName: string;
    version: string;
    repositoryBaseUrl: string;
}

function normalizeReleaseTag(tag: string): NormalizedTag {
    const rawTag = String(tag ?? "").trim();
    if (!rawTag) {
        throw new Error("A release tag is required.");
    }

    const tagName = rawTag.startsWith("v") ? rawTag : `v${rawTag}`;
    const version = tagName.slice(1);
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`Unsupported release tag "${rawTag}". Expected vX.Y.Z.`);
    }

    return { tagName, version };
}

function getRepositoryBaseUrl(manifestUrl: string): string {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/module\.json$/.exec(String(manifestUrl ?? ""));
    if (!match) {
        throw new Error("module.json manifest must point to the GitHub latest download URL.");
    }

    return `https://github.com/${match[1]}`;
}

function buildReleaseManifest(sourceManifest: Record<string, unknown>, { tagName, version, repositoryBaseUrl }: ReleaseManifestOptions): Record<string, unknown> {
    return {
        ...sourceManifest,
        version,
        download: `${repositoryBaseUrl}/releases/download/${tagName}/${MODULE_ID}-${tagName}.zip`
    };
}

function extractChangelogSection(lines: string[], headingPrefix: string): string | null {
    const startIndex = lines.findIndex((line) => line.startsWith(headingPrefix));
    if (startIndex === -1) return null;

    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        if (lines[index].startsWith("## [")) {
            endIndex = index;
            break;
        }
    }

    return lines.slice(startIndex, endIndex).join("\n").trim();
}

function extractChangelogReleaseNotes(changelogText: string, version: string): string {
    const lines = String(changelogText ?? "").split(/\r?\n/);
    const releaseSection = extractChangelogSection(lines, `## [${version}]`);

    if (releaseSection) {
        return `${releaseSection}\n`;
    }

    const unreleasedSection = extractChangelogSection(lines, "## [unreleased]");
    if (unreleasedSection) {
        const releaseNotes = unreleasedSection.replace(/^## \[unreleased\].*$/m, `## [${version}]`);
        return `${releaseNotes.trim()}\n`;
    }

    return `## [${version}]\n\nNo changelog entry was found for this release.\n`;
}

interface StageResult {
    releaseRoot: string;
    zipPath: string;
    manifestPath: string;
    releaseNotesPath: string;
    tagName: string;
    version: string;
    repositoryBaseUrl: string;
}

async function stageReleaseBundle({ rootDir, outDir, tag }: { rootDir: string; outDir: string; tag: string }): Promise<StageResult> {
    const { tagName, version } = normalizeReleaseTag(tag);
    const sourceManifestPath = join(rootDir, "module.json");
    const changelogPath = join(rootDir, "CHANGELOG.md");
    const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf-8")) as Record<string, unknown> & { id?: string; manifest?: string };
    const changelog = await readFile(changelogPath, "utf-8");

    if (sourceManifest.id !== MODULE_ID) {
        throw new Error(`Expected module.json id to be "${MODULE_ID}".`);
    }

    const repositoryBaseUrl = getRepositoryBaseUrl(String(sourceManifest.manifest ?? ""));
    const releaseManifest = buildReleaseManifest(sourceManifest, { tagName, version, repositoryBaseUrl });
    const releaseRoot = join(outDir, MODULE_ID);
    const zipPath = join(outDir, `${MODULE_ID}-${tagName}.zip`);

    await rm(outDir, { recursive: true, force: true });
    await mkdir(releaseRoot, { recursive: true });

    const entries: string[] = [];
    for (const entry of RELEASE_ENTRIES) {
        try {
            await access(join(rootDir, entry), fsConstants.F_OK);
            entries.push(entry);
        } catch {
            continue;
        }
    }

    for (const entry of entries) {
        await cp(join(rootDir, entry), join(releaseRoot, entry), { recursive: true });
    }

    await writeFile(join(releaseRoot, "module.json"), `${JSON.stringify(releaseManifest, null, 4)}\n`);
    await writeFile(join(outDir, "release-notes.md"), extractChangelogReleaseNotes(changelog, version));

    const zip = spawnSync("zip", ["-qr", zipPath, MODULE_ID], {
        cwd: outDir,
        stdio: "inherit"
    });

    if (zip.status !== 0) {
        throw new Error(`zip failed with exit code ${zip.status ?? "unknown"}.`);
    }

    return {
        releaseRoot,
        zipPath,
        manifestPath: join(releaseRoot, "module.json"),
        releaseNotesPath: join(outDir, "release-notes.md"),
        tagName,
        version,
        repositoryBaseUrl
    };
}

async function main(): Promise<void> {
    const rootDir = resolve(process.cwd());
    const outDir = join(rootDir, RELEASE_ROOT);
    const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
    if (!tag) {
        throw new Error("A release tag is required (pass it as the first argument or via GITHUB_REF_NAME).");
    }
    const result = await stageReleaseBundle({ rootDir, outDir, tag });

    console.log(`Release manifest: ${result.manifestPath}`);
    console.log(`Release zip: ${result.zipPath}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}

export {
    buildReleaseManifest,
    extractChangelogReleaseNotes,
    getRepositoryBaseUrl,
    normalizeReleaseTag,
    stageReleaseBundle
};
