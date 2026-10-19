import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { waitForMapIdle, waitForCaptureInterval } from './map-readiness.mjs';

class FakeMap extends EventEmitter {
  ready = false;
  tilesReady = false;
  moving = false;
  repaints = 0;
  loaded() { return this.ready; }
  areTilesLoaded() { return this.tilesReady; }
  isMoving() { return this.moving; }
  triggerRepaint() { this.repaints++; }
}

const map = new FakeMap();
let resolved = false;
const pending = waitForMapIdle(map).then(() => { resolved = true; });
map.emit('style.load');
map.emit('render');
map.emit('idle');
await Promise.resolve();
assert.equal(resolved, false, 'style/render events must not start recording before tiles load');
map.ready = true;
map.tilesReady = true;
map.moving = true;
map.emit('idle');
await Promise.resolve();
assert.equal(resolved, false, 'camera movement must finish first');
map.moving = false;
map.emit('idle');
await pending;
assert.equal(resolved, true);
assert.equal(map.repaints, 1, 'already-loaded maps also need a fresh rendered frame');
assert.equal(map.listenerCount('idle'), 0);
assert.equal(map.listenerCount('error'), 0);

const intervalController = new AbortController();
await waitForCaptureInterval(intervalController.signal, 1);
const interval = waitForCaptureInterval(intervalController.signal, 10000);
intervalController.abort();
await assert.rejects(interval, { name: 'AbortError' });

const controller = new AbortController();
const cancelled = waitForMapIdle(map, { signal: controller.signal });
controller.abort();
await assert.rejects(cancelled, { name: 'AbortError' });
await assert.rejects(waitForMapIdle(map, { signal: controller.signal }), { name: 'AbortError' });
assert.equal(map.listenerCount('idle'), 0, 'cancelled preparations must release their listeners');

const failed = waitForMapIdle(map);
map.emit('error', new Error('Tile failed'));
await assert.rejects(failed, /could not fully load/);
await assert.rejects(waitForMapIdle(map, { timeoutMs: 1 }), /still loading/);
assert.equal(map.listenerCount('idle'), 0, 'timeouts and errors must release their listeners');
assert.equal(map.listenerCount('error'), 0);

console.log('map-readiness tests passed');
