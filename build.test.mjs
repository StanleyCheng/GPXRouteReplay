import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { Encoder, Profile } from '@garmin/fitsdk';

const source = await readFile('index.html', 'utf8');
const built = await readFile('docs/index.html', 'utf8');
const sdk = await readFile('docs/fit-sdk.js', 'utf8');

function runClassicScripts(html, href) {
  const redirects = [];
  const context = createContext({ URL, location: { href, replace: (url) => redirects.push(url) } });
  context.window = context;
  for (const [, attributes, contents] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\b(?:src|type)=/.test(attributes)) continue;
    runInContext(contents, context);
  }
  return { context, redirects };
}

// Opening the editable source must lead to the functional, bundled app.
for (const href of [
  'file:///Users/example/GPX%20Route%20Replay/index.html',
  'http://localhost:8000/index.html',
  'http://localhost:8000/'
]) {
  const { redirects } = runClassicScripts(source, href);
  assert.deepEqual(redirects, [new URL('./docs/index.html', href).href]);
}
assert.ok(!source.includes('type="module"'), 'Unbuilt app logic must stay inactive during navigation.');

// Built pages must run in place, including Pages subpaths and direct disk opens.
for (const href of [
  'file:///Users/example/GPX%20Route%20Replay/docs/index.html',
  'http://localhost:8000/',
  'https://example.github.io/GPXRouteReplay/'
]) {
  const { context, redirects } = runClassicScripts(built, href);
  assert.deepEqual(redirects, [], 'Built app must not redirect into another docs folder.');
  assert.equal(typeof context.RouteCore.prepareTrack, 'function');
  assert.equal(typeof context.RouteRecorder.createMapRecorder, 'function');
  assert.equal(typeof context.MapReadiness.waitForMapIdle, 'function');
}
assert.ok(built.includes('type="module"'), 'Built app logic must be active.');
assert.ok(!/__\w+_BUNDLE__/.test(built), 'All required bundles must be populated.');

// Decode a generated activity through the shipped classic script, without imports.
const encoder = new Encoder();
encoder.onMesg(Profile.MesgNum.FILE_ID, {
  manufacturer: 'development', product: 1, type: 'activity',
  timeCreated: new Date('2026-01-01T00:00:00Z')
});
for (let index = 0; index < 3; index++) {
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 5)),
    positionLat: Math.round((22.3 + index * 0.00001) / 180 * 2 ** 31),
    positionLong: Math.round((114.17 + index * 0.00001) / 180 * 2 ** 31),
    altitude: 10 + index, heartRate: 120 + index
  });
}
const sdkContext = createContext({ bytes: encoder.close(), ArrayBuffer, Uint8Array, TextEncoder, TextDecoder });
runInContext(sdk, sdkContext);
runInContext(`
  const decoder = new GarminFitSdk.Decoder(GarminFitSdk.Stream.fromByteArray(bytes));
  globalThis.decoded = decoder.read();
`, sdkContext);
assert.equal(sdkContext.decoded.errors.length, 0);
assert.equal(sdkContext.decoded.messages.fileIdMesgs[0].type, 'activity');
assert.equal(sdkContext.decoded.messages.recordMesgs.length, 3);
assert.equal(sdkContext.decoded.messages.recordMesgs[2].heartRate, 122);

console.log('Built app entry and FIT decoding tests passed.');
