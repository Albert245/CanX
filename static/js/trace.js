/**
 * @fileoverview Provides the Trace tab with an aggregated view of CAN traffic,
 * collapsing frames by ID and surfacing per-signal decode controls.
 */

const $ = (selector, ctx = document) => ctx.querySelector(selector);

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
      record.row.hidden = !record.matches;
      tbody.appendChild(record.row);
    }
  };

  const updateVisibility = (record) => {
    const entry = record.lastEntry || { id: record.id };
    record.matches = matchesFilter(entry, filterValue);
    record.row.hidden = !record.matches;
  };

  const refreshSignalValue = (record) => {
    const select = record.signalSelect;
    const valueEl = record.signalValue;
    const key = select?.value;
    if (!select || !valueEl) return;
    if (!key) {
      valueEl.textContent = '';
      return;
    }
    const decoded = record.decoded && typeof record.decoded === 'object' ? record.decoded : null;
    if (!decoded || !Object.prototype.hasOwnProperty.call(decoded, key)) {
      valueEl.textContent = '';
      return;
    }
    valueEl.textContent = formatSignalValue(decoded[key]);
  };

  const refreshSignalOptions = (record) => {
    const select = record.signalSelect;
    if (!select) return;
    const decoded = record.decoded && typeof record.decoded === 'object' ? record.decoded : null;
    const entries = decoded ? Object.entries(decoded) : [];
    const sorted = entries
      .filter(([name]) => typeof name === 'string' && name.trim().length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const previous = select.value;
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = sorted.length ? 'Select signal' : 'No decoded signals';
    placeholder.disabled = sorted.length === 0;
    select.appendChild(placeholder);

    for (const [name] of sorted) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }

    if (sorted.length === 0) {
      select.value = '';
      select.disabled = true;
    } else {
      select.disabled = false;
      if (previous && sorted.some(([name]) => name === previous)) {
        select.value = previous;
      } else {
        select.value = sorted[0][0];
      }
    }
    refreshSignalValue(record);
  };

  const ensureRecord = (id) => {
    if (frames.has(id)) {
      return frames.get(id);
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

    const record = {
      id,
      row,
      cells: {
        delta: deltaCell,
        direction: directionCell,
        frameType: frameTypeCell,
        id: idCell,
        frameName: nameCell,
        dlc: dlcCell,
        data: dataCell,
      },
      signalSelect: select,
      signalValue: valueSpan,
      lastTs: null,
      lastEntry: null,
      decoded: null,
      matches: true,
    };

    select.addEventListener('change', () => refreshSignalValue(record));

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
    refreshSignalOptions(record);
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
