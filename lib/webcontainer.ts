import { WebContainer } from "@webcontainer/api";

// Only one WebContainer can ever be booted per tab. Kept on globalThis (not a
// module variable) so a hot reload of this file reuses the running instance
// instead of trying to boot a second one.
const globalState = globalThis as typeof globalThis & {
    __webcontainerPromise?: Promise<WebContainer>;
};

// WebContainer's built-in http/https modules reject npm's https registry
// requests with ERR_INVALID_PROTOCOL ("Protocol "https:" not supported"),
// while http requests work. Pointing npm at the http registry makes installs
// work. The setting lives in the container's in-memory ~/.npmrc, which is
// wiped on every page load, so it's reapplied on each boot.
const NPM_REGISTRY = "http://registry.npmjs.org/";

async function configureNpmRegistry(webcontainer: WebContainer) {
    try {
        const process = await webcontainer.spawn(
            "npm",
            ["config", "set", "registry", NPM_REGISTRY],
            { output: false },
        );
        const exitCode = await process.exit;
        if (exitCode !== 0) {
            console.warn(`Setting the npm registry exited with code ${exitCode}; npm installs may fail.`);
        }
    } catch (error) {
        // Never block the IDE from loading over this.
        console.warn("Could not set the npm registry; npm installs may fail.", error);
    }
}

async function bootWebContainer() {
    // Forward the preview page's uncaught errors and console.error calls
    // so the agent's check_dev_server tool can see runtime bugs.
    const webcontainer = await WebContainer.boot({ forwardPreviewErrors: true });

    // Finish before anyone gets the container, so the terminal or the agent
    // can't run npm install before the setting is in place.
    await configureNpmRegistry(webcontainer);

    return webcontainer;
}

export function getWebContainer() {
    if (!globalState.__webcontainerPromise) {
        globalState.__webcontainerPromise = bootWebContainer();
    }

    return globalState.__webcontainerPromise;
}
