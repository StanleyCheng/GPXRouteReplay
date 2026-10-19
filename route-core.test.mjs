import assert from 'node:assert/strict';
import {
  MAX_ALLOWED_SPEED_KILOMETERS_PER_HOUR,
  MAX_ALLOWED_SPEED_METERS_PER_SECOND,
  GPS_SPEED_FILTER_ENABLED,
  filterGpsSpikes,
  normalizePointTimes,
  prepareTrack,
  simplifyRouteIndices
} from './route-core.mjs';

const start = { lat: 22.3, lon: 114.17, time: 0 };
const spike = { lat: 22.31, lon: 114.18, time: 1000 };
const recovery = { lat: 22.30001, lon: 114.17001, time: 2000 };
const filtered = filterGpsSpikes([start, spike, recovery], MAX_ALLOWED_SPEED_METERS_PER_SECOND);

assert.equal(MAX_ALLOWED_SPEED_KILOMETERS_PER_HOUR, 200);
assert.equal(GPS_SPEED_FILTER_ENABLED, true);
assert.deepEqual(filtered.points, [start, recovery]);
assert.equal(filtered.removedPoints, 1);
assert.equal(prepareTrack([start, spike, recovery]).removedPoints, 1);

const missingTime = { lat: 22.30002, lon: 114.17002, time: Number.NaN };
assert.equal(filterGpsSpikes([start, missingTime, recovery]).points.length, 3);

const normalized = normalizePointTimes([
  { ...start, time: Number.NaN },
  { ...recovery, time: 5000 },
  { ...recovery, time: 5000 }
]);
assert.deepEqual(normalized.map((point) => point.time), [4000, 5000, 6000]);
assert.equal(prepareTrack([start, recovery]).startTime, 0);
assert.equal(prepareTrack([start, recovery]).rawPointCount, 2);

// Display simplification preserves corners and references original samples;
// track timestamps, measurements and distance inputs must stay untouched.
const denseLine = Array.from({ length: 10000 }, (_, index) => ({ lat: 22.3, lon: 114.17 + index * 0.000001, time: index * 1000 }));
const originalLine = structuredClone(denseLine);
const reducedLine = simplifyRouteIndices(denseLine);
assert.equal(reducedLine[0], 0);
assert.equal(reducedLine.at(-1), 9999);
assert.ok(reducedLine.length < 30, 'Subpixel samples should collapse into a small set of terrain anchors.');
assert.deepEqual(denseLine, originalLine);
assert.deepEqual(simplifyRouteIndices([]), []);
assert.deepEqual(simplifyRouteIndices([start]), [0]);
assert.deepEqual(simplifyRouteIndices([start, recovery]), [0, 1]);
const corner = [
  { lat: 0, lon: 0 }, { lat: 0, lon: 0.0001 },
  { lat: 0.0001, lon: 0.0001 }, { lat: 0.0002, lon: 0.0001 }
];
assert.deepEqual(simplifyRouteIndices(corner), [0, 1, 3]);
assert.deepEqual(simplifyRouteIndices(corner, 0), [0, 1, 2, 3]);
const dateline = simplifyRouteIndices([
  { lat: 0, lon: 179.9998 }, { lat: 0, lon: 179.9999 },
  { lat: 0, lon: -180 }, { lat: 0, lon: -179.9999 }
]);
assert.equal(dateline[0], 0);
assert.equal(dateline.at(-1), 3);
assert.deepEqual(dateline, [0, 3]);
// A deviation larger than the tolerance must remain visible.
assert.deepEqual(simplifyRouteIndices([
  { lat: 0, lon: 0 }, { lat: 0.00001, lon: 0.0001 }, { lat: 0, lon: 0.0002 }
]), [0, 1, 2]);
assert.deepEqual(simplifyRouteIndices([
  { lat: 0, lon: 0, ele: 0 }, { lat: 0, lon: 0.0001, ele: 10 }, { lat: 0, lon: 0.0002, ele: 0 }
]), [0, 1, 2], 'A straight route must retain its mountain profile.');

console.log('Route filtering tests passed.');
