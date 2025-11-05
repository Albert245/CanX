/**
 * @fileoverview Implements Diagnostics tab actions including requests,
 * security unlock, tester present control, and log rendering.
 * Updated to respect active tab context and isolate logs to Diagnostics only.
 */

const $ = (selector, ctx = document) => ctx.querySelector(selector);

const diagGroups = {
  functional: {
    raw: '#diag-functional-raw',
    ecu: '#diag-functional-id',
    timeout: '#diag-functional-timeout',
    defaultLabel: 'Functional',
  },
  physical: {
    raw: '#diag-physical-raw',
    ecu: '#diag-physical-id',
    timeout: '#diag-physical-timeout',
    defaultLabel: 'Physical',
  },
};

const normalizeDiagRaw = (raw) => (raw || '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Initialize the Diagnostics tab module.
 * @param {object} options
 * @param {SocketIOClient.Socket} options.socket
 * @param {() => string} options.getActiveTab
 * @param {(tabName: string, handler: Function) => void} options.onTabChange
 */
export function initDiag({ socket, getActiveTab, onTabChange } = {}) {
  const diagLog = $('#diag-log');
  const diagBuffer = []; // keep a short log history
  const MAX_LOG_ENTRIES = 500;

  const diagLogScroll = () => {
    if (!diagLog) return;
    diagLog.scrollTop = diagLog.scrollHeight;
  };

  const renderDiagEntry = (entry) => {
    if (!diagLog) return;
    const { label, ecuId, request, response, error, time } = entry;
    const logEntry = document.createElement('div');
    logEntry.className = 'diag-log-entry';
    logEntry.classList.add(error ? 'error' : 'success');

    const meta = document.createElement('div');
    meta.className = 'diag-log-meta';
    const ts = document.createElement('span');
    ts.className = 'diag-log-time';
    ts.textContent = (time || new Date()).toLocaleTimeString();
    const title = document.createElement('span');
    title.className = 'diag-log-title';
    title.textContent = label || 'Diagnostics';
    meta.appendChild(ts);
    meta.appendChild(title);
    if (ecuId) {
      const ecu = document.createElement('span');
      ecu.className = 'diag-log-ecu';
      ecu.textContent = `ECU ${ecuId}`;
      meta.appendChild(ecu);
    }
    logEntry.appendChild(meta);

    if (request) {
      const req = document.createElement('pre');
      req.className = 'diag-log-req';
      req.textContent = `REQ: ${request}`;
      logEntry.appendChild(req);
    }

    if (error) {
      const err = document.createElement('pre');
      err.className = 'diag-log-resp';
      err.textContent = `ERR: ${error}`;
      logEntry.appendChild(err);
    } else if (response !== undefined) {
      const resp = document.createElement('pre');
      resp.className = 'diag-log-resp';
      const body = Array.isArray(response) ? response.join(' ') : response || '';
      resp.textContent = body ? `RESP: ${body}` : 'RESP: <no data>';
      logEntry.appendChild(resp);
    }

    diagLog.appendChild(logEntry);
  };

  /**
   * Add a new log entry (buffers if Diagnostics tab is inactive).
   */
  const addDiagLogEntry = (data) => {
    const entry = { ...data, time: new Date() };
    diagBuffer.push(entry);
    if (diagBuffer.length > MAX_LOG_ENTRIES) diagBuffer.shift();

    // Only render immediately if Diagnostics tab is active
    if (typeof getActiveTab === 'function' && getActiveTab() !== 'diag') return;
    renderDiagEntry(entry);
    diagLogScroll();
  };

  /**
   * Re-render buffered entries when returning to the Diagnostics tab.
   */
  const renderBufferedLogs = () => {
    if (!diagLog) return;
    diagLog.innerHTML = '';
    diagBuffer.forEach(renderDiagEntry);
    diagLogScroll();
  };

  // Register tab change hook
  if (typeof onTabChange === 'function') {
    onTabChange('diag', renderBufferedLogs);
  }

  // -------------------------
  // DIAGNOSTIC CORE FUNCTIONS
  // -------------------------
  const sendDiagRequest = async ({ group, raw, ecuId, timeout, label }) => {
    const settings = diagGroups[group];
    if (!settings) return;
    const rawInput = $(settings.raw);
    const ecuInput = $(settings.ecu);
    const timeoutInput = $(settings.timeout);
    const payload = {
      data: normalizeDiagRaw(raw ?? (rawInput ? rawInput.value : '')),
      timeout: Number(timeout ?? (timeoutInput ? timeoutInput.value || 500 : 500)),
    };
    const target = ecuId ?? (ecuInput ? ecuInput.value : '');
    if (target) payload.ecu_id = target.trim();
    payload.label = label || settings.defaultLabel;
    if (!payload.data) {
      addDiagLogEntry({
        label: `${settings.defaultLabel} Send`,
        error: 'Request payload is empty',
        ecuId: target?.toUpperCase?.(),
      });
      return;
    }
    try {
      const res = await fetch('/api/diag/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: false }));
      if (js.ok) {
        addDiagLogEntry({
          label: payload.label,
          ecuId: js.ecu_id || target?.toUpperCase?.(),
          request: payload.data,
          response: js.response,
        });
      } else {
        addDiagLogEntry({
          label: payload.label,
          ecuId: target?.toUpperCase?.(),
          request: payload.data,
          error: js.error || 'ERR',
        });
      }
    } catch (err) {
      addDiagLogEntry({
        label: payload.label,
        ecuId: target?.toUpperCase?.(),
        request: payload.data,
        error: err.message || 'ERR',
      });
    }
  };

  // -------------------------
  // BUTTON HANDLERS
  // -------------------------
  const diagCustomCounters = { functional: 0, physical: 0 };

  const createCustomDiagButton = (group) => {
    const settings = diagGroups[group];
    if (!settings) return;
    const rawInput = $(settings.raw);
    const ecuInput = $(settings.ecu);
    const timeoutInput = $(settings.timeout);
    if (!rawInput || !rawInput.value.trim()) {
      addDiagLogEntry({
        label: `${settings.defaultLabel} Add`,
        error: 'Cannot add custom sender without payload',
      });
      return;
    }
    const normalized = normalizeDiagRaw(rawInput.value);
    const ecuId = ecuInput ? ecuInput.value.trim() : '';
    const timeout = timeoutInput ? Number(timeoutInput.value || 500) : 500;
    const container = document.querySelector(`#${group}-custom-buttons`);
    if (!container) return;
    const index = ++diagCustomCounters[group];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'diag-custom-btn';
    const label = `${settings.defaultLabel} ${index}`;
    const preview = normalized.split(' ').slice(0, 3).join(' ');
    btn.textContent = preview ? `${label}: ${preview}` : label;
    btn.addEventListener('click', () => {
      sendDiagRequest({ group, raw: normalized, ecuId, timeout, label });
    });
    container.appendChild(btn);
  };

  $('#btn-diag-config')?.addEventListener('click', async () => {
    const payload = {
      ecu_id: $('#ecu-id')?.value.trim(),
      tester_id: $('#tester-id')?.value.trim(),
    };
    const dllInput = $('#diag-dll');
    if (dllInput && dllInput.value.trim()) payload.dll = dllInput.value.trim();
    try {
      const res = await fetch('/api/diag/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: false }));
      if (js.ok) {
        addDiagLogEntry({
          label: 'Diagnostics Configured',
          ecuId: `${js.ecu_id || payload.ecu_id}/${js.tester_id || payload.tester_id}`,
          request: js.dll ? `DLL: ${js.dll}` : undefined,
        });
      } else {
        addDiagLogEntry({ label: 'Diagnostics Config', error: js.error || 'ERR' });
      }
    } catch (err) {
      addDiagLogEntry({ label: 'Diagnostics Config', error: err.message || 'ERR' });
    }
  });

  $('#btn-functional-send')?.addEventListener('click', () =>
    sendDiagRequest({ group: 'functional' }),
  );
  $('#btn-physical-send')?.addEventListener('click', () =>
    sendDiagRequest({ group: 'physical' }),
  );

  $('#btn-functional-add')?.addEventListener('click', () =>
    createCustomDiagButton('functional'),
  );
  $('#btn-physical-add')?.addEventListener('click', () =>
    createCustomDiagButton('physical'),
  );

  $('#btn-diag-unlock')?.addEventListener('click', async () => {
    const payload = {};
    const ecuInput = $('#diag-unlock-ecu');
    if (ecuInput && ecuInput.value.trim()) payload.ecu_id = ecuInput.value.trim();
    const dllInput = $('#diag-dll');
    if (dllInput && dllInput.value.trim()) payload.dll = dllInput.value.trim();
    try {
      const res = await fetch('/api/diag/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: false }));
      if (js.ok) {
        addDiagLogEntry({
          label: 'Security Unlock',
          ecuId: js.ecu_id,
          request: payload.dll ? `DLL: ${payload.dll}` : undefined,
          response: 'Unlocked',
        });
      } else {
        addDiagLogEntry({
          label: 'Security Unlock',
          ecuId: payload.ecu_id,
          error: js.error || 'Unlock failed',
        });
      }
    } catch (err) {
      addDiagLogEntry({
        label: 'Security Unlock',
        ecuId: payload.ecu_id,
        error: err.message || 'Unlock failed',
      });
    }
  });

  $('#btn-tp-start')?.addEventListener('click', async () => {
    const payload = { action: 'start', interval: Number($('#tp-interval')?.value || 2000) };
    await fetch('/api/diag/tester_present', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  $('#btn-tp-stop')?.addEventListener('click', async () => {
    const payload = { action: 'stop' };
    await fetch('/api/diag/tester_present', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });
}
