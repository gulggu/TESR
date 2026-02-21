import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, test, expect } from '@jest/globals';
import { normalizeNestedExtensionRepo } from '../src/endpoints/extensions-util.js';

describe('normalizeNestedExtensionRepo', () => {
    test('should flatten a nested third-party extension repository layout', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-ext-nested-'));
        try {
            const extensionPath = path.join(tempDir, 'repo');
            const nestedPath = path.join(extensionPath, 'public', 'scripts', 'extensions', 'third-party', 'test-extension');
            fs.mkdirSync(nestedPath, { recursive: true });
            fs.writeFileSync(path.join(nestedPath, 'manifest.json'), JSON.stringify({ display_name: 'Test Extension' }));
            fs.writeFileSync(path.join(nestedPath, 'index.js'), 'export default {};');

            normalizeNestedExtensionRepo(extensionPath);

            expect(fs.existsSync(path.join(extensionPath, 'manifest.json'))).toBe(true);
            expect(fs.existsSync(path.join(extensionPath, 'index.js'))).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
