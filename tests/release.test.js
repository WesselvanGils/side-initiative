import test from "node:test";
import assert from "node:assert/strict";
import {
    buildReleaseManifest,
    extractChangelogReleaseNotes,
    getRepositoryBaseUrl,
    normalizeReleaseTag
} from "../tools/build-release.mjs";

test("normalizeReleaseTag strips a leading v from the tag", () => {
    assert.deepEqual(normalizeReleaseTag("v1.2.3"), {
        tagName: "v1.2.3",
        version: "1.2.3"
    });
});

test("getRepositoryBaseUrl derives the GitHub repo from the manifest URL", () => {
    assert.equal(
        getRepositoryBaseUrl("https://github.com/WesselvanGils/side-initiative/releases/latest/download/module.json"),
        "https://github.com/WesselvanGils/side-initiative"
    );
});

test("buildReleaseManifest patches version and download url", () => {
    const manifest = {
        id: "side-initiative",
        manifest: "https://github.com/WesselvanGils/side-initiative/releases/latest/download/module.json",
        download: "https://github.com/WesselvanGils/side-initiative/releases/download/v1.0.2/side-initiative-v1.0.2.zip",
        version: "1.0.2"
    };

    assert.deepEqual(
        buildReleaseManifest(manifest, {
            tagName: "v1.2.3",
            version: "1.2.3",
            repositoryBaseUrl: "https://github.com/WesselvanGils/side-initiative"
        }),
        {
            ...manifest,
            version: "1.2.3",
            download: "https://github.com/WesselvanGils/side-initiative/releases/download/v1.2.3/side-initiative-v1.2.3.zip"
        }
    );
});

test("extractChangelogReleaseNotes returns the matching changelog section", () => {
    const changelog = `
## [unreleased]

### 🐛 Bug Fixes

- Resolved an issue where the package download link would be incorrect

## [1.0.1] - 2026-06-14

### 🚀 Features

- Added automatic tags with changelog via just

### 🐛 Bug Fixes

- Updated module.json with release url

## [1.0.0] - 2026-06-14

### 🚀 Features

- Added weighted initiative as an optional rule
`.trim();

    const notes = extractChangelogReleaseNotes(changelog, "1.0.1");
    assert.match(notes, /^## \[1\.0\.1\] - 2026-06-14/m);
    assert.match(notes, /Added automatic tags with changelog via just/);
    assert.doesNotMatch(notes, /1\.0\.0/);
});

test("extractChangelogReleaseNotes falls back to unreleased notes", () => {
    const changelog = `
## [unreleased]

### 🐛 Bug Fixes

- Added manual run to Github action

## [1.0.3] - 2026-06-14

### 🚀 Features

- Proper automatic releases through Github actions
`.trim();

    const notes = extractChangelogReleaseNotes(changelog, "1.0.5");
    assert.match(notes, /^## \[1\.0\.5\]$/m);
    assert.match(notes, /Added manual run to Github action/);
    assert.doesNotMatch(notes, /unreleased/);
    assert.doesNotMatch(notes, /1\.0\.3/);
});

test("extractChangelogReleaseNotes creates minimal notes when no section exists", () => {
    const notes = extractChangelogReleaseNotes("", "1.0.5");
    assert.equal(notes, "## [1.0.5]\n\nNo changelog entry was found for this release.\n");
});
