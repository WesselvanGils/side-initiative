import test from "node:test";
import assert from "node:assert/strict";
import {
    buildFoundryReleasePayload,
    buildPayloadFromManifest,
    buildReleaseUrls,
    classifyFoundryResponse,
    isAlreadyReleasedError,
    publishToFoundry,
    readCompatibility,
} from "../tools/publish-foundry.js";

const STAGED_MANIFEST = {
    id: "side-initiative",
    version: "1.2.3",
    manifest: "https://github.com/WesselvanGils/side-initiative/releases/latest/download/module.json",
    compatibility: { minimum: "13", verified: "13" },
};

test("buildReleaseUrls points the manifest at the specific release tag, not latest", () => {
    const urls = buildReleaseUrls({
        repositoryBaseUrl: "https://github.com/WesselvanGils/side-initiative",
        tagName: "v1.2.3",
    });
    assert.equal(
        urls.manifest,
        "https://github.com/WesselvanGils/side-initiative/releases/download/v1.2.3/module.json",
    );
    assert.equal(urls.notes, "https://github.com/WesselvanGils/side-initiative/releases/tag/v1.2.3");
});

test("readCompatibility normalizes a missing maximum to an empty string", () => {
    assert.deepEqual(readCompatibility({ minimum: "13", verified: "13" }), {
        minimum: "13",
        verified: "13",
        maximum: "",
    });
    assert.deepEqual(readCompatibility(undefined), { minimum: "", verified: "", maximum: "" });
    assert.deepEqual(readCompatibility({ minimum: 12, verified: 13, maximum: 14 }), {
        minimum: "12",
        verified: "13",
        maximum: "14",
    });
});

test("buildFoundryReleasePayload assembles the API body and omits dry-run by default", () => {
    const payload = buildFoundryReleasePayload({
        id: "side-initiative",
        version: "1.2.3",
        manifest: "https://example.com/module.json",
        notes: "https://example.com/notes",
        compatibility: { minimum: "13", verified: "13", maximum: "" },
    });
    assert.deepEqual(payload, {
        id: "side-initiative",
        release: {
            version: "1.2.3",
            manifest: "https://example.com/module.json",
            notes: "https://example.com/notes",
            compatibility: { minimum: "13", verified: "13", maximum: "" },
        },
    });
});

test("buildFoundryReleasePayload adds dry-run when requested", () => {
    const payload = buildFoundryReleasePayload({
        id: "side-initiative",
        version: "1.2.3",
        manifest: "https://example.com/module.json",
        notes: "https://example.com/notes",
        compatibility: { minimum: "13", verified: "13", maximum: "" },
        dryRun: true,
    });
    assert.equal(payload["dry-run"], true);
});

test("buildPayloadFromManifest derives version and URLs from the staged manifest + tag", () => {
    const payload = buildPayloadFromManifest(STAGED_MANIFEST, "v1.2.3");
    assert.deepEqual(payload, {
        id: "side-initiative",
        release: {
            version: "1.2.3",
            manifest: "https://github.com/WesselvanGils/side-initiative/releases/download/v1.2.3/module.json",
            notes: "https://github.com/WesselvanGils/side-initiative/releases/tag/v1.2.3",
            compatibility: { minimum: "13", verified: "13", maximum: "" },
        },
    });
});

test("buildPayloadFromManifest rejects a manifest with the wrong id", () => {
    assert.throws(
        () => buildPayloadFromManifest({ ...STAGED_MANIFEST, id: "other" }, "v1.2.3"),
        /Expected staged manifest id/,
    );
});

test("isAlreadyReleasedError detects the unique_together error", () => {
    assert.equal(
        isAlreadyReleasedError({
            status: "error",
            errors: {
                __all__: [
                    {
                        message: "Package Version with this Package and Version Number already exists.",
                        code: "unique_together",
                    },
                ],
            },
        }),
        true,
    );
});

test("isAlreadyReleasedError tolerates a plain already-exists message", () => {
    assert.equal(isAlreadyReleasedError("Package Version already exists."), true);
});

test("isAlreadyReleasedError is false for unrelated validation errors", () => {
    assert.equal(
        isAlreadyReleasedError({
            status: "error",
            errors: { manifest: [{ message: "Enter a valid URL.", code: "invalid" }] },
        }),
        false,
    );
});

test("classifyFoundryResponse maps status codes to outcomes", () => {
    assert.equal(classifyFoundryResponse({ status: 200, body: { status: "success" } }), "success");
    assert.equal(classifyFoundryResponse({ status: 429, body: null }), "rate-limited");
    assert.equal(
        classifyFoundryResponse({
            status: 400,
            body: { errors: { __all__: [{ code: "unique_together" }] } },
        }),
        "already-released",
    );
    assert.equal(
        classifyFoundryResponse({ status: 400, body: { errors: { manifest: [{ code: "invalid" }] } } }),
        "error",
    );
    assert.equal(classifyFoundryResponse({ status: 401, body: null }), "error");
});

/** Build a fake response (and a fetch that returns a scripted sequence of them). */
function mockResponses(responses: Array<{ status: number; body: unknown; retryAfter?: string | null }>) {
    let index = 0;
    const calls: Array<{ input: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> =
        [];
    const fetchImpl = async (
        input: string,
        init?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
        calls.push({ input, init });
        const response = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return {
            status: response.status,
            headers: {
                get: (name: string) => (name.toLowerCase() === "retry-after" ? (response.retryAfter ?? null) : null),
            },
            json: async () => response.body,
        };
    };
    return { fetchImpl, calls };
}

test("publishToFoundry returns success on HTTP 200", async () => {
    const { fetchImpl, calls } = mockResponses([{ status: 200, body: { status: "success" } }]);
    const result = await publishToFoundry({
        token: "fvttp_test",
        payload: { id: "side-initiative" },
        fetchImpl,
        sleep: async () => {},
    });
    assert.equal(result.outcome, "success");
    assert.equal(result.attempts, 1);
    assert.equal(calls[0]?.init?.headers?.Authorization, "fvttp_test");
    assert.equal(calls[0]?.init?.method, "POST");
});

test("publishToFoundry treats an already-released version as success without retry", async () => {
    const { fetchImpl } = mockResponses([
        { status: 400, body: { errors: { __all__: [{ code: "unique_together" }] } } },
    ]);
    const result = await publishToFoundry({
        token: "fvttp_test",
        payload: { id: "side-initiative" },
        fetchImpl,
        sleep: async () => {},
    });
    assert.equal(result.outcome, "already-released");
    assert.equal(result.attempts, 1);
});

test("publishToFoundry retries on 429 honouring Retry-After, then succeeds", async () => {
    const slept: number[] = [];
    const { fetchImpl } = mockResponses([
        { status: 429, body: null, retryAfter: "3" },
        { status: 200, body: { status: "success" } },
    ]);
    const result = await publishToFoundry({
        token: "fvttp_test",
        payload: { id: "side-initiative" },
        fetchImpl,
        sleep: async (seconds) => {
            slept.push(seconds);
        },
    });
    assert.equal(result.outcome, "success");
    assert.equal(result.attempts, 2);
    assert.deepEqual(slept, [3]);
});

test("publishToFoundry gives up after maxAttempts of 429s and throws", async () => {
    const { fetchImpl } = mockResponses([{ status: 429, body: null, retryAfter: "1" }]);
    await assert.rejects(
        publishToFoundry({
            token: "fvttp_test",
            payload: { id: "side-initiative" },
            fetchImpl,
            maxAttempts: 2,
            sleep: async () => {},
        }),
        /HTTP 429/,
    );
});

test("publishToFoundry throws immediately on a hard validation error", async () => {
    const { fetchImpl } = mockResponses([
        { status: 400, body: { errors: { manifest: [{ message: "Enter a valid URL.", code: "invalid" }] } } },
    ]);
    await assert.rejects(
        publishToFoundry({ token: "fvttp_test", payload: { id: "side-initiative" }, fetchImpl, sleep: async () => {} }),
        /HTTP 400/,
    );
});
