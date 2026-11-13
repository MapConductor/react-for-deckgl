import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';

// deck.gl's click comes from mjolnir.js's tap recognizer, not from the browser's
// click, so the core cannot swallow it. A tap whose pointerup the core's
// DefaultMarkerEventController marked (preventDefault) was already delivered
// by the core, once; DeckGLMap must not deliver it again.
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const outDir = mkdtempSync(new URL('../build/marker-gesture-tap-tests-', import.meta.url));
after(() => rmSync(outDir, { recursive: true, force: true }));
await build({
    entry: { tap: 'src/marker/markerGestureTap.ts' },
    outDir, format: ['esm'], platform: 'node', splitting: false,
    dts: false, sourcemap: false, config: false, silent: true,
});
const { isMarkerGestureTap } = await import(pathToFileURL(resolve(outDir, 'tap.mjs')));

test('a tap whose pointerup the marker gesture took is skipped', () => {
    assert.equal(isMarkerGestureTap({ srcEvent: { type: 'pointerup', defaultPrevented: true } }), true);
});

test('an ordinary tap on the map is delivered', () => {
    assert.equal(isMarkerGestureTap({ srcEvent: { type: 'pointerup', defaultPrevented: false } }), false);
});

test('a tap without a source event is delivered', () => {
    assert.equal(isMarkerGestureTap({}), false);
    assert.equal(isMarkerGestureTap(null), false);
    assert.equal(isMarkerGestureTap(undefined), false);
});
