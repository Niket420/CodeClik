import { WebContainer } from "@webcontainer/api";

// Only one WebContainer can ever be booted per tab. Kept on globalThis (not a
// module variable) so a hot reload of this file reuses the running instance
// instead of trying to boot a second one.
const globalState = globalThis as typeof globalThis & {
    __webcontainerPromise?: Promise<WebContainer>;
};

export function getWebContainer() {
    if (!globalState.__webcontainerPromise) {
        // Forward the preview page's uncaught errors and console.error calls
        // so the agent's check_dev_server tool can see runtime bugs.
        globalState.__webcontainerPromise = WebContainer.boot({ forwardPreviewErrors: true });
    }

    return globalState.__webcontainerPromise;
}
