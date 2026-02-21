import path from 'node:path';
import fs from 'node:fs';

/**
 * Copies extension files from nested `public/scripts/extensions/third-party/<name>` layout
 * to repository root, so it can be loaded as a third-party extension.
 * @param {string} extensionPath Extension repository path
 * @returns {void}
 */
export function normalizeNestedExtensionRepo(extensionPath) {
    const nestedExtensionsPath = path.join(extensionPath, 'public', 'scripts', 'extensions', 'third-party');
    if (!fs.existsSync(nestedExtensionsPath)) {
        return;
    }

    const candidates = fs.readdirSync(nestedExtensionsPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(nestedExtensionsPath, entry.name))
        .filter((dirPath) => fs.existsSync(path.join(dirPath, 'manifest.json')));

    if (candidates.length !== 1) {
        return;
    }

    for (const item of fs.readdirSync(candidates[0])) {
        fs.cpSync(path.join(candidates[0], item), path.join(extensionPath, item), { recursive: true, force: true });
    }
}
