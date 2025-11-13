/**
 * @fileoverview Manages the Trace tab including Socket.IO message handling,
 * buffering, filtering, decode toggling, and table rendering utilities.
 */

const MAX_TRACE_ENTRIES = 1000;
const $ = (selector, ctx = document) => ctx.querySelector(selector);

/**
 * Creates a table row for a trace message entry.
 * @param {TraceEntry} entry
 * @returns {HTMLTableRowElement}
 */
const buildTraceRow = (entry, decodeEnabled) => {
  const row = document.createElement('tr');
  const timestamp = new Date((entry.ts || Date.now() / 1000) * 1000).toLocaleTimeString();
  const decodedText = decodeEnabled && entry.decoded
    ? (typeof entry.decoded === 'string' ? entry.decoded : JSON.stringify(entry.decoded))
    : '';
  row.innerHTML = `
    <td>${timestamp}</td>
    <td>${entry.id ?? ''}</td>
    <td>${entry.dlc ?? ''}</td>
    <td>${entry.data ?? ''}</td>
    <td>${decodedText}</td>
  `;
  return row;
};

/**
 * Normalizes an incoming trace payload from the server.
 * @param {object} msg
 * @returns {TraceEntry}
 */
const normalizeTraceMessage = (msg) => ({
  ts: msg?.ts ?? Date.now() / 1000,
  id: msg?.id ?? '',
  dlc: msg?.dlc ?? '',
  data: msg?.data ?? '',
  decoded: msg?.decoded ?? null,
});

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
  let decodeEnabled = true;
  let traceRunning = false;

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
    traceToggle.textContent = traceRunning ? 'Stop Trace' : 'Start Trace';
    traceToggle.setAttribute('aria-pressed', traceRunning ? 'true' : 'false');
    traceToggle.classList.toggle('is-active', traceRunning);
  };

  const setTraceRunning = (running) => {
    traceRunning = !!running;
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
      tbody.appendChild(buildTraceRow(entry, decodeEnabled));
    }
  };

  const appendEntry = (entry) => {
    if (!tbody || getActiveTab() !== 'trace') return;
    if (!matchesFilter(entry, filterValue)) return;
    const row = buildTraceRow(entry, decodeEnabled);
    tbody.insertBefore(row, tbody.firstChild);
  };

  const recordMessage = (msg) => {
    traceBuffer.push(normalizeTraceMessage(msg));
    if (traceBuffer.length > MAX_TRACE_ENTRIES) {
      traceBuffer.splice(0, traceBuffer.length - MAX_TRACE_ENTRIES);
    }
    if (getActiveTab() === 'trace') {
      appendEntry(traceBuffer[traceBuffer.length - 1]);
    }
  };

  const clearTrace = () => {
    traceBuffer.length = 0;
    if (tbody) {
      tbody.innerHTML = '';
    }
  };

  socket.on('connected', (msg) => {
    decodeEnabled = !!msg?.decode;
    setTraceRunning(!!msg?.trace_running);
    const toggle = $('#decode-toggle');
    if (toggle) {
      toggle.checked = decodeEnabled;
    }
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
    setTraceStatus(msg?.error || 'Trace error', 'error');
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

  const decodeToggle = $('#decode-toggle');
  decodeToggle?.addEventListener('change', (event) => {
    decodeEnabled = event.target.checked;
    renderAll();
  });

  if (typeof onTabChange === 'function') {
    onTabChange('trace', renderAll);
  }

  updateToggleState();
  setTraceStatus('');
}
