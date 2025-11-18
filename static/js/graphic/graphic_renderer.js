const COLOR_BG = '#0c0f16';
const COLOR_GRID = 'rgba(255, 255, 255, 0.08)';
const COLOR_TEXT = 'rgba(255, 255, 255, 0.75)';

const niceNumber = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * 10 ** exponent;
};

const computeTicks = (min, max, maxTicks = 6) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, ticks: [0, 1], step: 1 };
  }
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.05, 0.5);
    min -= padding;
    max += padding;
  }
  const span = max - min;
  const step = niceNumber(span / Math.max(2, maxTicks - 1));
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return { min: niceMin, max: niceMax, ticks, step };
};

const formatTick = (value) => {
  if (!Number.isFinite(value)) return '—';
  const absValue = Math.abs(value);
  if (absValue >= 1000) return value.toFixed(0);
  if (absValue >= 100) return value.toFixed(1);
  if (absValue >= 1) return value.toFixed(2);
  if (absValue >= 0.1) return value.toFixed(3);
  return value.toPrecision(3);
};

const formatTimeLabel = (window, divisionIndex, divisions) => {
  const offset = (divisionIndex / divisions) * window.duration;
  const absolute = window.start + offset;
  const delta = window.end - absolute;
  if (delta <= 0.001) return '0s';
  if (delta >= 1) return `-${delta.toFixed(1)}s`;
  return `-${(delta * 1000).toFixed(delta >= 0.1 ? 0 : 1)}ms`;
};

const setCanvasSize = (canvas, width, height, dpr) => {
  if (!canvas) return;
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  if (canvas.style.width !== `${width}px`) {
    canvas.style.width = `${width}px`;
  }
  if (canvas.style.height !== `${height}px`) {
    canvas.style.height = `${height}px`;
  }
};

const buildSeriesPoints = (windowState, rect, series, yRange) => {
  const { times, values } = series;
  if (!times.length || rect.width <= 0 || rect.height <= 0) return [];
  if (!Number.isFinite(windowState.duration) || windowState.duration <= 0) return [];
  const denom = yRange.max - yRange.min || 1e-6;
  const points = [];
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    const v = values[i];
    const xRatio = (t - windowState.start) / windowState.duration;
    const yRatio = (v - yRange.min) / denom;
    const x = rect.x + xRatio * rect.width;
    const y = rect.y + rect.height - yRatio * rect.height;
    points.push({ x, y });
  }
  return points;
};

const drawStepSeries = (ctx, points, color) => {
  if (!points || !points.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  if (points.length >= 2) {
    ctx.beginPath();
    for (let i = 0; i < points.length - 1; i += 1) {
      const p1 = points[i];
      const p2 = points[i + 1];
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p1.y);
      if (p2.y !== p1.y) {
        ctx.moveTo(p2.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      }
    }
    ctx.stroke();
  }
  const dotRadius = 2.5;
  ctx.fillStyle = color;
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

import { formatZoomFactor } from './graphic_core.js';

const ensurePanel = (container, panelMap, signal) => {
  if (panelMap.has(signal.id)) {
    return panelMap.get(signal.id);
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'graphic-panel';
  wrapper.dataset.signalId = signal.id;

  const header = document.createElement('div');
  header.className = 'graphic-panel-header';
  const name = document.createElement('span');
  name.className = 'graphic-panel-name';
  const unit = document.createElement('span');
  unit.className = 'graphic-panel-unit';
  const zoom = document.createElement('span');
  zoom.className = 'graphic-panel-zoom';
  header.appendChild(name);
  header.appendChild(unit);
  header.appendChild(zoom);

  const canvas = document.createElement('canvas');
  canvas.className = 'graphic-panel-canvas';

  wrapper.appendChild(header);
  wrapper.appendChild(canvas);
  container.appendChild(wrapper);

  const ctx = canvas.getContext('2d');
  const panel = { wrapper, header, name, unit, zoom, canvas, ctx, width: 0, height: 0 };
  panelMap.set(signal.id, panel);
  return panel;
};

const removeStalePanels = (panelMap, activeIds) => {
  panelMap.forEach((panel, id) => {
    if (activeIds.has(id)) return;
    panel.wrapper.remove();
    panelMap.delete(id);
  });
};

export function createGraphicRenderer(core, options) {
  const { combinedCanvas, combinedContainer, separateContainer, placeholderEl, stageEl } = options;

  if (!combinedCanvas) throw new Error('Missing combined canvas');

  const ctx = combinedCanvas.getContext('2d');
  const panelMap = new Map();
  const dpr = window.devicePixelRatio || 1;
  let mode = 'combined';
  let rafId = null;
  let lastWidth = 0;
  let lastHeight = 0;
  stageEl?.setAttribute('data-mode', mode);

  const resizeObserver = new ResizeObserver(() => {
    lastWidth = 0;
    lastHeight = 0;
  });
  if (combinedContainer) {
    resizeObserver.observe(combinedContainer);
  }

  const getPlotRect = (width, height) => ({
    x: 60,
    y: 16,
    width: Math.max(0, width - 80),
    height: Math.max(0, height - 40),
  });

  const drawGrid = (ctx2d, rect, windowState, ticks, divisions) => {
    const tickValues = Array.isArray(ticks) && ticks.length ? ticks : [0, 1];
    const tickMin = tickValues[0];
    const tickMax = tickValues[tickValues.length - 1];
    const denom = tickMax - tickMin || 1;
    ctx2d.save();
    ctx2d.strokeStyle = COLOR_GRID;
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    for (let i = 0; i <= divisions; i += 1) {
      const x = rect.x + (i / divisions) * rect.width;
      ctx2d.moveTo(x, rect.y);
      ctx2d.lineTo(x, rect.y + rect.height);
    }
    tickValues.forEach((tick) => {
      const yRatio = (tick - tickMin) / denom;
      const y = rect.y + rect.height - yRatio * rect.height;
      ctx2d.moveTo(rect.x, y);
      ctx2d.lineTo(rect.x + rect.width, y);
    });
    ctx2d.stroke();
    ctx2d.restore();

    ctx2d.save();
    ctx2d.fillStyle = COLOR_TEXT;
    ctx2d.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx2d.textBaseline = 'middle';
    tickValues.forEach((tick) => {
      const yRatio = (tick - tickMin) / denom;
      const y = rect.y + rect.height - yRatio * rect.height;
      ctx2d.fillText(formatTick(tick), 8, y);
    });
    ctx2d.textBaseline = 'top';
    ctx2d.textAlign = 'center';
    for (let i = 0; i <= divisions; i += 1) {
      const label = formatTimeLabel(windowState, i, divisions);
      const x = rect.x + (i / divisions) * rect.width;
      ctx2d.fillText(label, x, rect.y + rect.height + 8);
    }
    ctx2d.restore();
  };

  const renderCombined = (windowState, signalsSnapshot) => {
    const container = combinedContainer || combinedCanvas.parentElement;
    const width = Math.floor(container?.clientWidth || combinedCanvas.clientWidth || 600);
    const height = Math.floor(container?.clientHeight || 360);
    if (width !== lastWidth || height !== lastHeight) {
      lastWidth = width;
      lastHeight = height;
      setCanvasSize(combinedCanvas, width, height, dpr);
    }
    const rect = getPlotRect(width, height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, width, height);

    const combinedRange = core.getCombinedRange(signalsSnapshot);
    const zoom = core.getCombinedVerticalZoom();
    const span = Math.max(combinedRange.max - combinedRange.min, 1e-6) * zoom;
    const center = (combinedRange.max + combinedRange.min) / 2;
    const yRange = { min: center - span / 2, max: center + span / 2 };
    const ticks = computeTicks(yRange.min, yRange.max, 6).ticks;
    drawGrid(ctx, rect, windowState, ticks, core.TIME_DIVISIONS || 10);

    signalsSnapshot.forEach((signal) => {
      const points = buildSeriesPoints(windowState, rect, signal, yRange);
      drawStepSeries(ctx, points, signal.color || '#4f8cff');
    });

    ctx.restore();
  };

  const renderSeparate = (windowState, signalsSnapshot) => {
    if (!separateContainer) return;
    signalsSnapshot.forEach((signal) => {
      const panel = ensurePanel(separateContainer, panelMap, signal);
      panel.name.textContent = signal.displayName;
      panel.unit.textContent = signal.unit ? `[${signal.unit}]` : '';
      panel.zoom.textContent = `Zoom ${formatZoomFactor(signal.verticalZoom)}`;
      const width =
        separateContainer.clientWidth ||
        separateContainer.getBoundingClientRect().width ||
        (combinedContainer?.clientWidth ?? 600);
      const height = 160;
      if (panel.width !== width || panel.height !== height) {
        panel.width = width;
        panel.height = height;
        setCanvasSize(panel.canvas, width, height, dpr);
      }
      const rect = getPlotRect(width, height);
      const ctx2d = panel.ctx;
      ctx2d.save();
      ctx2d.scale(dpr, dpr);
      ctx2d.clearRect(0, 0, width, height);
      ctx2d.fillStyle = COLOR_BG;
      ctx2d.fillRect(0, 0, width, height);
      const span = Math.max(signal.dataMax - signal.dataMin, 1e-6) * signal.verticalZoom;
      const center = (signal.dataMax + signal.dataMin) / 2;
      const yRange = { min: center - span / 2, max: center + span / 2 };
      const ticks = computeTicks(yRange.min, yRange.max, 5).ticks;
      drawGrid(ctx2d, rect, windowState, ticks, core.TIME_DIVISIONS || 10);
      const points = buildSeriesPoints(windowState, rect, signal, yRange);
      drawStepSeries(ctx2d, points, signal.color || '#4f8cff');
      ctx2d.restore();
    });
  };

  const renderFrame = () => {
    const windowState = core.getWindow();
    const signalsSnapshot = core.getRenderableSignals(windowState);
    if (placeholderEl) {
      placeholderEl.hidden = signalsSnapshot.length > 0;
    }
    const activeIds = new Set(signalsSnapshot.map((signal) => signal.id));
    removeStalePanels(panelMap, activeIds);
    if (mode === 'combined') {
      stageEl?.setAttribute('data-mode', 'combined');
      combinedContainer?.classList.add('is-active');
      separateContainer?.classList.remove('is-active');
      renderCombined(windowState, signalsSnapshot);
    } else {
      stageEl?.setAttribute('data-mode', 'separate');
      combinedContainer?.classList.remove('is-active');
      separateContainer?.classList.add('is-active');
      renderSeparate(windowState, signalsSnapshot);
    }
    rafId = window.requestAnimationFrame(renderFrame);
  };

  const start = () => {
    if (rafId != null) return;
    rafId = window.requestAnimationFrame(renderFrame);
  };

  const stop = () => {
    if (rafId != null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const setMode = (nextMode) => {
    mode = nextMode === 'separate' ? 'separate' : 'combined';
    stageEl?.setAttribute('data-mode', mode);
  };

  return {
    start,
    stop,
    setMode,
    getMode: () => mode,
  };
}
