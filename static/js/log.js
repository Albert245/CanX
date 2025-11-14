/**
 * @fileoverview Manages the Log tab including Socket.IO message handling,
 * buffering, filtering, and table rendering utilities.
 */

const MAX_LOG_ENTRIES = 1000;
const $ = (selector, ctx = document) => ctx.querySelector(selector);

const monotonicSeconds = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
};

/**
 * Creates a table row for a log message entry.
 * @param {LogEntry} entry
 * @returns {HTMLTableRowElement}
 */
const buildLogRow = (entry) => {
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
 * Normalizes an incoming log payload from the server.
 * @param {object} msg
 * @returns {LogEntry}
 */
const normalizeLogMessage = (msg = {}) => {
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
 * @param {LogEntry} entry
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
 * @typedef {ReturnType<typeof normalizeLogMessage>} LogEntry
 */

export function initLog({ socket, getActiveTab, onTabChange }) {
  const tbody = $('#log-table tbody');
  const logBuffer = [];
  let filterValue = '';
  let logRunning = false;
  let logStartMonotonic = null;
  let pendingStartMonotonic = null;

  const statusEl = $('#log-status');

  const setLogStatus = (message, tone = 'info') => {
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

  const logToggle = $('#btn-log-toggle');

  const updateToggleState = () => {
    if (!logToggle) return;
    logToggle.textContent = logRunning ? 'Stop Log' : 'Start Log';
    logToggle.setAttribute('aria-pressed', logRunning ? 'true' : 'false');
    logToggle.classList.toggle('is-active', logRunning);
  };

  const setLogRunning = (running) => {
    const nextState = !!running;
    if (logRunning !== nextState) {
      if (nextState) {
        logStartMonotonic = pendingStartMonotonic ?? monotonicSeconds();
        pendingStartMonotonic = null;
        logBuffer.length = 0;
        if (tbody) {
          tbody.innerHTML = '';
        }
      } else {
        logStartMonotonic = null;
        pendingStartMonotonic = null;
      }
    }
    logRunning = nextState;
    updateToggleState();
  };

  if (logToggle) {
    logToggle.addEventListener('click', () => {
      if (!socket || typeof socket.emit !== 'function') return;
      if (!socket.connected) {
        setLogStatus('Socket disconnected. Unable to control log.', 'error');
        return;
      }
      if (!logRunning) {
        pendingStartMonotonic = monotonicSeconds();
      }
      const eventName = logRunning ? 'stop_trace' : 'start_trace';
      socket.emit(eventName);
    });
  }

  const renderAll = () => {
    if (!tbody || getActiveTab() !== 'log') return;
    tbody.innerHTML = '';
    for (let i = logBuffer.length - 1; i >= 0; i -= 1) {
      const entry = logBuffer[i];
      if (!matchesFilter(entry, filterValue)) continue;
      tbody.appendChild(buildLogRow(entry));
    }
  };

  const appendEntry = (entry) => {
    if (!tbody || getActiveTab() !== 'log') return;
    if (!matchesFilter(entry, filterValue)) return;
    const row = buildLogRow(entry);
    tbody.insertBefore(row, tbody.firstChild);
  };

  const recordMessage = (msg) => {
    const entry = normalizeLogMessage(msg);
    const now = monotonicSeconds();
    entry.receivedAt = now;
    const base = logStartMonotonic ?? pendingStartMonotonic;
    entry.relativeTime = base != null ? Math.max(0, now - base) : 0;
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
      logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
    }
    if (getActiveTab() === 'log') {
      appendEntry(entry);
    }
  };

  const clearLog = () => {
    logBuffer.length = 0;
    if (tbody) {
      tbody.innerHTML = '';
    }
  };

  socket.on('connected', (msg) => {
    setLogRunning(!!msg?.trace_running);
    if (!msg?.info) {
      setLogStatus('');
    }
    renderAll();
  });

  socket.on('trace', recordMessage);

  socket.on('trace_info', (msg) => {
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'running')) {
      setLogRunning(msg.running);
    }
    if (msg?.info) {
      let tone = 'info';
      if (msg?.running) {
        tone = 'success';
      } else if (/already/i.test(msg.info)) {
        tone = 'warning';
      }
      setLogStatus(msg.info, tone);
    }
  });

  socket.on('trace_error', (msg) => {
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'running')) {
      setLogRunning(msg.running);
    } else {
      setLogRunning(false);
    }
    setLogStatus(msg?.error || 'Log error', 'error');
  });

  socket.on('connect', () => {
    setLogStatus('');
  });

  socket.on('disconnect', () => {
    setLogStatus('Socket disconnected. Live updates paused.', 'warning');
  });

  const clearButton = $('#btn-log-clear');
  clearButton?.addEventListener('click', () => {
    clearLog();
  });

  const logFilter = $('#log-filter');
  logFilter?.addEventListener('input', (event) => {
    filterValue = String(event.target.value || '').trim().toLowerCase();
    renderAll();
  });

  if (typeof onTabChange === 'function') {
    onTabChange('log', renderAll);
  }

  updateToggleState();
  setLogStatus('');
}
