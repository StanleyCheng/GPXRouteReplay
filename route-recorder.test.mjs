import assert from 'node:assert/strict';
import {
  calculateRecordingSize,
  createMapRecorder,
  isRecordingSupported
} from './route-recorder.mjs';

assert.deepEqual(
  calculateRecordingSize(1280, 800),
  { width: 1280, height: 800 },
  'recordings at or below the output limit should keep their size'
);

assert.deepEqual(
  calculateRecordingSize(3024, 1760),
  { width: 1854, height: 1080 },
  'Retina-sized canvases should be scaled within 1080p'
);

assert.deepEqual(
  calculateRecordingSize(1279, 719),
  { width: 1278, height: 718 },
  'H.264 output dimensions should be even'
);

const globalNames = ['VideoEncoder', 'VideoFrame', 'MediaRecorder', 'HTMLCanvasElement', 'OffscreenCanvas', 'requestAnimationFrame', 'cancelAnimationFrame'];
const originalDescriptors = new Map(globalNames.map((name) => [
  name,
  Object.getOwnPropertyDescriptor(globalThis, name)
]));

let stoppedTracks = 0;

class FakeCanvas {
  constructor() {
    this.width = 640;
    this.height = 360;
  }

  captureStream() {
    return {
      getTracks: () => [{ stop: () => { stoppedTracks += 1; } }]
    };
  }
}

class FakeMediaRecorder {
  static lastStartArguments = null;

  static isTypeSupported(mimeType) {
    return mimeType === 'video/webm;codecs=vp9';
  }

  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onerror = null;
    this.onstop = null;
  }

  start(...args) {
    FakeMediaRecorder.lastStartArguments = args;
    this.state = 'recording';
  }

  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(['valid-video-data'], { type: this.mimeType })
      });
      this.onstop?.();
    });
  }
}

try {
  Object.defineProperty(globalThis, 'VideoEncoder', { value: undefined, configurable: true });
  Object.defineProperty(globalThis, 'VideoFrame', { value: undefined, configurable: true });
  Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: FakeCanvas, configurable: true });
  Object.defineProperty(globalThis, 'MediaRecorder', { value: FakeMediaRecorder, configurable: true });

  assert.equal(isRecordingSupported(), true, 'MediaRecorder should remain a supported fallback');
  const recorder = createMapRecorder(new FakeCanvas(), { routeName: 'Fallback Route' });
  await recorder.start();
  recorder.pause();
  const pausedDuration = recorder.durationMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(recorder.durationMs, pausedDuration, 'fallback loading waits must not count toward video time');
  recorder.resume();
  assert.deepEqual(
    FakeMediaRecorder.lastStartArguments,
    [],
    'fallback recording should create one final chunk instead of timed MP4 fragments'
  );
  const result = await recorder.stop();
  assert.equal(result.mimeType, 'video/webm');
  assert.equal(recorder.frameDriven, false, 'MediaRecorder remains a wall-clock fallback');
  assert.match(result.fileName, /^Fallback-Route-.+\.webm$/);
  assert.equal(stoppedTracks, 1, 'the fallback capture stream should be released');
  URL.revokeObjectURL(result.url);

  const encodedFrames = [];
  let flushes = 0;
  let closedFrames = 0;
  let scheduledCaptures = 0;
  class FakeVideoEncoder {
    static async isConfigSupported() { return { supported: true }; }
    encodeQueueSize = 0;
    configure() {}
    encode(frame) {
      encodedFrames.push({ timestamp: frame.timestamp, duration: frame.duration });
      this.encodeQueueSize++;
    }
    async flush() { flushes++; this.encodeQueueSize = 0; }
    close() {}
  }
  class FakeVideoFrame {
    constructor(canvas, options) { Object.assign(this, options); }
    close() { closedFrames++; }
  }
  class FakeOffscreenCanvas {
    getContext() { return { drawImage() {} }; }
  }
  for (const [name, value] of Object.entries({
    VideoEncoder: FakeVideoEncoder,
    VideoFrame: FakeVideoFrame,
    OffscreenCanvas: FakeOffscreenCanvas,
    requestAnimationFrame: () => { scheduledCaptures++; return 1; },
    cancelAnimationFrame: () => {}
  })) Object.defineProperty(globalThis, name, { value, configurable: true });

  const manualRecorder = createMapRecorder(new FakeCanvas(), { fps: 30, frameDriven: true });
  await manualRecorder.start();
  assert.equal(manualRecorder.frameDriven, true);
  for (let index = 0; index < 10; index++) {
    // Wall-clock delays must not create gaps in the exported timeline.
    if (index === 4) await new Promise((resolve) => setTimeout(resolve, 40));
    await manualRecorder.capture();
  }
  assert.equal(scheduledCaptures, 0, 'manual capture must not run a competing animation loop');
  assert.equal(encodedFrames.length, 11, 'encoder pressure must wait rather than drop frames');
  assert.ok(flushes >= 2, 'bound the number of queued encoding frames');
  encodedFrames.forEach((frame, index) => {
    assert.equal(frame.timestamp, Math.round(index * 1_000_000 / 30));
    assert.equal(frame.timestamp + frame.duration, Math.round((index + 1) * 1_000_000 / 30));
  });
  assert.equal(closedFrames, encodedFrames.length, 'every VideoFrame must release its pixel buffer');
  assert.equal(manualRecorder.durationMs, 11 * 1000 / 30);
  manualRecorder.discard();
  await manualRecorder.capture();
  assert.equal(encodedFrames.length, 11, 'discarded recorders must not capture stale frames');
} finally {
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

console.log('route-recorder tests passed');
