const DEFAULT_COLUMNS = 32;
const DEFAULT_CELL_SIZE = 40;
const DEFAULT_GRID_GAP = 2;

const clampNumber = (value, min, max) => {
  let next = Number.parseInt(value, 10);
  if (Number.isNaN(next)) next = min;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
};

export class PanelGrid {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.columns = clampNumber(Math.max(options.columns ?? DEFAULT_COLUMNS, DEFAULT_COLUMNS), 1, 60);
    this.cellSize = clampNumber(Math.min(options.cellSize ?? DEFAULT_CELL_SIZE, DEFAULT_CELL_SIZE), 24, 160);
    this.gridGap = clampNumber(options.gridGap ?? DEFAULT_GRID_GAP, 0, 20);
    this.minimumRows = 15;
    this.extraRows = 5;
    this._syncStyles();
    this.ensureSpareRows();
  }

  _syncStyles() {
    if (!this.canvas) return;
    this.canvas.style.setProperty('--panel-cell-size', `${this.cellSize}px`);
    this.canvas.style.setProperty('--panel-grid-gap', `${this.gridGap}px`);
    this.canvas.style.setProperty('--panel-columns', this.columns);
    this.canvas.dataset.columns = String(this.columns);
  }

  setConfig({ columns, cellSize } = {}) {
    if (columns) {
      this.columns = clampNumber(Math.max(columns, DEFAULT_COLUMNS), DEFAULT_COLUMNS, 60);
    }
    if (cellSize) {
      this.cellSize = clampNumber(Math.min(cellSize, DEFAULT_CELL_SIZE), 24, 200);
    }
    this.gridGap = clampNumber(DEFAULT_GRID_GAP, 0, 20);
    this._syncStyles();
    this.ensureSpareRows();
  }

  toggleGrid(show) {
    if (!this.canvas) return;
    this.canvas.classList.toggle('panel-hide-grid', show === false);
  }

  ensureSpareRows(maxRow = 0) {
    if (!this.canvas) return;
    const rows = Math.max(this.minimumRows, Math.max(0, maxRow) + this.extraRows);
    const trackSize = this.cellSize + this.gridGap;
    const minHeight = trackSize * rows - this.gridGap;
    this.canvas.style.minHeight = `${minHeight}px`;
  }

  getCellFromEvent(event) {
    if (!this.canvas || !event) return null;
    const rect = this.canvas.getBoundingClientRect();
    const offsetX = (event.clientX ?? 0) - rect.left;
    const offsetY = (event.clientY ?? 0) - rect.top;
    if (offsetX < 0 || offsetY < 0) return null;
    const trackSize = this.cellSize + this.gridGap;
    const column = clampNumber(Math.floor(offsetX / trackSize) + 1, 1, this.columns);
    const row = Math.floor(offsetY / trackSize) + 1;
    return { x: column, y: row };
  }

  clampPosition(position, size = { w: 1, h: 1 }) {
    const pos = { ...position };
    pos.x = clampNumber(pos.x ?? 1, 1, this.columns);
    pos.y = clampNumber(pos.y ?? 1, 1, 999);
    const width = clampNumber(size.w ?? 1, 1, this.columns);
    const height = clampNumber(size.h ?? 1, 1, 200);
    const maxX = Math.max(1, this.columns - width + 1);
    if (pos.x > maxX) pos.x = maxX;
    if (pos.y < 1) pos.y = 1;
    return { pos, size: { w: width, h: height } };
  }

  applyPosition(widget, element) {
    if (!widget || !element) return;
    const { pos, size } = this.clampPosition(widget.pos || {}, widget.size || {});
    widget.pos = pos;
    widget.size = size;
    element.style.gridColumn = `${pos.x} / span ${size.w}`;
    element.style.gridRow = `${pos.y} / span ${size.h}`;
  }

  serialize() {
    return {
      columns: this.columns,
      cellSize: this.cellSize,
    };
  }
}
