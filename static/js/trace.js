/**
 * @fileoverview Manages the Log tab including Socket.IO message handling,
 * buffering, filtering, and table rendering utilities.
 */

const MAX_TRACE_ENTRIES = 1000;
const $ = (selector, ctx = document) => ctx.querySelector(selector);

/**
 * Creates a table row for a trace message entry.
 * @param {TraceEntry} entry
 * @returns {HTMLTableRowElement}
 */
const buildTraceRow = (entry) => {
  const row = document.createElement('tr');
  const timeValue = Number.isFinite(entry.relativeTime)
    ? entry.relativeTime.toFixed(6)
    : '';
  const direction = (entry.direction || '').toUpperCase();
  const frameType = entry.frameType || (entry.isFd ? 'CAN FD' : 'CAN');
  const frameName = entry.frameName || '';
  row.innerHTML = `
    <td>${timeValue}</td>
    <td>${direction}</td>
    <td>${frameType}</td>
    <td>${entry.id ?? ''}</td>
    <td>${frameName}</td>
    <td>${entry.dlc ?? ''}</td>
    <td>${entry.data ?? ''}</td>
  `;
  return row;
};

/**
 * Normalizes an incoming trace payload from the server.
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
 * Determines if an entry matches the active filter.
 * @param {TraceEntry} entry
 * @param {string} filter
 * @returns {boolean}
 */
const matchesFilter = (entry, filter) => {
  if (!filter) return true;
  const cleanFilter = filter.replace(/^0x/i, '');
  const id = String(entry.id || '').toLowerCase().replace(/^0x/i, '');
  return id.includes(cleanFilter);
};

/**
 * @typedef {ReturnType<typeof normalizeTraceMessage>} TraceEntry
 */

export function initTrace({ socket, getActiveTab, onTabChange }) {
  const tbody = $('#trace-table tbody');
  const traceBuffer = [];
  let filterValue = '';
  let traceRunning = false;
  let logStartMonotonic = null;
  let pendingStartMonotonic = null;

  const statusEl = $('#trace-status');

  const setTraceStatus = (message, tone = 'info') => {
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

  const traceToggle = $('#btn-trace-toggle');

  const updateToggleState = () => {
    if (!traceToggle) return;
    traceToggle.textContent = traceRunning ? 'Stop Log' : 'Start Log';
    traceToggle.setAttribute('aria-pressed', traceRunning ? 'true' : 'false');
    traceToggle.classList.toggle('is-active', traceRunning);
  };

  const setTraceRunning = (running) => {
    const nextState = !!running;
    if (traceRunning !== nextState) {
      if (nextState) {
        logStartMonotonic = pendingStartMonotonic ?? performance.now() / 1000;
        pendingStartMonotonic = null;
        traceBuffer.length = 0;
        if (tbody) {
          tbody.innerHTML = '';
        }
      } else {
        logStartMonotonic = null;
        pendingStartMonotonic = null;
      }
    }
    traceRunning = nextState;
    updateToggleState();
  };

  const setToggleDisabled = (disabled) => {
    if (!traceToggle) return;
    traceToggle.disabled = !!disabled;
  };

  if (traceToggle) {
    setToggleDisabled(!socket?.connected);
    traceToggle.addEventListener('click', () => {
      if (!socket || typeof socket.emit !== 'function') return;
      if (!socket.connected) {
        setTraceStatus('Socket disconnected. Unable to control log.', 'error');
        return;
      }
      if (!traceRunning) {
        pendingStartMonotonic = performance.now() / 1000;
      }
      const eventName = traceRunning ? 'stop_trace' : 'start_trace';
      socket.emit(eventName);
    });
  }

  const renderAll = () => {
    if (!tbody || getActiveTab() !== 'trace') return;
    tbody.innerHTML = '';
    for (let i = traceBuffer.length - 1; i >= 0; i -= 1) {
      const entry = traceBuffer[i];
      if (!matchesFilter(entry, filterValue)) continue;
      tbody.appendChild(buildTraceRow(entry));
    }
  };

  const appendEntry = (entry) => {
    if (!tbody || getActiveTab() !== 'trace') return;
    if (!matchesFilter(entry, filterValue)) return;
    const row = buildTraceRow(entry);
    tbody.insertBefore(row, tbody.firstChild);
  };

  const recordMessage = (msg) => {
    const entry = normalizeTraceMessage(msg);
    const now = performance.now() / 1000;
    entry.receivedAt = now;
    const base = logStartMonotonic ?? pendingStartMonotonic;
    entry.relativeTime = base != null ? Math.max(0, now - base) : 0;
    traceBuffer.push(entry);
    if (traceBuffer.length > MAX_TRACE_ENTRIES) {
      traceBuffer.splice(0, traceBuffer.length - MAX_TRACE_ENTRIES);
    }
    if (getActiveTab() === 'trace') {
      appendEntry(entry);
    }
  };

  const clearTrace = () => {
    traceBuffer.length = 0;
    if (tbody) {
      tbody.innerHTML = '';
    }
  };

  socket.on('connected', (msg) => {
    setTraceRunning(!!msg?.trace_running);
    if (!msg?.info) {
      setTraceStatus('');
    }
    renderAll();
  });

  socket.on('trace', recordMessage);

  socket.on('trace_info', (msg) => {
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'running')) {
      setTraceRunning(msg.running);
    }
    if (msg?.info) {
      let tone = 'info';
      if (msg?.running) {
        tone = 'success';
      } else if (/already/i.test(msg.info)) {
        tone = 'warning';
      }
      setTraceStatus(msg.info, tone);
    }
  });

  socket.on('trace_error', (msg) => {
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'running')) {
      setTraceRunning(msg.running);
    } else {
      setTraceRunning(false);
    }
    setTraceStatus(msg?.error || 'Log error', 'error');
  });

  socket.on('connect', () => {
    setToggleDisabled(false);
    setTraceStatus('');
  });

  socket.on('disconnect', () => {
    setToggleDisabled(true);
    setTraceStatus('Socket disconnected. Live updates paused.', 'warning');
  });

  const clearButton = $('#btn-trace-clear');
  clearButton?.addEventListener('click', () => {
    clearTrace();
  });

  const traceFilter = $('#trace-filter');
  traceFilter?.addEventListener('input', (event) => {
    filterValue = String(event.target.value || '').trim().toLowerCase();
    renderAll();
  });

  if (typeof onTabChange === 'function') {
    onTabChange('trace', renderAll);
  }

  updateToggleState();
  setTraceStatus('');
}
