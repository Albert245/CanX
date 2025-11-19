const TIME_DIVISIONS = 10;
const MIN_TIME_PER_DIV = 0.01; // 10 ms
const MAX_TIME_PER_DIV = 10; // 10 s
const DEFAULT_TIME_PER_DIV = 10; // 10 s
const DEFAULT_BUFFER_CAPACITY = 12000;
const MIN_VERTICAL_ZOOM = 0.25;
const MAX_VERTICAL_ZOOM = 8;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const nowSeconds = () => performance.now() / 1000;

const normalizeKey = (value) => String(value ?? '').trim().toLowerCase();

const createSignalBuffer = (capacity = DEFAULT_BUFFER_CAPACITY) => ({
  timestamps: new Float64Array(capacity),
  values: new Float32Array(capacity),
  head: 0,
  size: 0,
  capacity,
});

const clearSignalBuffer = (buffer) => {
  if (!buffer) return;
  buffer.head = 0;
  buffer.size = 0;
};

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
  const minHint = safeNumber(signal?.minValueHint ?? signal?.minValue, null);
  const maxHint = safeNumber(
    signal?.maxValueHint ?? signal?.maxValue ?? safeNumber(signal?.minValueHint ?? signal?.minValue, null),
    null,
  );
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

const deriveInitialRange = (descriptor) => {
  const base = resolveRangeFromMetadata(descriptor);
  const initialValue = safeNumber(descriptor?.initialValue, null);
  if (initialValue != null) {
    base.min = Math.min(base.min, initialValue);
    base.max = Math.max(base.max, initialValue);
  }
  return expandDegenerateRange(base);
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

const updateSignalTimingStats = (signal, timestamp) => {
  if (!signal || !Number.isFinite(timestamp)) return;
  if (Number.isFinite(signal.lastSampleTs)) {
    const delta = timestamp - signal.lastSampleTs;
    if (delta > 1e-4) {
      signal.avgInterval = signal.avgInterval == null ? delta : signal.avgInterval * 0.8 + delta * 0.2;
    }
  }
  signal.lastSampleTs = timestamp;
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
  const messageEntries = new Map();
  const aliasLookup = new Map();

  const initialTimePerDivision = clamp(defaultTimePerDiv, minTimePerDiv, maxTimePerDiv);
  let timePerDivision = initialTimePerDivision;
  let isPaused = false;
  let frozenWindowEnd = null;
  let manualOffset = 0;
  let combinedVerticalZoom = 1;
  let lastSampleTimestamp = 0;
  let remoteClockOffset = null;

  const getDuration = () => timePerDivision * timeDivisions;

  const getWindowEnd = () => {
    if (!isPaused) {
      const liveNow = nowSeconds();
      const end = lastSampleTimestamp ? Math.max(liveNow, lastSampleTimestamp) : liveNow;
      frozenWindowEnd = end;
      manualOffset = 0;
      return end;
    }
    if (frozenWindowEnd == null) {
      frozenWindowEnd = lastSampleTimestamp || nowSeconds();
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

  const registerAlias = (entry, alias) => {
    const key = normalizeKey(alias);
    if (!key) return;
    aliasLookup.set(key, entry.key);
    entry.aliases.add(key);
  };

  const ensureMessageEntry = (descriptor) => {
    const canonicalKey = normalizeKey(descriptor.messageName);
    if (!canonicalKey) return null;
    let entry = messageEntries.get(canonicalKey);
    if (!entry) {
      entry = { key: canonicalKey, signals: new Map(), aliases: new Set() };
      messageEntries.set(canonicalKey, entry);
    }
    registerAlias(entry, descriptor.messageName);
    const aliasSources = Array.isArray(descriptor.frameAliases) ? descriptor.frameAliases : [];
    aliasSources.forEach((alias) => registerAlias(entry, alias));
    return entry;
  };

  const cleanupMessageEntry = (entry) => {
    if (!entry || entry.signals.size) return;
    messageEntries.delete(entry.key);
    entry.aliases.forEach((alias) => {
      if (aliasLookup.get(alias) === entry.key) {
        aliasLookup.delete(alias);
      }
    });
  };

  const getMessageMap = (identifier) => {
    const key = normalizeKey(identifier);
    if (!key) return null;
    const canonicalKey = aliasLookup.get(key) || key;
    const entry = messageEntries.get(canonicalKey);
    return entry ? entry.signals : null;
  };

  const registerSignal = (descriptor) => {
    if (!descriptor || !descriptor.id) return null;
    if (signals.has(descriptor.id)) {
      return signals.get(descriptor.id);
    }
    const messageEntry = ensureMessageEntry(descriptor);
    if (!messageEntry) {
      return null;
    }
    const signalKey = normalizeKey(descriptor.signalName);
    if (!signalKey) {
      return null;
    }
    const minValueHint = safeNumber(descriptor.minValue, null);
    const maxValueHint = safeNumber(descriptor.maxValue, minValueHint);
    const initialRange = deriveInitialRange({
      minValueHint,
      maxValueHint,
      initialValue: descriptor.initialValue,
    });
    const buffer = createSignalBuffer(bufferCapacity);
    const signal = {
      id: descriptor.id,
      messageName: descriptor.messageName,
      signalName: descriptor.signalName,
      messageKey: messageEntry.key,
      signalKey,
      displayName: descriptor.displayName || descriptor.signalName,
      color: descriptor.color,
      unit: descriptor.unit || '',
      enabled: descriptor.enabled !== false,
      minValueHint,
      maxValueHint,
      rangeMin: initialRange.min,
      rangeMax: initialRange.max,
      initialRange: { ...initialRange },
      buffer,
      hasSamples: false,
      verticalZoom: 1,
      lastSampleTs: null,
      avgInterval: null,
    };
    signals.set(signal.id, signal);
    messageEntry.signals.set(signalKey, signal);
    return signal;
  };

  const removeSignal = (signalId) => {
    const signal = signals.get(signalId);
    if (!signal) return;
    signals.delete(signalId);
    const entry = messageEntries.get(signal.messageKey);
    if (entry) {
      entry.signals.delete(signal.signalKey);
      cleanupMessageEntry(entry);
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

  const resolveMessageSignals = (entry) => {
    const candidates = [
      entry.frame_name,
      entry.frameName,
      entry.message_name,
      entry.messageName,
      entry.frame,
      entry.id,
      entry.id_hex,
      entry.arbitration_id,
      entry.can_id,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const map = getMessageMap(candidate);
      if (map) return map;
    }
    return null;
  };

  const ingestTraceEntry = (entry) => {
    if (!entry) return;
    const samples = Array.isArray(entry.signals) ? entry.signals : [];
    if (!samples.length) return;
    const messageSignals = resolveMessageSignals(entry);
    if (!messageSignals || !messageSignals.size) return;
    const remoteTimestamp = Number(entry.ts);
    const nowTs = nowSeconds();
    if (Number.isFinite(remoteTimestamp)) {
      const candidateOffset = nowTs - remoteTimestamp;
      if (remoteClockOffset == null) {
        remoteClockOffset = candidateOffset;
      } else {
        const delta = candidateOffset - remoteClockOffset;
        remoteClockOffset += delta * 0.1;
      }
    }
    const tsBase = Number.isFinite(remoteTimestamp) && remoteClockOffset != null
      ? remoteTimestamp + remoteClockOffset
      : nowTs;
    let appended = false;
    samples.forEach((sample) => {
      const signalKey = normalizeKey(sample?.name);
      if (!signalKey || !messageSignals.has(signalKey)) return;
      const signal = messageSignals.get(signalKey);
      const physical =
        sample?.physical_value ??
        sample?.physicalValue ??
        sample?.physical ??
        sample?.value;
      const numeric = safeNumber(physical, null);
      if (numeric == null) return;
      pushSample(signal.buffer, tsBase, numeric);
      updateSignalTimingStats(signal, tsBase);
      signal.hasSamples = true;
      appended = true;
    });
    if (appended && Number.isFinite(tsBase)) {
      lastSampleTimestamp = lastSampleTimestamp ? Math.max(lastSampleTimestamp, tsBase) : tsBase;
    }
  };

  const pause = () => {
    if (isPaused) return;
    isPaused = true;
    const liveNow = nowSeconds();
    frozenWindowEnd = lastSampleTimestamp ? Math.max(liveNow, lastSampleTimestamp) : liveNow;
    manualOffset = 0;
  };

  const resume = () => {
    if (!isPaused) return;
    isPaused = false;
    frozenWindowEnd = lastSampleTimestamp ? Math.max(nowSeconds(), lastSampleTimestamp) : nowSeconds();
    manualOffset = 0;
  };

  const shiftWindow = (deltaSeconds) => {
    if (!isPaused || !Number.isFinite(deltaSeconds) || deltaSeconds === 0) return;
    manualOffset += deltaSeconds;
    clampManualOffset();
  };

  const ingestSignalValue = (messageName, signalName, value, timestamp = null) => {
    const messageSignals = getMessageMap(messageName);
    if (!messageSignals) return false;
    const signal = messageSignals.get(normalizeKey(signalName));
    if (!signal) return false;
    const numeric = safeNumber(value, null);
    if (numeric == null) return false;
    const ts = Number.isFinite(timestamp) ? timestamp : nowSeconds();
    pushSample(signal.buffer, ts, numeric);
    updateSignalTimingStats(signal, ts);
    signal.hasSamples = true;
    if (Number.isFinite(ts)) {
      lastSampleTimestamp = lastSampleTimestamp ? Math.max(lastSampleTimestamp, ts) : ts;
    }
    return true;
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

  const resetValueAxisScaling = () => {
    resetCombinedVerticalZoom();
    signals.forEach((signal) => {
      resetSignalVerticalZoom(signal.id);
    });
  };

  const suggestTimePerDivision = () => {
    let bestInterval = null;
    signals.forEach((signal) => {
      if (!signal.enabled) return;
      if (!Number.isFinite(signal.avgInterval) || signal.avgInterval <= 0) return;
      bestInterval = bestInterval == null ? signal.avgInterval : Math.min(bestInterval, signal.avgInterval);
    });
    if (bestInterval == null) return null;
    return clamp(bestInterval * 10, minTimePerDiv, maxTimePerDiv);
  };

  const autoScaleAxes = () => {
    resetValueAxisScaling();
    const suggested = suggestTimePerDivision();
    if (Number.isFinite(suggested)) {
      setTimePerDivision(suggested);
    } else {
      setTimePerDivision(initialTimePerDivision);
    }
  };

  const getSignals = () => Array.from(signals.values());

  const getRenderableSignals = (window) => {
    const snapshot = [];
    signals.forEach((signal) => {
      if (!signal.enabled) return;
      if (!signal.hasSamples || !signal.buffer || signal.buffer.size === 0) return;
      const slice = extractWindowSlice(signal.buffer, window.start, window.end);
      if (!slice.times.length) return;
      const expanded = expandDegenerateRange({ min: signal.rangeMin, max: signal.rangeMax });
      snapshot.push({
        id: signal.id,
        color: signal.color,
        unit: signal.unit,
        displayName: signal.displayName,
        times: slice.times,
        values: slice.values,
        rangeMin: expanded.min,
        rangeMax: expanded.max,
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
      if (entry.rangeMin < min) min = entry.rangeMin;
      if (entry.rangeMax > max) max = entry.rangeMax;
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: -1, max: 1 };
    }
    return expandDegenerateRange({ min, max });
  };

  const clearAllSamples = () => {
    signals.forEach((signal) => {
      clearSignalBuffer(signal.buffer);
      signal.lastSampleTs = null;
      signal.avgInterval = null;
      signal.hasSamples = false;
    });
    lastSampleTimestamp = 0;
    remoteClockOffset = null;
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
    resetValueAxisScaling,
    autoScaleAxes,
    getDefaultTimePerDivision: () => initialTimePerDivision,
    clearAllSamples,
    ingestTraceEntry,
    ingestSignalValue,
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
