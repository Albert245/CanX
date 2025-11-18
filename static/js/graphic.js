let ChartConstructor = null;
let chartLoadFailed = false;
let chartModulePromise = null;
let chartUsesFallback = false;
let chartFallbackNotified = false;

const loadChartLibrary = () => {
  if (ChartConstructor || chartLoadFailed) {
    return ChartConstructor ? Promise.resolve(ChartConstructor) : Promise.resolve(null);
  }
  if (!chartModulePromise) {
    chartModulePromise = (async () => {
      if (window.Chart && typeof window.Chart.register === 'function') {
        try {
          const registerables = window.Chart.registerables || [];
          if (Array.isArray(registerables) && registerables.length) {
            window.Chart.register(...registerables);
          }
        } catch (err) {
          console.warn('Failed to register Chart.js components from global', err);
        }
        return window.Chart;
      }
      try {
        const module = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.esm.js');
        if (module?.Chart) {
          try {
            const registerables = module.registerables || [];
            if (Array.isArray(registerables) && registerables.length) {
              module.Chart.register(...registerables);
            }
          } catch (err) {
            console.warn('Failed to register Chart.js components', err);
          }
          return module.Chart;
        }
      } catch (err) {
        console.warn('Failed to load Chart.js module from CDN', err);
      }
      try {
        const fallbackModule = await import('./chartjs-fallback.js');
        if (fallbackModule?.Chart) {
          chartUsesFallback = true;
          return fallbackModule.Chart;
        }
      } catch (err) {
        console.error('Failed to load built-in chart renderer', err);
      }
      chartLoadFailed = true;
      return null;
    })().then((Chart) => {
      if (Chart) {
        ChartConstructor = Chart;
        chartLoadFailed = false;
      } else {
        chartLoadFailed = true;
      }
      return Chart;
    });
  }
  return chartModulePromise;
};

const $ = (selector, ctx = document) => ctx.querySelector(selector);
const $$ = (selector, ctx = document) => Array.from(ctx.querySelectorAll(selector));

const COLOR_PALETTE = [
  '#4f8cff',
  '#ff6b6b',
  '#ffd93b',
  '#6c5ce7',
  '#2ecc71',
  '#00cec9',
  '#ff9f1a',
  '#e84393',
  '#a29bfe',
  '#00b894',
];

const MAX_POINTS = 240;
const RESULT_LIMIT = 80;
const DEFAULT_TIME_WINDOW = 20;
const MIN_TIME_WINDOW = 1;
const MAX_TIME_WINDOW = 600;
const MIN_VALUE_ZOOM = 0.25;
const MAX_VALUE_ZOOM = 6;
const ZOOM_STEP = 1.1;

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeId = (value) => {
  if (!value) return '';
  return String(value).replace(/^0x/i, '').replace(/\s+/g, '').toUpperCase();
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const colorWithAlpha = (hex, alpha) => {
  if (!hex) return `rgba(79, 140, 255, ${alpha})`;
  const match = hex.trim().replace('#', '');
  if (match.length === 3) {
    const r = parseInt(match[0] + match[0], 16);
    const g = parseInt(match[1] + match[1], 16);
    const b = parseInt(match[2] + match[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (match.length === 6) {
    const r = parseInt(match.slice(0, 2), 16);
    const g = parseInt(match.slice(2, 4), 16);
    const b = parseInt(match.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(79, 140, 255, ${alpha})`;
};

const deriveMaxValue = (signal) => {
  const maximum = numberOrNull(signal.maximum);
  if (maximum !== null) return maximum;
  const scale = numberOrNull(signal.scale) ?? 1;
  const offset = numberOrNull(signal.offset) ?? 0;
  const rawUnsignedMax =
    numberOrNull(signal.raw_unsigned_max ?? signal.raw_max ?? signal.rawUnsignedMax) ?? null;
  if (rawUnsignedMax !== null) return rawUnsignedMax * scale + offset;
  const rawSignedMax =
    numberOrNull(signal.raw_signed_max ?? signal.rawSignedMax ?? signal.rawSignedMax) ?? null;
  if (rawSignedMax !== null) return rawSignedMax * scale + offset;
  const bitLength = numberOrNull(signal.bit_length ?? signal.bitLength);
  if (bitLength !== null && bitLength > 0) {
    const unsignedMax = Math.pow(2, bitLength) - 1;
    return unsignedMax * scale + offset;
  }
  return scale > 0 ? scale : 1;
};

const deriveMinValue = (signal, fallbackMax) => {
  const minimum = numberOrNull(signal.minimum);
  if (minimum !== null) return minimum;
  const scale = numberOrNull(signal.scale) ?? 1;
  const offset = numberOrNull(signal.offset) ?? 0;
  const rawUnsignedMin =
    numberOrNull(signal.raw_unsigned_min ?? signal.raw_min ?? signal.rawUnsignedMin) ?? null;
  if (rawUnsignedMin !== null) return rawUnsignedMin * scale + offset;
  const rawSignedMin =
    numberOrNull(signal.raw_signed_min ?? signal.rawSignedMin ?? signal.rawSignedMin) ?? null;
  if (rawSignedMin !== null) return rawSignedMin * scale + offset;
  if (Number.isFinite(offset)) return offset;
  if (Number.isFinite(fallbackMax) && fallbackMax > 0) return 0;
  return -1;
};

const createPlaceholder = (text) => {
  const li = document.createElement('li');
  li.className = 'graphic-result';
  li.textContent = text;
  li.tabIndex = -1;
  li.style.cursor = 'default';
  return li;
};

export function initGraphic({ socket, onTabChange }) {
  const refreshBtn = $('#btn-graphic-refresh');
  const searchInput = $('#graphic-search');
  const resultsList = $('#graphic-results');
  const selectedList = $('#graphic-selected');
  const statusEl = $('#graphic-status');
  const combinedWrapper = $('#graphic-combined-wrapper');
  const combinedCanvas = $('#graphic-combined-canvas');
  const separateContainer = $('#graphic-separate-container');
  const zoomInBtn = $('#graphic-zoom-in');
  const zoomOutBtn = $('#graphic-zoom-out');
  const zoomResetBtn = $('#graphic-zoom-reset');
  const modeInputs = $$('input[name="graphic-mode"]');

  let activeMode = modeInputs.find((input) => input.checked)?.value || 'combined';
  let signalIndex = [];
  const messageInfoCache = new Map();
  const watchers = new Map();
  const watchersByMessage = new Map();
  const colorPool = [...COLOR_PALETTE];
  let combinedChart = null;
  let combinedDatasets = new Map();
  let combinedNeedsRebuild = true;
  let combinedDirty = false;
  let separateCharts = new Map();
  let separateNeedsRebuild = true;
  let baseTimestamp = null;
  let latestTimestamp = 0;
  let chartUnavailableNotified = false;
  let timeWindowSeconds = DEFAULT_TIME_WINDOW;
  let valueZoomFactor = 1;

  loadChartLibrary();

  const setStatus = (message, tone = 'info') => {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.tone = tone;
  };

  const requireChart = () => {
    if (ChartConstructor) {
      if (chartUsesFallback && !chartFallbackNotified) {
        chartFallbackNotified = true;
        if (!statusEl?.textContent) {
          setStatus('Using built-in chart renderer.', 'info');
        } else {
          console.info('Graphic tab is using the built-in chart renderer.');
        }
      }
      return true;
    }
    loadChartLibrary();
    if (!chartUnavailableNotified && chartLoadFailed) {
      chartUnavailableNotified = true;
      setStatus('Unable to load chart rendering library. Graphs are unavailable.', 'error');
    }
    return false;
  };

  const ensureSignalIndex = async (force = false) => {
    if (!force && signalIndex.length) {
      return signalIndex;
    }
    if (refreshBtn) refreshBtn.disabled = true;
    setStatus('Loading DBC signals…', 'info');
    try {
      const response = await fetch('/api/dbc/messages');
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        const error = json?.error || response.statusText || 'Failed to load DBC messages';
        setStatus(error, 'error');
        signalIndex = [];
        return signalIndex;
      }
      const messages = Array.isArray(json.messages) ? json.messages : [];
      signalIndex = [];
      messages.forEach((msg) => {
        const msgName = msg?.name || '';
        const normalizedId = normalizeId(msg?.id_hex || msg?.id);
        if (!normalizedId) return;
        (Array.isArray(msg?.signals) ? msg.signals : []).forEach((sigName) => {
          signalIndex.push({
            messageName: msgName,
            messageId: normalizedId,
            signalName: sigName,
            idDisplay: msg?.id_hex || msg?.id || '',
          });
        });
      });
      if (!signalIndex.length) {
        setStatus('No signals found in the loaded DBC.', 'warning');
      } else {
        setStatus(`Loaded ${signalIndex.length} signals.`, 'success');
      }
      return signalIndex;
    } catch (error) {
      setStatus(error?.message || 'Failed to load DBC messages', 'error');
      signalIndex = [];
      return signalIndex;
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  };

  const renderResults = () => {
    if (!resultsList) return;
    const query = (searchInput?.value || '').trim().toLowerCase();
    resultsList.innerHTML = '';
    if (!signalIndex.length) {
      resultsList.appendChild(createPlaceholder('Load a DBC to search signals.'));
      return;
    }
    const matches = signalIndex.filter((entry) => {
      if (!query) return true;
      return [entry.signalName, entry.messageName, entry.idDisplay]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(query));
    }).slice(0, RESULT_LIMIT);
    if (!matches.length) {
      resultsList.appendChild(createPlaceholder('No signals match the current search.'));
      return;
    }
    matches.forEach((entry, idx) => {
      const li = document.createElement('li');
      li.className = 'graphic-result';
      li.dataset.index = String(signalIndex.indexOf(entry));
      li.tabIndex = 0;
      if (watchers.has(`${entry.messageName}::${entry.signalName}`)) {
        li.classList.add('is-added');
      }
      const name = document.createElement('span');
      name.className = 'graphic-result-name';
      name.textContent = entry.signalName;
      const meta = document.createElement('span');
      meta.className = 'graphic-result-meta';
      meta.textContent = `${entry.messageName}${entry.idDisplay ? ` · ${entry.idDisplay}` : ''}`;
      li.appendChild(name);
      li.appendChild(meta);
      resultsList.appendChild(li);
    });
  };

  const getSignalMetadata = async (messageName) => {
    if (messageInfoCache.has(messageName)) {
      return messageInfoCache.get(messageName);
    }
    const response = await fetch(`/api/dbc/message_info/${encodeURIComponent(messageName)}`);
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || response.statusText || 'Failed to load signal metadata');
    }
    const signals = Array.isArray(json?.message?.signals) ? json.message.signals : [];
    messageInfoCache.set(messageName, signals);
    return signals;
  };

  const computeSignalRange = (signal) => {
    let maxValue = deriveMaxValue(signal);
    let minValue = deriveMinValue(signal, maxValue);
    if (!Number.isFinite(maxValue)) {
      maxValue = 1;
    }
    if (!Number.isFinite(minValue)) {
      minValue = 0;
    }
    if (maxValue === minValue) {
      maxValue = minValue + 1;
    }
    return { minValue, maxValue };
  };

  const getWatcherDataRange = (watcher) => {
    if (!watcher) {
      return { min: 0, max: 1 };
    }
    const values = watcher.data
      ?.map((point) => point?.y)
      .filter((value) => Number.isFinite(value));
    if (!values?.length) {
      return { min: watcher.minValue, max: watcher.maxValue };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const padding = Math.max(Math.abs(min) * 0.05, 0.5);
      return { min: min - padding, max: max + padding };
    }
    return { min, max };
  };

  const applyValueZoomRange = ({ min, max }) => {
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) ? max : safeMin + 1;
    const center = (safeMin + safeMax) / 2;
    const baseRange = Math.max(Math.abs(safeMax - safeMin), 0.1);
    const scaledRange = baseRange * valueZoomFactor;
    return { min: center - scaledRange / 2, max: center + scaledRange / 2 };
  };

  const getWatcherDisplayRange = (watcher) => applyValueZoomRange(getWatcherDataRange(watcher));

  const getTimeBounds = () => {
    const end = latestTimestamp > 0 ? latestTimestamp : timeWindowSeconds;
    const start = Math.max(0, end - timeWindowSeconds);
    if (end <= start) {
      return { start: 0, end: start + timeWindowSeconds };
    }
    return { start, end };
  };

  const syncCombinedScales = () => {
    if (!combinedChart?.options?.scales) return;
    const { start, end } = getTimeBounds();
    if (combinedChart.options.scales.x) {
      combinedChart.options.scales.x.min = start;
      combinedChart.options.scales.x.max = end;
    }
    watchers.forEach((watcher) => {
      if (!watcher.enabled) return;
      const axisId = `y_${watcher.key}`;
      const scale = combinedChart.options.scales[axisId];
      if (!scale) return;
      const { min, max } = getWatcherDisplayRange(watcher);
      scale.min = min;
      scale.max = max;
    });
  };

  const updateAllSeparateCharts = () => {
    separateCharts.forEach((_, key) => updateSeparateChart(key));
  };

  const adjustTimeWindow = (factor) => {
    timeWindowSeconds = clamp(timeWindowSeconds * factor, MIN_TIME_WINDOW, MAX_TIME_WINDOW);
    if (activeMode === 'combined') {
      syncCombinedScales();
      markCombinedDirty();
      flushCombinedUpdates();
    }
    updateAllSeparateCharts();
  };

  const adjustValueZoom = (factor) => {
    valueZoomFactor = clamp(valueZoomFactor * factor, MIN_VALUE_ZOOM, MAX_VALUE_ZOOM);
    if (activeMode === 'combined') {
      syncCombinedScales();
      markCombinedDirty();
      flushCombinedUpdates();
    }
    updateAllSeparateCharts();
  };

  const resetZoomState = () => {
    timeWindowSeconds = DEFAULT_TIME_WINDOW;
    valueZoomFactor = 1;
    if (activeMode === 'combined') {
      syncCombinedScales();
      markCombinedDirty();
      flushCombinedUpdates();
    }
    updateAllSeparateCharts();
  };

  const createWatcher = (entry, meta) => {
    const key = `${entry.messageName}::${entry.signalName}`;
    if (watchers.has(key)) {
      setStatus(`${entry.signalName} is already selected.`, 'info');
      return null;
    }
    const color = colorPool.shift() || colorPool[Math.floor(Math.random() * colorPool.length)] || '#4f8cff';
    const { minValue, maxValue } = computeSignalRange(meta);
    const watcher = {
      key,
      messageName: entry.messageName,
      messageId: entry.messageId,
      signalName: entry.signalName,
      unit: meta?.unit || '',
      color,
      data: [],
      minValue,
      maxValue,
      enabled: true,
    };
    watchers.set(key, watcher);
    if (!watchersByMessage.has(entry.messageId)) {
      watchersByMessage.set(entry.messageId, new Set());
    }
    watchersByMessage.get(entry.messageId)?.add(key);
    setStatus(`Added ${entry.signalName} from ${entry.messageName}.`, 'success');
    return watcher;
  };

  const renderSelectedSignals = () => {
    if (!selectedList) return;
    selectedList.innerHTML = '';
    watchers.forEach((watcher) => {
      const li = document.createElement('li');
      li.className = 'graphic-selected-item';
      li.dataset.key = watcher.key;
      li.tabIndex = 0;
      li.style.setProperty('--signal-color', watcher.color);

      const label = document.createElement('label');
      label.className = 'graphic-selected-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'graphic-enable';
      checkbox.checked = watcher.enabled;
      checkbox.dataset.key = watcher.key;
      const name = document.createElement('span');
      name.className = 'graphic-selected-name';
      name.textContent = watcher.signalName;
      const meta = document.createElement('span');
      meta.className = 'graphic-selected-meta';
      meta.textContent = watcher.unit
        ? `${watcher.messageName} · ${watcher.unit}`
        : watcher.messageName;
      label.appendChild(checkbox);
      label.appendChild(name);
      label.appendChild(meta);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'graphic-remove';
      removeBtn.dataset.key = watcher.key;
      removeBtn.textContent = 'Del';
      removeBtn.setAttribute('aria-label', 'Remove signal');

      li.appendChild(label);
      li.appendChild(removeBtn);
      selectedList.appendChild(li);
    });
  };

  const rebuildCombinedChart = () => {
    if (!combinedCanvas) return;
    if (!requireChart()) {
      if (combinedChart) {
        try {
          combinedChart.destroy();
        } catch (err) {
          console.warn('Failed to destroy combined chart', err);
        }
        combinedChart = null;
      }
      combinedNeedsRebuild = true;
      combinedDirty = false;
      return;
    }
    if (combinedChart) {
      combinedChart.destroy();
    }
    combinedDatasets = new Map();
    const datasets = [];
    const { start, end } = getTimeBounds();
    const scales = {
      x: {
        type: 'linear',
        min: start,
        max: end,
        title: { display: true, text: 'Time (s)', color: '#9aa0a6' },
        ticks: { color: '#9aa0a6' },
        grid: { color: '#2a2f3a' },
      },
    };
    let leftSide = true;
    watchers.forEach((watcher) => {
      if (!watcher.enabled) return;
      const axisId = `y_${watcher.key}`;
      const { min, max } = getWatcherDisplayRange(watcher);
      scales[axisId] = {
        type: 'linear',
        position: leftSide ? 'left' : 'right',
        min,
        max,
        ticks: { color: '#9aa0a6' },
        grid: { color: leftSide ? '#2a2f3a' : 'transparent' },
        title: {
          display: true,
          text: watcher.unit ? `${watcher.signalName} (${watcher.unit})` : watcher.signalName,
          color: '#9aa0a6',
        },
      };
      leftSide = !leftSide;
      const dataset = {
        label: `${watcher.signalName} · ${watcher.messageName}`,
        data: watcher.data,
        parsing: false,
        borderColor: watcher.color,
        backgroundColor: colorWithAlpha(watcher.color, 0.25),
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 0,
        yAxisID: axisId,
      };
      datasets.push(dataset);
      combinedDatasets.set(watcher.key, dataset);
    });
    if (!datasets.length) {
      combinedChart = null;
      combinedNeedsRebuild = false;
      combinedDirty = false;
      return;
    }
    combinedChart = new ChartConstructor(combinedCanvas.getContext('2d'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales,
        plugins: {
          legend: {
            labels: {
              color: '#e6e6e6',
            },
          },
        },
      },
    });
    combinedNeedsRebuild = false;
    combinedDirty = false;
  };

  const ensureCombinedChart = () => {
    if (activeMode !== 'combined') return;
    if (combinedNeedsRebuild) {
      rebuildCombinedChart();
    }
  };

  const markCombinedDirty = () => {
    if (activeMode !== 'combined') return;
    syncCombinedScales();
    combinedDirty = true;
  };

  const flushCombinedUpdates = () => {
    if (activeMode !== 'combined') return;
    if (combinedDirty && combinedChart) {
      combinedChart.update('none');
      combinedDirty = false;
    }
  };

  const rebuildSeparateCharts = () => {
    if (!separateContainer) return;
    const chartAvailable = requireChart();
    separateContainer.innerHTML = '';
    separateCharts.forEach(({ chart }) => {
      try {
        chart.destroy();
      } catch (err) {
        // ignore chart destroy errors
      }
    });
    separateCharts = new Map();
    watchers.forEach((watcher) => {
      const card = document.createElement('div');
      card.className = 'graphic-chart-card';
      if (!watcher.enabled) card.classList.add('is-disabled');
      const title = document.createElement('div');
      title.className = 'graphic-result-name';
      title.textContent = `${watcher.signalName} · ${watcher.messageName}`;
      const meta = document.createElement('div');
      meta.className = 'graphic-result-meta';
      meta.textContent = watcher.unit ? `Unit: ${watcher.unit}` : '';
      card.appendChild(title);
      if (meta.textContent) card.appendChild(meta);
      if (chartAvailable) {
        const canvas = document.createElement('canvas');
        card.appendChild(canvas);
        separateContainer.appendChild(card);
        const { min, max } = getWatcherDisplayRange(watcher);
        const { start, end } = getTimeBounds();
        const chart = new ChartConstructor(canvas.getContext('2d'), {
          type: 'line',
          data: {
            datasets: [
              {
                label: watcher.signalName,
                data: watcher.data,
                parsing: false,
                borderColor: watcher.color,
                backgroundColor: colorWithAlpha(watcher.color, 0.25),
                borderWidth: 2,
                tension: 0.2,
                pointRadius: 0,
                hidden: !watcher.enabled,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
              x: {
                type: 'linear',
                min: start,
                max: end,
                title: { display: true, text: 'Time (s)', color: '#9aa0a6' },
                ticks: { color: '#9aa0a6' },
                grid: { color: '#2a2f3a' },
              },
              y: {
                type: 'linear',
                min,
                max,
                ticks: { color: '#9aa0a6' },
                grid: { color: '#2a2f3a' },
              },
            },
            plugins: {
              legend: { display: false },
            },
          },
        });
        separateCharts.set(watcher.key, { chart, card });
      } else {
        const message = document.createElement('div');
        message.className = 'graphic-chart-unavailable';
        message.textContent = 'Chart rendering unavailable.';
        card.appendChild(message);
        separateContainer.appendChild(card);
        separateCharts.set(watcher.key, { chart: null, card });
      }
    });
    separateNeedsRebuild = !chartAvailable;
  };

  const ensureSeparateCharts = () => {
    if (activeMode !== 'separate') return;
    if (separateNeedsRebuild) {
      rebuildSeparateCharts();
    }
  };

  const updateSeparateChart = (key) => {
    const entry = separateCharts.get(key);
    if (!entry) return;
    const watcher = watchers.get(key);
    if (!watcher) return;
    entry.card.classList.toggle('is-disabled', !watcher.enabled);
    if (!entry.chart) {
      return;
    }
    const dataset = entry.chart.data.datasets[0];
    dataset.data = watcher.data;
    dataset.hidden = !watcher.enabled;
    const { min, max } = getWatcherDisplayRange(watcher);
    const { start, end } = getTimeBounds();
    if (entry.chart.options?.scales?.x) {
      entry.chart.options.scales.x.min = start;
      entry.chart.options.scales.x.max = end;
    }
    if (entry.chart.options?.scales?.y) {
      entry.chart.options.scales.y.min = min;
      entry.chart.options.scales.y.max = max;
    }
    entry.chart.update('none');
  };

  const applyMode = (mode) => {
    activeMode = mode;
    if (combinedWrapper) {
      combinedWrapper.style.display = mode === 'combined' ? 'block' : 'none';
    }
    if (separateContainer) {
      separateContainer.style.display = mode === 'separate' ? 'grid' : 'none';
    }
    if (mode === 'combined') {
      combinedNeedsRebuild = true;
      ensureCombinedChart();
    } else {
      separateNeedsRebuild = true;
      ensureSeparateCharts();
    }
  };

  modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        applyMode(input.value);
      }
    });
  });

  const removeWatcher = (key) => {
    const watcher = watchers.get(key);
    if (!watcher) return;
    watchers.delete(key);
    const set = watchersByMessage.get(watcher.messageId);
    set?.delete(key);
    if (set && !set.size) {
      watchersByMessage.delete(watcher.messageId);
    }
    colorPool.push(watcher.color);
    if (!watchers.size) {
      baseTimestamp = null;
      latestTimestamp = 0;
      resetZoomState();
    }
    combinedNeedsRebuild = true;
    separateNeedsRebuild = true;
    renderSelectedSignals();
    renderResults();
    if (activeMode === 'combined') {
      ensureCombinedChart();
      flushCombinedUpdates();
    } else {
      ensureSeparateCharts();
    }
  };

  const toggleWatcher = (key, enabled) => {
    const watcher = watchers.get(key);
    if (!watcher) return;
    watcher.enabled = enabled;
    combinedNeedsRebuild = true;
    separateNeedsRebuild = true;
    renderSelectedSignals();
    renderResults();
    if (activeMode === 'combined') {
      ensureCombinedChart();
      flushCombinedUpdates();
    } else {
      ensureSeparateCharts();
    }
  };

  const addSignal = async (entry) => {
    if (!entry) return;
    try {
      const signals = await getSignalMetadata(entry.messageName);
      const meta = signals.find((sig) => sig.name === entry.signalName);
      if (!meta) {
        setStatus(`Unable to locate metadata for ${entry.signalName}.`, 'error');
        return;
      }
      const watcher = createWatcher(entry, meta);
      if (!watcher) return;
      renderSelectedSignals();
      renderResults();
      combinedNeedsRebuild = true;
      separateNeedsRebuild = true;
      if (activeMode === 'combined') {
        ensureCombinedChart();
      } else {
        ensureSeparateCharts();
      }
    } catch (error) {
      setStatus(error?.message || 'Failed to add signal', 'error');
    }
  };

  const captureResultActivation = (event) => {
    const item = event.target.closest('.graphic-result');
    if (!item || item.classList.contains('is-added')) return;
    const index = Number(item.dataset.index);
    if (Number.isNaN(index)) return;
    const entry = signalIndex[index];
    addSignal(entry);
  };

  resultsList?.addEventListener('click', captureResultActivation);
  resultsList?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      captureResultActivation(event);
    }
  });

  selectedList?.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.classList.contains('graphic-enable')) return;
    const key = event.target.dataset.key;
    toggleWatcher(key, event.target.checked);
  });

  selectedList?.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.classList.contains('graphic-remove')) {
      const key = event.target.dataset.key;
      removeWatcher(key);
    }
  });

  selectedList?.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete') return;
    const item = event.target.closest('.graphic-selected-item');
    if (!item) return;
    event.preventDefault();
    const key = item.dataset.key;
    removeWatcher(key);
  });

  refreshBtn?.addEventListener('click', async () => {
    await ensureSignalIndex(true);
    renderResults();
  });

  searchInput?.addEventListener('input', renderResults);

  const handleCanvasWheel = (event) => {
    if (!watchers.size) return;
    event.preventDefault();
    const isHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = isHorizontal ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    const factor = delta > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    if (isHorizontal) {
      adjustTimeWindow(factor);
    } else {
      adjustValueZoom(factor);
    }
  };

  combinedWrapper?.addEventListener('wheel', handleCanvasWheel, { passive: false });
  zoomInBtn?.addEventListener('click', () => adjustTimeWindow(1 / ZOOM_STEP));
  zoomOutBtn?.addEventListener('click', () => adjustTimeWindow(ZOOM_STEP));
  zoomResetBtn?.addEventListener('click', resetZoomState);

  const recordDataPoint = (watcher, value) => {
    const now = Date.now();
    if (baseTimestamp === null) {
      baseTimestamp = now;
    }
    const timeSeconds = (now - baseTimestamp) / 1000;
    watcher.data.push({ x: timeSeconds, y: value });
    if (watcher.data.length > MAX_POINTS) {
      watcher.data.splice(0, watcher.data.length - MAX_POINTS);
    }
    latestTimestamp = Math.max(latestTimestamp, timeSeconds);
  };

  const handleTrace = (payload) => {
    if (!watchers.size) return;
    const decoded = payload?.decoded;
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return;
    const normalizedId = normalizeId(payload?.id);
    if (!normalizedId) return;
    const keys = watchersByMessage.get(normalizedId);
    if (!keys || !keys.size) return;
    const updatedKeys = [];
    keys.forEach((key) => {
      const watcher = watchers.get(key);
      if (!watcher || !watcher.enabled) return;
      const value = decoded?.[watcher.signalName];
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      recordDataPoint(watcher, numeric);
      updatedKeys.push(key);
    });
    if (!updatedKeys.length) return;
    if (activeMode === 'combined') {
      ensureCombinedChart();
      updatedKeys.forEach((key) => {
        const dataset = combinedDatasets.get(key);
        if (!dataset) {
          combinedNeedsRebuild = true;
          return;
        }
      });
      if (combinedNeedsRebuild) {
        rebuildCombinedChart();
      }
      markCombinedDirty();
      flushCombinedUpdates();
    } else {
      ensureSeparateCharts();
      updatedKeys.forEach((key) => updateSeparateChart(key));
    }
  };

  loadChartLibrary().then((Chart) => {
    if (!Chart) return;
    if (chartUnavailableNotified) {
      setStatus('Chart rendering library loaded. Graphs are available.', 'success');
    }
    chartUnavailableNotified = false;
    combinedNeedsRebuild = true;
    separateNeedsRebuild = true;
    if (activeMode === 'combined') {
      rebuildCombinedChart();
      flushCombinedUpdates();
    } else if (activeMode === 'separate') {
      rebuildSeparateCharts();
    }
  });

  socket.on('trace', handleTrace);

  const initialize = async () => {
    await ensureSignalIndex(false);
    renderResults();
    renderSelectedSignals();
    applyMode(activeMode);
  };

  onTabChange?.('graphic', () => {
    renderSelectedSignals();
    renderResults();
    if (activeMode === 'combined') {
      ensureCombinedChart();
    } else {
      ensureSeparateCharts();
    }
  });

  initialize();
}
