const TIME_DIVISIONS = 10;
const MIN_TIME_PER_DIV = 0.01; // 10 ms
const MAX_TIME_PER_DIV = 1; // 1 s
const DEFAULT_TIME_PER_DIV = 0.1; // 100 ms
const DEFAULT_BUFFER_CAPACITY = 12000;
const MIN_VERTICAL_ZOOM = 0.25;
const MAX_VERTICAL_ZOOM = 8;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const nowSeconds = () => Date.now() / 1000;

const createSignalBuffer = (capacity = DEFAULT_BUFFER_CAPACITY) => ({
  timestamps: new Float64Array(capacity),
  values: new Float32Array(capacity),
  head: 0,
  size: 0,
  capacity,
});

const pushSample = (buffer, ts, value) => {
  buffer.timestamps[buffer.head] = ts;
  buffer.values[buffer.head] = value;
  buffer.head = (buffer.head + 1) % buffer.capacity;
  if (buffer.size < buffer.capacity) {
    buffer.size += 1;
  }
};

const iterateBuffer = (buffer, callback) => {
  if (!buffer || buffer.size === 0) return;
  for (let i = 0; i < buffer.size; i += 1) {
    const index = (buffer.head - buffer.size + i + buffer.capacity) % buffer.capacity;
    const ts = buffer.timestamps[index];
    const value = buffer.values[index];
    callback(ts, value);
  }
};

const extractWindowSlice = (buffer, start, end) => {
  const times = [];
  const values = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  iterateBuffer(buffer, (ts, value) => {
    if (ts < start || ts > end) return;
    times.push(ts);
    values.push(value);
    if (value < min) min = value;
    if (value > max) max = value;
  });
  if (!times.length) {
    min = Number.NaN;
    max = Number.NaN;
  }
  return { times, values, min, max };
};

const getOldestTimestamp = (buffer) => {
  if (!buffer || buffer.size === 0) return null;
  const index = (buffer.head - buffer.size + buffer.capacity) % buffer.capacity;
  const ts = buffer.timestamps[index];
  return Number.isFinite(ts) ? ts : null;
};

const getNewestTimestamp = (buffer) => {
  if (!buffer || buffer.size === 0) return null;
  const index = (buffer.head - 1 + buffer.capacity) % buffer.capacity;
  const ts = buffer.timestamps[index];
  return Number.isFinite(ts) ? ts : null;
};

const safeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const resolveRangeFromMetadata = (signal) => {
  const minHint = safeNumber(signal?.minValueHint, null);
  const maxHint = safeNumber(signal?.maxValueHint, null);
  if (Number.isFinite(minHint) && Number.isFinite(maxHint) && minHint !== maxHint) {
    return { min: minHint, max: maxHint };
  }
  if (Number.isFinite(maxHint)) {
    return { min: maxHint - 1, max: maxHint };
  }
  if (Number.isFinite(minHint)) {
    return { min: minHint, max: minHint + 1 };
  }
  return { min: -1, max: 1 };
};

const expandDegenerateRange = ({ min, max }) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.05, 0.5);
    return { min: min - padding, max: max + padding };
  }
  return { min, max };
};

export function createGraphicCore(options = {}) {
  const {
    bufferCapacity = DEFAULT_BUFFER_CAPACITY,
    timeDivisions = TIME_DIVISIONS,
    minTimePerDiv = MIN_TIME_PER_DIV,
    maxTimePerDiv = MAX_TIME_PER_DIV,
    defaultTimePerDiv = DEFAULT_TIME_PER_DIV,
  } = options;

  const signals = new Map();
  const signalsByMessage = new Map();

  let timePerDivision = clamp(defaultTimePerDiv, minTimePerDiv, maxTimePerDiv);
  let isPaused = false;
  let frozenWindowEnd = null;
  let manualOffset = 0;
  let combinedVerticalZoom = 1;

  const getDuration = () => timePerDivision * timeDivisions;

  const getWindowEnd = () => {
    if (!isPaused) {
      frozenWindowEnd = nowSeconds();
      manualOffset = 0;
      return frozenWindowEnd;
    }
    if (frozenWindowEnd == null) {
      frozenWindowEnd = nowSeconds();
    }
    return frozenWindowEnd + manualOffset;
  };

  const getWindow = () => {
    const duration = getDuration();
    const end = getWindowEnd();
    return { start: end - duration, end, duration };
  };

  const getAvailableRange = () => {
    let earliest = null;
    let latest = null;
    signals.forEach((signal) => {
      const oldest = getOldestTimestamp(signal.buffer);
      const newest = getNewestTimestamp(signal.buffer);
      if (Number.isFinite(oldest)) {
        earliest = earliest == null ? oldest : Math.min(earliest, oldest);
      }
      if (Number.isFinite(newest)) {
        latest = latest == null ? newest : Math.max(latest, newest);
      }
    });
    return { earliest, latest };
  };

  const clampManualOffset = () => {
    if (!isPaused) {
      manualOffset = 0;
      return;
    }
    if (manualOffset > 0) {
      manualOffset = 0;
    }
    const { earliest } = getAvailableRange();
    if (earliest == null) return;
    const duration = getDuration();
    const baseEnd = frozenWindowEnd ?? nowSeconds();
    const currentEnd = baseEnd + manualOffset;
    if (currentEnd - duration < earliest) {
      manualOffset = earliest + duration - baseEnd;
    }
  };

  const registerSignal = (descriptor) => {
    if (!descriptor || !descriptor.id) return null;
    if (signals.has(descriptor.id)) {
      return signals.get(descriptor.id);
    }
    const buffer = createSignalBuffer(bufferCapacity);
    const signal = {
      id: descriptor.id,
      messageName: descriptor.messageName,
      signalName: descriptor.signalName,
      displayName: descriptor.displayName || descriptor.signalName,
      color: descriptor.color,
      unit: descriptor.unit || '',
      enabled: descriptor.enabled !== false,
      minValueHint: safeNumber(descriptor.minValue),
      maxValueHint: safeNumber(descriptor.maxValue, safeNumber(descriptor.minValue, null)),
      buffer,
      verticalZoom: 1,
    };
    signals.set(signal.id, signal);
    if (!signalsByMessage.has(signal.messageName)) {
      signalsByMessage.set(signal.messageName, new Map());
    }
    signalsByMessage.get(signal.messageName).set(signal.signalName, signal);
    return signal;
  };

  const removeSignal = (signalId) => {
    const signal = signals.get(signalId);
    if (!signal) return;
    signals.delete(signalId);
    const messageMap = signalsByMessage.get(signal.messageName);
    if (messageMap) {
      messageMap.delete(signal.signalName);
      if (!messageMap.size) {
        signalsByMessage.delete(signal.messageName);
      }
    }
  };

  const setSignalEnabled = (signalId, enabled) => {
    const signal = signals.get(signalId);
    if (!signal) return;
    signal.enabled = !!enabled;
  };

  const setSignalVerticalZoom = (signalId, value) => {
    const signal = signals.get(signalId);
    if (!signal) return;
    signal.verticalZoom = clamp(value, MIN_VERTICAL_ZOOM, MAX_VERTICAL_ZOOM);
  };

  const adjustSignalVerticalZoom = (signalId, factor) => {
    const signal = signals.get(signalId);
    if (!signal) return;
    const next = clamp(signal.verticalZoom * factor, MIN_VERTICAL_ZOOM, MAX_VERTICAL_ZOOM);
    signal.verticalZoom = next;
  };

  const resetSignalVerticalZoom = (signalId) => setSignalVerticalZoom(signalId, 1);

  const setCombinedVerticalZoom = (value) => {
    combinedVerticalZoom = clamp(value, MIN_VERTICAL_ZOOM, MAX_VERTICAL_ZOOM);
  };

  const adjustCombinedVerticalZoom = (factor) => {
    setCombinedVerticalZoom(combinedVerticalZoom * factor);
  };

  const resetCombinedVerticalZoom = () => setCombinedVerticalZoom(1);

  const ingestTraceEntry = (entry) => {
    if (!entry) return;
    const frameName = entry.frame_name || entry.frameName || entry.message_name || entry.frame;
    if (!frameName) return;
    const samples = Array.isArray(entry.signals) ? entry.signals : [];
    if (!samples.length) return;
    const messageSignals = signalsByMessage.get(frameName);
    if (!messageSignals || !messageSignals.size) return;
    const timestamp = Number(entry.ts);
    const ts = Number.isFinite(timestamp) ? timestamp : nowSeconds();
    samples.forEach((sample) => {
      const name = sample?.name;
      if (!name || !messageSignals.has(name)) return;
      const signal = messageSignals.get(name);
      const physical = sample?.physical_value ?? sample?.physical ?? sample?.value;
      const numeric = safeNumber(physical, null);
      if (numeric == null) return;
      pushSample(signal.buffer, ts, numeric);
    });
  };

  const pause = () => {
    if (isPaused) return;
    isPaused = true;
    frozenWindowEnd = nowSeconds();
    manualOffset = 0;
  };

  const resume = () => {
    if (!isPaused) return;
    isPaused = false;
    frozenWindowEnd = nowSeconds();
    manualOffset = 0;
  };

  const shiftWindow = (deltaSeconds) => {
    if (!isPaused || !Number.isFinite(deltaSeconds) || deltaSeconds === 0) return;
    manualOffset += deltaSeconds;
    clampManualOffset();
  };

  const setTimePerDivision = (value) => {
    const next = clamp(value, minTimePerDiv, maxTimePerDiv);
    if (Math.abs(next - timePerDivision) < 1e-6) return;
    timePerDivision = next;
    clampManualOffset();
  };

  const adjustTimePerDivision = (factor) => {
    if (!Number.isFinite(factor) || factor === 0) return;
    setTimePerDivision(timePerDivision * factor);
  };

  const getSignals = () => Array.from(signals.values());

  const getRenderableSignals = (window) => {
    const snapshot = [];
    signals.forEach((signal) => {
      if (!signal.enabled) return;
      const slice = extractWindowSlice(signal.buffer, window.start, window.end);
      const metaRange = resolveRangeFromMetadata(signal);
      const hasData = slice.times.length > 0;
      const rawMin = hasData ? slice.min : metaRange.min;
      const rawMax = hasData ? slice.max : metaRange.max;
      const expanded = expandDegenerateRange({ min: rawMin, max: rawMax });
      snapshot.push({
        id: signal.id,
        color: signal.color,
        unit: signal.unit,
        displayName: signal.displayName,
        times: slice.times,
        values: slice.values,
        dataMin: expanded.min,
        dataMax: expanded.max,
        verticalZoom: signal.verticalZoom,
      });
    });
    return snapshot;
  };

  const getCombinedRange = (signalsSnapshot) => {
    if (!signalsSnapshot.length) return { min: -1, max: 1 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    signalsSnapshot.forEach((entry) => {
      if (entry.dataMin < min) min = entry.dataMin;
      if (entry.dataMax > max) max = entry.dataMax;
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: -1, max: 1 };
    }
    return expandDegenerateRange({ min, max });
  };

  return {
    TIME_DIVISIONS: timeDivisions,
    MIN_TIME_PER_DIV: minTimePerDiv,
    MAX_TIME_PER_DIV: maxTimePerDiv,
    getWindow,
    getSignals,
    getRenderableSignals,
    getCombinedRange,
    registerSignal,
    removeSignal,
    setSignalEnabled,
    setSignalVerticalZoom,
    adjustSignalVerticalZoom,
    resetSignalVerticalZoom,
    setCombinedVerticalZoom,
    adjustCombinedVerticalZoom,
    resetCombinedVerticalZoom,
    getCombinedVerticalZoom: () => combinedVerticalZoom,
    getTimePerDivision: () => timePerDivision,
    setTimePerDivision,
    adjustTimePerDivision,
    ingestTraceEntry,
    pause,
    resume,
    isPaused: () => isPaused,
    shiftWindow,
    getAvailableRange,
  };
}

export const formatTimePerDivision = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds >= 1) {
    return `${seconds.toFixed(2)} s`;
  }
  const ms = seconds * 1000;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
};

export const formatZoomFactor = (zoom) => {
  const text = zoom.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return `${text}×`;
};
