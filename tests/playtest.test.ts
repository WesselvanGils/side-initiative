import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { assertPlaytestPath, isPathInside, validateArchiveEntries } from "../tools/playtest.js";

test("playtest paths cannot escape the repository-local runtime", () => {
    const root = resolve(".playtest");

    assert.equal(isPathInside(root, resolve(".playtest/app")), true);
    assert.equal(isPathInside(root, resolve(".playtest")), true);
    assert.equal(isPathInside(root, resolve("other")), false);
    assert.throws(() => assertPlaytestPath(resolve("other")), /Refusing to modify a path outside/);
});

test("playtest archive validation rejects traversal and absolute entries", () => {
    assert.doesNotThrow(() => validateArchiveEntries(["main.js", "resources/app.js", "nested/"]));
    assert.throws(() => validateArchiveEntries(["../outside"]), /Unsafe path/);
    assert.throws(() => validateArchiveEntries(["safe/../../outside"]), /Unsafe path/);
    assert.throws(() => validateArchiveEntries(["/absolute/path"]), /Unsafe path/);
    assert.throws(() => validateArchiveEntries(["C:\\absolute\\path"]), /Unsafe path/);
});
