import path from 'node:path';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';

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
        const targetPath = path.join(extensionPath, item);
        if (fs.existsSync(targetPath)) {
            throw new Error(`Cannot normalize nested extension repository: destination already exists at ${targetPath}. Please ensure the repository root does not contain conflicting files.`);
        }
        fs.cpSync(path.join(candidates[0], item), targetPath, { recursive: true });
    }
}

/**
 * Resolves a stable extension directory name.
 * Uses manifest key when provided, falling back to repository URL basename.
 * @param {string} repositoryUrl Extension repository URL
 * @param {Record<string, any>} manifest Extension manifest
 * @returns {string} Sanitized directory name
 */
export function resolveExtensionDirectoryName(repositoryUrl, manifest = {}) {
    const trimmedManifestName = typeof manifest.name === 'string' ? manifest.name.trim() : '';
    const manifestKey = trimmedManifestName.length > 0 ? trimmedManifestName : '';
    const fallbackKey = path.basename(repositoryUrl, '.git');
    return sanitize(manifestKey || fallbackKey);
}
