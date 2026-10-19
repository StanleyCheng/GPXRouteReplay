export const MAX_ALLOWED_SPEED_KILOMETERS_PER_HOUR = 200;
export const MAX_ALLOWED_SPEED_METERS_PER_SECOND = MAX_ALLOWED_SPEED_KILOMETERS_PER_HOUR / 3.6;
export const GPS_SPEED_FILTER_ENABLED = true;

export function haversine(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}

export function filterGpsSpikes(rawPoints, maxSpeed = GPS_SPEED_FILTER_ENABLED ? MAX_ALLOWED_SPEED_METERS_PER_SECOND : Infinity) {
  const points = [];
  let removedPoints = 0;
  let lastTimedPoint = null;

  for (const point of rawPoints) {
    const timestamp = Number(point.time);
    const canMeasureSpeed = lastTimedPoint &&
      Number.isFinite(timestamp) &&
      timestamp > lastTimedPoint.time;

    if (canMeasureSpeed) {
      const elapsedSeconds = (timestamp - lastTimedPoint.time) / 1000;
      if (haversine(lastTimedPoint, point) / elapsedSeconds > maxSpeed) {
        removedPoints += 1;
        continue;
      }
    }

    points.push(point);
    if (Number.isFinite(timestamp) && (!lastTimedPoint || timestamp > lastTimedPoint.time)) {
      lastTimedPoint = { ...point, time: timestamp };
    }
  }

  return { points, removedPoints };
}

export function normalizePointTimes(points) {
  const firstTimedIndex = points.findIndex((point) => Number.isFinite(Number(point.time)));
  const firstTime = firstTimedIndex >= 0 ? Number(points[firstTimedIndex].time) : 0;
  let previousTime = firstTime - (firstTimedIndex + 1) * 1000;

  return points.map((point) => {
    const candidate = Number(point.time);
    const time = Number.isFinite(candidate) && candidate > previousTime
      ? candidate
      : previousTime + 1000;
    previousTime = time;
    return { ...point, time };
  });
}

export function prepareTrack(rawPoints) {
  const filtered = filterGpsSpikes(rawPoints);
  if (filtered.points.length < 2) {
    throw new Error('The route needs at least two usable track points after GPS spike filtering.');
  }
  const startTime = Number(filtered.points.find((point) => Number.isFinite(Number(point.time)))?.time);
  return {
    points: normalizePointTimes(filtered.points),
    startTime: Number.isFinite(startTime) ? startTime : null,
    rawPointCount: rawPoints.length,
    removedPoints: filtered.removedPoints
  };
}

// Return original point indices for drawing only; timestamps, distances and GPS
// positions continue to use the complete track. Iterative Douglas-Peucker avoids
// projecting thousands of subpixel vertices on every 3D map frame.
export function simplifyRouteIndices(points, toleranceMeters = 0.75) {
  if (points.length < 3 || toleranceMeters <= 0) return points.map((_, index) => index);
  const radians = Math.PI / 180;
  const metersPerDegree = 6371000 * radians;
  const longitudeScale = metersPerDegree * points.reduce((maximum, point) => Math.max(maximum, Math.cos(point.lat * radians)), 0);
  let longitude = points[0].lon;
  const projected = points.map((point, index) => {
    if (index) longitude += ((point.lon - points[index - 1].lon + 540) % 360) - 180;
    return {
      x: (longitude - points[0].lon) * longitudeScale,
      y: (point.lat - points[0].lat) * metersPerDegree,
      z: Number.isFinite(point.ele) ? point.ele : 0
    };
  });
  const retained = new Uint8Array(points.length);
  retained[0] = retained[points.length - 1] = 1;
  const pending = [[0, points.length - 1]];
  const toleranceSquared = toleranceMeters ** 2;
  while (pending.length) {
    const [first, last] = pending.pop();
    const a = projected[first];
    const b = projected[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    let furthest = -1;
    let maximum = toleranceSquared;
    for (let index = first + 1; index < last; index++) {
      const point = projected[index];
      const mix = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / lengthSquared)) : 0;
      const distanceSquared = (point.x - a.x - mix * dx) ** 2 + (point.y - a.y - mix * dy) ** 2 + (point.z - a.z - mix * dz) ** 2;
      if (distanceSquared > maximum) {
        maximum = distanceSquared;
        furthest = index;
      }
    }
    if (furthest !== -1) {
      retained[furthest] = 1;
      pending.push([first, furthest], [furthest, last]);
    }
  }
  // Keep ground-sampling anchors even on straight tracks without elevation data,
  // so terrain between distant endpoints still shapes the rendered line.
  let lastAnchor = 0;
  for (let index = 1; index < points.length; index++) {
    if (retained[index] || haversine(points[lastAnchor], points[index]) >= 50) {
      retained[index] = 1;
      lastAnchor = index;
    }
  }
  return points.flatMap((_, index) => retained[index] ? [index] : []);
}
