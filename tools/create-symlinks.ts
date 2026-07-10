import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const MODULE_ID = "side-initiative";
// Repository root (this file lives in <root>/tools).
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface FoundryConfig {
    dataPath?: string;
}

async function readFoundryConfig(): Promise<FoundryConfig> {
    if (!fs.existsSync("foundry-config.yaml")) return {};
    try {
        const fc = await fs.promises.readFile("foundry-config.yaml", "utf-8");
        return (yaml.load(fc) as FoundryConfig | undefined) ?? {};
    } catch (err) {
        console.error(`Error reading foundry-config.yaml: ${err}`);
        return {};
    }
}

async function main(): Promise<void> {
    console.log("Linking Side Initiative into Foundry");

    const { dataPath } = await readFoundryConfig();
    if (!dataPath) {
        console.log("No 'dataPath' set in foundry-config.yaml; skipping module symlink.");
        console.log("Add your Foundry user data directory (the one containing Data/), e.g.:");
        console.log('  dataPath: "/path/to/FoundryVTT"');
        return;
    }

    // Support both the user data root (containing Data/) and the Data dir itself.
    const dataDir = fs.existsSync(path.join(dataPath, "Data", "modules")) ? path.join(dataPath, "Data") : dataPath;
    const modulesDir = path.join(dataDir, "modules");
    const linkPath = path.join(modulesDir, MODULE_ID);

    try {
        await fs.promises.mkdir(modulesDir, { recursive: true });
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }

    // Replace an existing link (or stale directory) so re-running is idempotent.
    try {
        await fs.promises.rm(linkPath, { force: true, recursive: true });
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }

    await fs.promises.symlink(moduleRoot, linkPath, "dir");
    console.log(`Linked ${linkPath} -> ${moduleRoot}`);
}

await main();
