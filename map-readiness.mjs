// `style.load` only means the style exists. Recording needs a fully painted
// viewport, including terrain, labels and any pending camera transition.
export function waitForMapIdle(map, { signal, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      map.off('idle', onIdle);
      map.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onIdle = () => {
      if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) finish();
    };
    const onError = () => finish(new Error('The map could not fully load. Check your connection and reload.'));
    const onAbort = () => finish(new DOMException('Playback cancelled.', 'AbortError'));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    map.on('idle', onIdle);
    map.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(new Error('The map is still loading. Please try again.')), timeoutMs);
    // Even an already loaded map must paint once after the latest route update.
    map.triggerRepaint();
  });
}

// MediaRecorder uses wall time; keep each complete frame visible for one sample
// interval while excluding map/network waits from its recording timeline.
export function waitForCaptureInterval(signal, durationMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Playback cancelled.', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);
  });
}
