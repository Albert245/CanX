/**
 * @fileoverview Provides the Trace tab with an aggregated view of CAN traffic,
 * collapsing frames by ID and surfacing per-frame signal details on demand.
 */

const $ = (selector, ctx = document) => ctx.querySelector(selector);

const normalizeSignalDetail = (detail = {}) => {
  const name = typeof detail?.name === 'string' ? detail.name : '';
  const physical = detail?.physical_value ?? detail?.physicalValue ?? detail?.physical;
  const rawValue = detail?.raw_value ?? detail?.rawValue ?? detail?.raw;
  const rawHex = typeof detail?.raw_hex_value === 'string'
    ? detail.raw_hex_value
    : typeof detail?.rawHexValue === 'string'
      ? detail.rawHexValue
      : null;
  const named = detail?.named_value ?? detail?.namedValue ?? detail?.choice;
  return {
    name,
    physical,
    rawValue,
    rawHex,
    named,
  };
};

/**
 * Normalizes a trace payload from the server.
 * @param {object} msg
 * @returns {TraceEntry}
 */
const normalizeTraceMessage = (msg = {}) => {
  const tsRaw = Number(msg?.ts);
  const ts = Number.isFinite(tsRaw) ? tsRaw : Date.now() / 1000;
  const isFd = Boolean(msg?.is_fd);
  const frameType = typeof msg?.frame_type === 'string'
    ? msg.frame_type
    : isFd
      ? 'CAN FD'
      : 'CAN';
  const direction = typeof msg?.direction === 'string' ? msg.direction.toUpperCase() : 'RX';
  const frameName = typeof msg?.frame_name === 'string' ? msg.frame_name : null;
  const signals = Array.isArray(msg?.signals)
    ? msg.signals.map((detail) => normalizeSignalDetail(detail)).filter((detail) => detail.name)
    : [];
  return {
    ts,
    id: msg?.id ?? '',
    dlc: msg?.dlc ?? '',
    data: msg?.data ?? '',
    direction,
    frameType,
    isFd,
    frameName,
    decoded: msg?.decoded ?? null,
    signals,
  };
};

/**
 * @typedef {ReturnType<typeof normalizeTraceMessage>} TraceEntry
 */

const matchesFilter = (entry, filterValue) => {
  if (!filterValue) return true;
  const cleanFilter = filterValue.replace(/^0x/i, '');
  const id = String(entry.id || '').toLowerCase().replace(/^0x/i, '');
  return id.includes(cleanFilter);
};

const toNumericId = (id) => {
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  const text = String(id ?? '').trim();
  if (!text) return Number.POSITIVE_INFINITY;
  const base = text.startsWith('0x') || text.startsWith('0X') ? 16 : 10;
  const value = Number.parseInt(text, base);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

const formatDelta = (delta) => {
  if (!Number.isFinite(delta)) return '—';
  return delta.toFixed(6);
};

const trimTrailingZeros = (input) => String(input).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');

const formatSignalValue = (value) => {
  if (value == null) return '';
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
};

const formatPhysicalValue = (value) => {
  if (value == null) return '';
  const num = Number(value);
  if (Number.isFinite(num)) {
    return trimTrailingZeros(num.toFixed(6));
  }
  return formatSignalValue(value);
};

const formatRawDisplay = (rawHex, rawValue) => {
  const hex = typeof rawHex === 'string' && rawHex ? rawHex : null;
  const numeric = rawValue;
  if (hex && (Number.isInteger(numeric) || typeof numeric === 'string')) {
    return `${hex} (${numeric})`;
  }
  if (hex) return hex;
  if (numeric == null) return '';
  if (Number.isFinite(Number(numeric))) {
    const intVal = Number(numeric);
    return `0x${intVal.toString(16).toUpperCase()} (${intVal})`;
  }
  return formatSignalValue(numeric);
};

export function initTrace({ socket, getActiveTab, onTabChange }) {
  const tbody = $('#trace-table tbody');
  const statusEl = $('#trace-status');
  const filterInput = $('#trace-filter');
  const clearButton = $('#btn-trace-clear');

  const frames = new Map();
  let filterValue = '';
  let logRunning = false;

  const setStatus = (message, tone = 'info') => {
    if (!statusEl) return;
    if (!message) {
      statusEl.textContent = '';
      statusEl.hidden = true;
      statusEl.removeAttribute('data-tone');
      return;
    }
    statusEl.textContent = message;
    statusEl.hidden = false;
    statusEl.dataset.tone = tone;
  };

  const updateDetailContent = (record) => {
    const cell = record.detailCell;
    if (!cell) return;
    const signals = Array.isArray(record.signals) ? record.signals : [];
    cell.innerHTML = '';
    if (signals.length === 0) {
      const empty = document.createElement('div');
      empty.classList.add('trace-detail-empty');
      empty.textContent = 'No decoded signals';
      cell.appendChild(empty);
      return;
    }
    const table = document.createElement('table');
    table.classList.add('trace-detail-table');
    const colgroup = document.createElement('colgroup');
    const cols = [
      { className: 'trace-detail-col-signal' },
      { className: 'trace-detail-col-physical' },
      { className: 'trace-detail-col-raw' },
      { className: 'trace-detail-col-named' },
    ];
    for (const spec of cols) {
      const col = document.createElement('col');
      col.className = spec.className;
      colgroup.appendChild(col);
    }
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Signal</th><th>Physical</th><th>Raw (Hex)</th><th>Named</th></tr>';
    const tbodyEl = document.createElement('tbody');
    for (const detail of signals) {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = detail.name || '';
      const physicalCell = document.createElement('td');
      physicalCell.textContent = formatPhysicalValue(detail.physical);
      const rawCell = document.createElement('td');
      rawCell.textContent = formatRawDisplay(detail.rawHex, detail.rawValue);
      const namedCell = document.createElement('td');
      namedCell.textContent = formatSignalValue(detail.named);
      row.append(nameCell, physicalCell, rawCell, namedCell);
      tbodyEl.appendChild(row);
    }
    table.append(colgroup, thead, tbodyEl);
    cell.appendChild(table);
  };

  const setExpanded = (record, expanded) => {
    record.expanded = expanded;
    if (record.row) {
      record.row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    if (record.detailRow) {
      record.detailRow.hidden = !expanded || !record.matches;
    }
    if (expanded) {
      updateDetailContent(record);
    }
  };

  const updateVisibility = (record) => {
    const entry = record.lastEntry || { id: record.id };
    record.matches = matchesFilter(entry, filterValue);
    record.row.hidden = !record.matches;
    if (record.detailRow) {
      record.detailRow.hidden = !record.matches || !record.expanded;
    }
  };

  const renderAll = () => {
    if (!tbody) return;
    const records = Array.from(frames.values());
    records.sort((a, b) => {
      const diff = toNumericId(a.id) - toNumericId(b.id);
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
    tbody.innerHTML = '';
    for (const record of records) {
      updateVisibility(record);
      tbody.appendChild(record.row);
      tbody.appendChild(record.detailRow);
    }
    const row = document.createElement('tr');
    row.dataset.frameId = id;

    const deltaCell = document.createElement('td');
    const directionCell = document.createElement('td');
    const frameTypeCell = document.createElement('td');
    const idCell = document.createElement('td');
    const nameCell = document.createElement('td');
    const dlcCell = document.createElement('td');
    const dataCell = document.createElement('td');
    const signalCell = document.createElement('td');
    const valueCell = document.createElement('td');

    const select = document.createElement('select');
    select.classList.add('trace-signal-select');
    const valueSpan = document.createElement('span');
    valueSpan.classList.add('trace-signal-value');

    signalCell.appendChild(select);
    valueCell.appendChild(valueSpan);

    row.append(
      deltaCell,
      directionCell,
      frameTypeCell,
      idCell,
      nameCell,
      dlcCell,
      dataCell,
      signalCell,
      valueCell,
    );

  const ensureRecord = (id) => {
    if (frames.has(id)) {
      return frames.get(id);
    }
    const row = document.createElement('tr');
    row.classList.add('trace-summary-row');
    row.dataset.frameId = id;
    row.setAttribute('aria-expanded', 'false');
    row.tabIndex = 0;

    const deltaCell = document.createElement('td');
    const directionCell = document.createElement('td');
    const frameTypeCell = document.createElement('td');
    const idCell = document.createElement('td');
    const nameCell = document.createElement('td');
    const dlcCell = document.createElement('td');
    const dataCell = document.createElement('td');

    row.append(
      deltaCell,
      directionCell,
      frameTypeCell,
      idCell,
      nameCell,
      dlcCell,
      dataCell,
    );

    const detailRow = document.createElement('tr');
    detailRow.classList.add('trace-detail-row');
    detailRow.hidden = true;
    const detailCell = document.createElement('td');
    detailCell.colSpan = 7;
    detailRow.appendChild(detailCell);

    const record = {
      id,
      row,
      detailRow,
      detailCell,
      cells: {
        delta: deltaCell,
        direction: directionCell,
        frameType: frameTypeCell,
        id: idCell,
        frameName: nameCell,
        dlc: dlcCell,
        data: dataCell,
      },
      lastTs: null,
      lastEntry: null,
      decoded: null,
      signals: [],
      matches: true,
      expanded: false,
    };

    row.addEventListener('click', () => {
      setExpanded(record, !record.expanded);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setExpanded(record, !record.expanded);
      }
    });

    frames.set(id, record);
    renderAll();
    return record;
  };

  const updateRecord = (entry) => {
    const record = ensureRecord(entry.id ?? '');
    const previousTs = record.lastTs;
    record.lastTs = entry.ts;
    record.lastEntry = entry;
    const delta = previousTs != null ? Math.max(0, entry.ts - previousTs) : NaN;
    record.cells.delta.textContent = formatDelta(delta);
    record.cells.direction.textContent = entry.direction || '';
    record.cells.frameType.textContent = entry.frameType || (entry.isFd ? 'CAN FD' : 'CAN');
    record.cells.id.textContent = entry.id ?? '';
    record.cells.frameName.textContent = entry.frameName || '';
    record.cells.dlc.textContent = entry.dlc ?? '';
    record.cells.data.textContent = entry.data ?? '';
    record.decoded = entry.decoded && typeof entry.decoded === 'object' ? entry.decoded : null;
    record.signals = Array.isArray(entry.signals) ? entry.signals : [];
    if (record.expanded) {
      updateDetailContent(record);
    }
    updateVisibility(record);
  };

  const handleTraceMessage = (msg) => {
    const entry = normalizeTraceMessage(msg);
    updateRecord(entry);
  };

  const clearTrace = () => {
    frames.clear();
    if (tbody) {
      tbody.innerHTML = '';
    }
    renderAll();
  };

  filterInput?.addEventListener('input', (event) => {
    filterValue = String(event.target.value || '').trim().toLowerCase();
    frames.forEach((record) => {
      updateVisibility(record);
    });
  });

  clearButton?.addEventListener('click', () => {
    clearTrace();
  });

  socket.on('trace', handleTraceMessage);

  socket.on('trace_info', (msg) => {
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'running')) {
      const running = !!msg.running;
      if (running && !logRunning) {
        clearTrace();
      }
      logRunning = running;
    }
    if (msg?.info) {
      let tone = 'info';
      if (msg?.running) {
        tone = 'success';
      } else if (/already/i.test(msg.info)) {
        tone = 'warning';
      }
      setStatus(msg.info, tone);
    }
  });

  socket.on('trace_error', (msg) => {
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'running')) {
      logRunning = !!msg.running;
    }
    setStatus(msg?.error || 'Trace error', 'error');
  });

  socket.on('connected', (msg) => {
    logRunning = !!msg?.trace_running;
    if (!msg?.info) {
      setStatus('');
    }
    renderAll();
  });

  socket.on('disconnect', () => {
    setStatus('Socket disconnected. Live updates paused.', 'warning');
  });

  if (typeof onTabChange === 'function') {
    onTabChange('trace', renderAll);
  }

  setStatus('');
}
