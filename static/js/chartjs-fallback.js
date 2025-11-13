const DEFAULT_COLORS = {
  axis: '#2a2f3a',
  axisLabel: '#9aa0a6',
  legendText: '#e6e6e6',
};

const ensureNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getBounds = (canvas) => {
  const parent = canvas.parentElement;
  if (!parent) {
    const width = canvas.width || 600;
    const height = canvas.height || 300;
    return { width, height };
  }
  const rect = parent.getBoundingClientRect();
  const width = Math.max(1, rect.width || canvas.width || 600);
  const height = Math.max(1, rect.height || canvas.height || 300);
  return { width, height };
};

const prepareCanvasSize = (canvas) => {
  const { width, height } = getBounds(canvas);
  const ratio = window.devicePixelRatio || 1;
  const displayWidth = Math.max(1, Math.round(width));
  const displayHeight = Math.max(1, Math.round(height));
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  canvas.width = displayWidth * ratio;
  canvas.height = displayHeight * ratio;
  return { width: displayWidth, height: displayHeight, ratio };
};

const isPointDataset = (dataset) =>
  Array.isArray(dataset?.data) && dataset.data.some((point) => point && typeof point === 'object');

const getScaleRange = (scaleConfig, fallbackMin, fallbackMax) => {
  if (!scaleConfig) {
    return { min: fallbackMin, max: fallbackMax };
  }
  const min = ensureNumber(scaleConfig.min ?? scaleConfig.suggestedMin, fallbackMin);
  const max = ensureNumber(scaleConfig.max ?? scaleConfig.suggestedMax, fallbackMax);
  if (min === max) {
    if (max === 0) {
      return { min: -1, max: 1 };
    }
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
};

const drawAxes = (ctx, width, height, padding) => {
  ctx.save();
  ctx.strokeStyle = DEFAULT_COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();
  ctx.restore();
};

const drawLegend = (ctx, datasets, padding) => {
  if (!datasets.length) return;
  const legendX = padding.left + 8;
  const legendY = padding.top + 12;
  const lineHeight = 16;
  ctx.save();
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'middle';
  datasets.forEach((dataset, index) => {
    const y = legendY + index * lineHeight;
    ctx.fillStyle = dataset.borderColor || '#4f8cff';
    ctx.fillRect(legendX, y - 4, 12, 8);
    ctx.fillStyle = DEFAULT_COLORS.legendText;
    const label = dataset.label || `Series ${index + 1}`;
    ctx.fillText(label, legendX + 18, y);
  });
  ctx.restore();
};

const drawTimeSeries = (ctx, chart, width, height) => {
  const datasets = chart.data.datasets || [];
  const options = chart.options || {};
  const scales = options.scales || {};
  const padding = { top: 32, right: 20, bottom: 32, left: 64 };
  ctx.save();
  ctx.setTransform(chart._ratio, 0, 0, chart._ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, width, height, padding);
  const allPoints = datasets.flatMap((dataset) =>
    (dataset.data || []).filter((point) => point && typeof point.x === 'number'),
  );
  const xValues = allPoints.map((point) => point.x);
  const xMin = Math.min(...xValues, 0);
  const xMax = Math.max(...xValues, xMin + 1);
  const xRange = xMax - xMin || 1;
  datasets.forEach((dataset) => {
    const data = (dataset.data || []).filter((point) => point && typeof point.x === 'number');
    if (!data.length) return;
    const axisId = dataset.yAxisID || 'y';
    const scale = scales[axisId];
    const yValues = data.map((point) => point.y);
    const yMinDefault = Math.min(...yValues, 0);
    const yMaxDefault = Math.max(...yValues, yMinDefault + 1);
    const { min: yMin, max: yMax } = getScaleRange(scale, yMinDefault, yMaxDefault);
    const yRange = yMax - yMin || 1;
    ctx.beginPath();
    data.forEach((point, index) => {
      const xNorm = (point.x - xMin) / xRange;
      const yNorm = (point.y - yMin) / yRange;
      const x = padding.left + xNorm * (width - padding.left - padding.right);
      const y = height - padding.bottom - yNorm * (height - padding.top - padding.bottom);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.lineWidth = ensureNumber(dataset.borderWidth, 2);
    ctx.strokeStyle = dataset.borderColor || '#4f8cff';
    ctx.stroke();
  });
  drawLegend(ctx, datasets, padding);
  ctx.restore();
};

const drawCategorySeries = (ctx, chart, width, height) => {
  const datasets = chart.data.datasets || [];
  const dataset = datasets[0];
  if (!dataset) {
    ctx.save();
    ctx.setTransform(chart._ratio, 0, 0, chart._ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.restore();
    return;
  }
  const values = dataset.data || [];
  const labels = chart.data.labels || values.map((_, index) => `${index}`);
  const options = chart.options || {};
  const padding = { top: 24, right: 20, bottom: 40, left: 64 };
  ctx.save();
  ctx.setTransform(chart._ratio, 0, 0, chart._ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, width, height, padding);
  const scale = options.scales?.y || {};
  const valueMinDefault = Math.min(...values, 0);
  const valueMaxDefault = Math.max(...values, valueMinDefault + 1);
  const { min: yMin, max: yMax } = getScaleRange(scale, valueMinDefault, valueMaxDefault);
  const yRange = yMax - yMin || 1;
  const innerWidth = width - padding.left - padding.right;
  const step = values.length > 1 ? innerWidth / (values.length - 1) : innerWidth;
  ctx.beginPath();
  values.forEach((value, index) => {
    if (dataset.hidden) return;
    const yNorm = (value - yMin) / yRange;
    const x = padding.left + index * step;
    const y = height - padding.bottom - yNorm * (height - padding.top - padding.bottom);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.lineWidth = ensureNumber(dataset.borderWidth, 2);
  ctx.strokeStyle = dataset.borderColor || '#4f8cff';
  ctx.stroke();
  ctx.fillStyle = DEFAULT_COLORS.axisLabel;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelStep = values.length > 1 ? innerWidth / (values.length - 1) : innerWidth;
  labels.forEach((label, index) => {
    const x = padding.left + index * labelStep;
    const y = height - padding.bottom + 6;
    ctx.fillText(String(label), x, y);
  });
  ctx.restore();
};

export class Chart {
  static register() {}

  static unregister() {}

  constructor(context, config = {}) {
    if (!context || typeof context.canvas === 'undefined') {
      throw new Error('A 2D rendering context is required');
    }
    this.ctx = context;
    this.canvas = context.canvas;
    this.type = config.type || 'line';
    this.data = config.data || { datasets: [] };
    this.options = config.options || {};
    this._destroyed = false;
    const size = prepareCanvasSize(this.canvas);
    this._width = size.width;
    this._height = size.height;
    this._ratio = size.ratio;
    this._resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._destroyed) return;
        const updated = prepareCanvasSize(this.canvas);
        this._width = updated.width;
        this._height = updated.height;
        this._ratio = updated.ratio;
        this.render();
      });
      this._resizeObserver.observe(this.canvas.parentElement || this.canvas);
    }
    this.render();
  }

  render() {
    if (this._destroyed) return;
    const width = this._width;
    const height = this._height;
    if (!width || !height) return;
    const dataset = this.data.datasets?.[0];
    if (!dataset) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this._ratio, 0, 0, this._ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.restore();
      return;
    }
    if (isPointDataset(dataset)) {
      drawTimeSeries(this.ctx, this, width, height);
    } else {
      drawCategorySeries(this.ctx, this, width, height);
    }
  }

  update() {
    this.render();
  }

  destroy() {
    this._destroyed = true;
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    const width = this._width;
    const height = this._height;
    if (width && height) {
      this.ctx.save();
      this.ctx.setTransform(this._ratio, 0, 0, this._ratio, 0, 0);
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.restore();
    }
  }
}

export const registerables = [];
