#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
    access,
    cp,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    readlink,
    rename,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const MODULE_ID = "side-initiative";
const FOUNDRY_VERSION = "14.367";
const DND5E_VERSION = "5.3.3";
const DND5E_MANIFEST_URL = `https://github.com/foundryvtt/dnd5e/releases/download/release-${DND5E_VERSION}/system.json`;
const DEFAULT_PORT = 30000;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playtestRoot = join(repositoryRoot, ".playtest");
const appDir = join(playtestRoot, "app");
const dataDir = join(playtestRoot, "data");
const downloadsDir = join(playtestRoot, "downloads");
const defaultFoundryArchive = join(downloadsDir, "foundryvtt.zip");
const moduleLink = join(dataDir, "Data", "modules", MODULE_ID);
const systemDir = join(dataDir, "Data", "systems", "dnd5e");
const installationMetadataPath = join(playtestRoot, "installation.json");

interface InstallationMetadata {
    foundryVersion: string;
    dnd5eVersion: string;
    preparedAt: string;
}

interface Dnd5eManifest {
    id?: string;
    version?: string;
    download?: string;
}

function isPathInside(parent: string, candidate: string): boolean {
    const child = relative(resolve(parent), resolve(candidate));
    return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function assertPlaytestPath(candidate: string): void {
    if (!isPathInside(playtestRoot, candidate)) {
        throw new Error(`Refusing to modify a path outside ${playtestRoot}: ${candidate}`);
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function run(command: string, args: string[], cwd = repositoryRoot): void {
    const result = spawnSync(command, args, { cwd, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
    }
}

function listArchiveEntries(archivePath: string): string[] {
    const result = spawnSync("unzip", ["-Z1", archivePath], {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Unable to inspect archive ${archivePath}. Is it a valid zip file?`);
    }
    return result.stdout.split(/\r?\n/).filter(Boolean);
}

function validateArchiveEntries(entries: string[]): void {
    for (const entry of entries) {
        const normalized = entry.replaceAll("\\", "/");
        const segments = normalized.split("/");
        if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || segments.includes("..")) {
            throw new Error(`Unsafe path in zip archive: ${entry}`);
        }
    }
}

async function extractZip(archivePath: string, destination: string): Promise<void> {
    validateArchiveEntries(listArchiveEntries(archivePath));
    await mkdir(destination, { recursive: true });
    run("unzip", ["-q", archivePath, "-d", destination]);
}

async function findDirectoryContaining(
    root: string,
    filename: string,
    predicate?: (path: string) => Promise<boolean>,
): Promise<string | null> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isFile() && entry.name === filename) {
            const path = join(root, entry.name);
            if (!predicate || (await predicate(path))) return root;
        }
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = await findDirectoryContaining(join(root, entry.name), filename, predicate);
        if (found) return found;
    }
    return null;
}

async function replaceManagedDirectory(source: string, destination: string): Promise<void> {
    assertPlaytestPath(destination);
    await rm(destination, { force: true, recursive: true });
    await mkdir(dirname(destination), { recursive: true });
    try {
        await rename(source, destination);
    } catch {
        await cp(source, destination, { recursive: true });
    }
}

async function download(url: string, destination: string): Promise<void> {
    assertPlaytestPath(destination);
    console.log(`Downloading ${new URL(url).hostname} asset...`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    const partialPath = `${destination}.partial`;
    assertPlaytestPath(partialPath);
    await finished(Readable.fromWeb(response.body as never).pipe(createWriteStream(partialPath)));
    await rename(partialPath, destination);
}

async function installFoundry(archivePath: string): Promise<void> {
    const resolvedArchive = resolve(repositoryRoot, archivePath);
    if (!(await exists(resolvedArchive))) {
        throw new Error(
            [
                `Foundry VTT ${FOUNDRY_VERSION} Node.js archive not found at ${resolvedArchive}.`,
                `Download the licensed Node.js build and save it as ${defaultFoundryArchive},`,
                "or pass its path after `npm run playtest:prepare --`.",
            ].join("\n"),
        );
    }

    const stagingParent = join(playtestRoot, "tmp");
    await mkdir(stagingParent, { recursive: true });
    const staging = await mkdtemp(join(stagingParent, "foundry-"));
    try {
        await extractZip(resolvedArchive, staging);
        const packageRoot = await findDirectoryContaining(staging, "main.js");
        if (!packageRoot) {
            throw new Error("The archive does not look like a Foundry VTT v14 Node.js build (main.js is missing).");
        }
        await replaceManagedDirectory(packageRoot, appDir);
    } finally {
        await rm(staging, { force: true, recursive: true });
    }
}

async function fetchDnd5eManifest(): Promise<Dnd5eManifest> {
    console.log(`Reading dnd5e ${DND5E_VERSION} manifest...`);
    const response = await fetch(DND5E_MANIFEST_URL, { redirect: "follow" });
    if (!response.ok) {
        throw new Error(`Unable to download the dnd5e manifest (HTTP ${response.status}).`);
    }
    const manifest = (await response.json()) as Dnd5eManifest;
    if (manifest.id !== "dnd5e" || manifest.version !== DND5E_VERSION || !manifest.download) {
        throw new Error(`Unexpected dnd5e manifest at ${DND5E_MANIFEST_URL}.`);
    }
    return manifest;
}

async function installDnd5e(): Promise<void> {
    const manifest = await fetchDnd5eManifest();
    const archivePath = join(downloadsDir, `dnd5e-${DND5E_VERSION}.zip`);
    if (!(await exists(archivePath))) await download(manifest.download!, archivePath);

    const stagingParent = join(playtestRoot, "tmp");
    await mkdir(stagingParent, { recursive: true });
    const staging = await mkdtemp(join(stagingParent, "dnd5e-"));
    try {
        await extractZip(archivePath, staging);
        const packageRoot = await findDirectoryContaining(staging, "system.json", async (path) => {
            const candidate = JSON.parse(await readFile(path, "utf8")) as Dnd5eManifest;
            return candidate.id === "dnd5e";
        });
        if (!packageRoot) throw new Error("The downloaded dnd5e archive does not contain a dnd5e system.json.");
        await replaceManagedDirectory(packageRoot, systemDir);
    } finally {
        await rm(staging, { force: true, recursive: true });
    }
}

async function ensureModuleLink(): Promise<void> {
    await mkdir(dirname(moduleLink), { recursive: true });
    try {
        const stats = await lstat(moduleLink);
        if (!stats.isSymbolicLink()) {
            throw new Error(`Refusing to replace non-symlink module path: ${moduleLink}`);
        }
        const currentTarget = resolve(dirname(moduleLink), await readlink(moduleLink));
        if (currentTarget === repositoryRoot) return;
        await rm(moduleLink);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
    }
    await symlink(repositoryRoot, moduleLink, "dir");
}

async function writeInstallationMetadata(): Promise<void> {
    const metadata: InstallationMetadata = {
        foundryVersion: FOUNDRY_VERSION,
        dnd5eVersion: DND5E_VERSION,
        preparedAt: new Date().toISOString(),
    };
    await writeFile(installationMetadataPath, `${JSON.stringify(metadata, null, 4)}\n`);
}

async function prepare(foundryArchive = defaultFoundryArchive): Promise<void> {
    await mkdir(downloadsDir, { recursive: true });
    if (!(await exists(join(appDir, "main.js")))) {
        console.log(`Installing Foundry VTT ${FOUNDRY_VERSION}...`);
        await installFoundry(foundryArchive);
    } else {
        console.log("Foundry application already installed; leaving it unchanged.");
    }

    if (!(await exists(join(systemDir, "system.json")))) {
        await installDnd5e();
    } else {
        console.log("dnd5e system already installed; leaving it unchanged.");
    }

    await ensureModuleLink();
    await writeInstallationMetadata();
    console.log(`Playtest runtime prepared in ${playtestRoot}`);
}

function getPort(): number {
    const port = Number(process.env.SIDE_INITIATIVE_PLAYTEST_PORT ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(`Invalid SIDE_INITIATIVE_PLAYTEST_PORT: ${process.env.SIDE_INITIATIVE_PLAYTEST_PORT}`);
    }
    return port;
}

async function start(): Promise<void> {
    const mainPath = join(appDir, "main.js");
    if (!(await exists(mainPath))) {
        throw new Error("Foundry is not installed. Run `npm run playtest:prepare` first.");
    }

    run("npm", ["run", "build"]);
    await ensureModuleLink();
    await mkdir(dataDir, { recursive: true });

    const port = getPort();
    const worldPath = join(dataDir, "Data", "worlds", "side-initiative-playtest", "world.json");
    const args = [mainPath, `--dataPath=${dataDir}`, `--port=${port}`, "--noupnp", "--noupdate", "--hotReload"];
    if (await exists(worldPath)) args.push("--world=side-initiative-playtest");

    console.log(`Starting Foundry VTT at http://127.0.0.1:${port}`);
    const child = spawn(process.execPath, args, {
        cwd: appDir,
        env: process.env,
        stdio: "inherit",
    });
    const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    const exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
    });
    process.exitCode = exitCode;
}

async function status(): Promise<void> {
    const appInstalled = await exists(join(appDir, "main.js"));
    const systemInstalled = await exists(join(systemDir, "system.json"));
    const moduleLinked = await (async () => {
        try {
            return (
                (await lstat(moduleLink)).isSymbolicLink() &&
                resolve(dirname(moduleLink), await readlink(moduleLink)) === repositoryRoot
            );
        } catch {
            return false;
        }
    })();
    const port = getPort();
    let serverStatus = "stopped";
    try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_500) });
        if (response.ok || response.status < 500) serverStatus = "reachable";
    } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === "EPERM") {
            serverStatus = "unknown (local network checks are sandboxed)";
        }
    }

    console.log(`Foundry ${FOUNDRY_VERSION}: ${appInstalled ? "installed" : "missing"}`);
    console.log(`dnd5e ${DND5E_VERSION}: ${systemInstalled ? "installed" : "missing"}`);
    console.log(`Module link: ${moduleLinked ? "ready" : "missing"}`);
    console.log(`Server on port ${port}: ${serverStatus}`);
}

function printUsage(): void {
    console.log(`Usage:
  npm run playtest:prepare -- [path/to/foundryvtt.zip]
  npm run playtest:start
  npm run playtest:status`);
}

async function main(): Promise<void> {
    const command = process.argv[2];
    if (command === "prepare") return prepare(process.argv[3]);
    if (command === "start") return start();
    if (command === "status") return status();
    printUsage();
    if (command) process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}

export { assertPlaytestPath, isPathInside, validateArchiveEntries };
