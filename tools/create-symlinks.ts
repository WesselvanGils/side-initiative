import * as fs from "node:fs";
import yaml from "js-yaml";
import * as path from "node:path";

console.log("Reforging Symlinks");

if (fs.existsSync("foundry-config.yaml")) {
    let fileRoot = "";
    try {
        const fc = await fs.promises.readFile("foundry-config.yaml", "utf-8");
        const foundryConfig = yaml.load(fc) as { installPath: string } | undefined;
        const installPath = foundryConfig?.installPath ?? "";
        // As of 13.338, the Node install is *not* nested but electron installs *are*
        const nested = fs.existsSync(path.join(installPath, "resources", "app"));
        fileRoot = nested ? path.join(installPath, "resources", "app") : installPath;
    } catch (err) {
        console.error(`Error reading foundry-config.yaml: ${err}`);
    }

    try {
        await fs.promises.mkdir("foundry");
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }

    // Javascript files
    for (const p of ["client", "common", "tsconfig.json"]) {
        try {
            await fs.promises.symlink(path.join(fileRoot, p), path.join("foundry", p));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
    }

    // Language files
    try {
        await fs.promises.symlink(path.join(fileRoot, "public", "lang"), path.join("foundry", "lang"));
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
} else {
    console.log("Foundry config file did not exist.");
}
