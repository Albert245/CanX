const DEFAULT_COLUMNS = 20;
const DEFAULT_CELL_SIZE = 60;

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
    this.columns = clampNumber(options.columns ?? DEFAULT_COLUMNS, 1, 40);
    this.cellSize = clampNumber(options.cellSize ?? DEFAULT_CELL_SIZE, 30, 160);
    this.minimumRows = 15;
    this.extraRows = 5;
    this._syncStyles();
    this.ensureSpareRows();
  }

  _syncStyles() {
    if (!this.canvas) return;
    this.canvas.style.setProperty('--panel-cell-size', `${this.cellSize}px`);
    this.canvas.dataset.columns = String(this.columns);
  }

  setConfig({ columns, cellSize } = {}) {
    if (columns) {
      this.columns = clampNumber(columns, 1, 60);
    }
    if (cellSize) {
      this.cellSize = clampNumber(cellSize, 30, 200);
    }
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
    this.canvas.style.minHeight = `calc(var(--panel-cell-size) * ${rows})`;
  }

  getCellFromEvent(event) {
    if (!this.canvas || !event) return null;
    const rect = this.canvas.getBoundingClientRect();
    const offsetX = (event.clientX ?? 0) - rect.left;
    const offsetY = (event.clientY ?? 0) - rect.top;
    if (offsetX < 0 || offsetY < 0) return null;
    const column = clampNumber(Math.floor(offsetX / this.cellSize) + 1, 1, this.columns);
    const row = Math.floor(offsetY / this.cellSize) + 1;
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
