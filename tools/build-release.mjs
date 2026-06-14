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

function normalizeReleaseTag(tag) {
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

function getRepositoryBaseUrl(manifestUrl) {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/module\.json$/.exec(String(manifestUrl ?? ""));
    if (!match) {
        throw new Error("module.json manifest must point to the GitHub latest download URL.");
    }

    return `https://github.com/${match[1]}`;
}

function buildReleaseManifest(sourceManifest, { tagName, version, repositoryBaseUrl }) {
    return {
        ...sourceManifest,
        version,
        download: `${repositoryBaseUrl}/releases/download/${tagName}/${MODULE_ID}-${tagName}.zip`
    };
}

function extractChangelogReleaseNotes(changelogText, version) {
    const lines = String(changelogText ?? "").split(/\r?\n/);
    const headingPrefix = `## [${version}]`;
    const startIndex = lines.findIndex((line) => line.startsWith(headingPrefix));

    if (startIndex === -1) {
        throw new Error(`Could not find changelog section for version ${version}.`);
    }

    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        if (lines[index].startsWith("## [")) {
            endIndex = index;
            break;
        }
    }

    const section = lines.slice(startIndex, endIndex).join("\n").trim();
    if (!section) {
        throw new Error(`Changelog section for version ${version} was empty.`);
    }

    return `${section}\n`;
}

async function stageReleaseBundle({ rootDir, outDir, tag }) {
    const { tagName, version } = normalizeReleaseTag(tag);
    const sourceManifestPath = join(rootDir, "module.json");
    const changelogPath = join(rootDir, "CHANGELOG.md");
    const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf-8"));
    const changelog = await readFile(changelogPath, "utf-8");

    if (sourceManifest.id !== MODULE_ID) {
        throw new Error(`Expected module.json id to be "${MODULE_ID}".`);
    }

    const repositoryBaseUrl = getRepositoryBaseUrl(sourceManifest.manifest);
    const releaseManifest = buildReleaseManifest(sourceManifest, { tagName, version, repositoryBaseUrl });
    const releaseRoot = join(outDir, MODULE_ID);
    const zipPath = join(outDir, `${MODULE_ID}-${tagName}.zip`);

    await rm(outDir, { recursive: true, force: true });
    await mkdir(releaseRoot, { recursive: true });

    const entries = [];
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

async function main() {
    const rootDir = resolve(process.cwd());
    const outDir = join(rootDir, RELEASE_ROOT);
    const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
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
