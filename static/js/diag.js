/**
 * @fileoverview Implements Diagnostics tab actions including requests,
 * security unlock, tester present control, and log rendering.
 * Updated to respect active tab context and isolate logs to Diagnostics only.
 */

const $ = (selector, ctx = document) => ctx.querySelector(selector);

const diagGroups = {
  functional: {
    raw: '#diag-request-raw',
    ecu: '#diag-functional-id',
    timeout: '#diag-functional-timeout',
    defaultLabel: 'Functional',
  },
  physical: {
    raw: '#diag-request-raw',
    ecu: '#diag-physical-id',
    timeout: '#diag-physical-timeout',
    defaultLabel: 'Physical',
  },
};

let diagLogAppender = null;

const getConfiguredEcuId = () => {
  const physical = $('#diag-physical-id')?.value.trim();
  if (physical) return physical;
  const functional = $('#diag-functional-id')?.value.trim();
  if (functional) return functional;
  return '';
};

const getTesterPresentInterval = () => Number($('#tp-interval')?.value || 2000);

const physicalStaticCommands = [
  { label: 'Default Session', data: '10 01' },
  { label: 'Extended Session', data: '10 03' },
  { label: 'Security Access', data: '27 01' },
  { label: 'Tester Present', data: '3E 00' },
  { label: 'Clear DTC', data: '14 FF FF' },
  { label: 'ECU Reset', data: '11 01' },
  { label: 'Read VIN', data: '22 F1 90' },
  { label: 'Read SW Version', data: '22 F1 A0' },
];

const normalizeDiagRaw = (raw) => (raw || '').replace(/\s+/g, ' ').trim().toUpperCase();

const HEX_STRIP_RE = /[^0-9a-fA-F\n]/g;
const HEX_CHAR_RE = /[0-9A-F]/;

const scheduleFrame = (fn) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 0);
  }
};

const isNearBottom = (el, threshold = 40) => {
  if (!el) return true;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance <= threshold;
};

const formatHexTextareaValue = (el) => {
  if (!el || el.__formatting) return;
  el.__formatting = true;

  const rawValue = el.value;
  const selectionStart = el.selectionStart ?? rawValue.length;
  const selectionEnd = el.selectionEnd ?? selectionStart;

  const digitsBeforeStart = rawValue
    .slice(0, selectionStart)
    .replace(HEX_STRIP_RE, '')
    .replace(/\n/g, '').length;
  const digitsBeforeEnd = rawValue
    .slice(0, selectionEnd)
    .replace(HEX_STRIP_RE, '')
    .replace(/\n/g, '').length;

  const lines = rawValue.split('\n');
  const formattedLines = lines.map((line) => {
    const cleaned = line.replace(HEX_STRIP_RE, '');
    if (!cleaned) return '';
    const pairs = cleaned.match(/.{1,2}/g) || [];
    return pairs.join(' ');
  });
  const formatted = formattedLines.join('\n').toUpperCase();

  const digitIndexMap = [];
  for (let i = 0, seen = 0; i < formatted.length; i += 1) {
    if (HEX_CHAR_RE.test(formatted[i])) {
      digitIndexMap[seen] = i;
      seen += 1;
    }
  }

  const calcCaret = (digitCount) => {
    if (digitCount <= 0) return 0;
    if (digitCount > digitIndexMap.length) return formatted.length;
    return digitIndexMap[digitCount - 1] + 1;
  };

  const newStart = calcCaret(digitsBeforeStart);
  const newEnd = calcCaret(digitsBeforeEnd);

  el.value = formatted;

  if (typeof el.setSelectionRange === 'function') {
    scheduleFrame(() => {
      el.setSelectionRange(newStart, newEnd);
      el.__formatting = false;
    });
  } else {
    el.__formatting = false;
  }
};

const attachHexFormatter = (selector) => {
  const el = $(selector);
  if (!el) return;
  const handler = () => formatHexTextareaValue(el);
  el.addEventListener('input', handler);
  el.addEventListener('blur', handler);
  handler();
};

export async function configureDiagnosticsFromSettings({ reportStatus } = {}) {
  const ecuId = getConfiguredEcuId();
  if (!ecuId) {
    diagLogAppender?.({
      label: 'Diagnostics Config',
      error: 'Provide a Physical or Functional ID in Settings',
    });
    reportStatus?.('Diagnostics not configured', 'error');
    return { ok: false, error: 'Missing ECU ID' };
  }
  const testerId = $('#tester-id')?.value.trim();
  const payload = { ecu_id: ecuId };
  if (testerId) payload.tester_id = testerId;
  const dllInput = $('#diag-dll');
  if (dllInput && dllInput.value.trim()) payload.dll = dllInput.value.trim();
  reportStatus?.('Configuring…', 'info');
  try {
    const res = await fetch('/api/diag/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const js = await res.json().catch(() => ({ ok: false }));
    if (js.ok) {
      const ecu = js.ecu_id || payload.ecu_id;
      const tester = js.tester_id || payload.tester_id || '—';
      diagLogAppender?.({
        label: 'Diagnostics Configured',
        ecuId: `${ecu}/${tester}`,
        request: js.dll ? `DLL: ${js.dll}` : payload.dll ? `DLL: ${payload.dll}` : undefined,
      });
      reportStatus?.(`Configured (${ecu})`, 'success');
      return { ok: true, ecuId: ecu, testerId: tester, dll: js.dll || payload.dll };
    }
    const error = js.error || 'ERR';
    diagLogAppender?.({ label: 'Diagnostics Config', error });
    reportStatus?.(error, 'error');
    return { ok: false, error };
  } catch (err) {
    const error = err?.message || 'ERR';
    diagLogAppender?.({ label: 'Diagnostics Config', error });
    reportStatus?.(error, 'error');
    return { ok: false, error };
  }
}

/**
 * Initialize the Diagnostics tab module.
 * @param {object} options
 * @param {SocketIOClient.Socket} options.socket
 * @param {() => string} options.getActiveTab
 * @param {(tabName: string, handler: Function) => void} options.onTabChange
 */
export function initDiag({ socket, getActiveTab, onTabChange } = {}) {
  const diagLog = $('#diag-log');
  const diagBuffer = [];
  const MAX_LOG_ENTRIES = 500;
  let stickToBottom = true;

  attachHexFormatter('#diag-request-raw');

  const diagRawInput = $('#diag-request-raw');
  const autosizeRawInput = () => {
    if (!diagRawInput) return;
    diagRawInput.style.height = 'auto';
    const maxHeight = 120;
    const nextHeight = Math.min(maxHeight, diagRawInput.scrollHeight);
    diagRawInput.style.height = `${nextHeight}px`;
    diagRawInput.style.overflowY = diagRawInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };
  diagRawInput?.addEventListener('input', autosizeRawInput);
  scheduleFrame(autosizeRawInput);

  diagRawInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey && !ev.metaKey && !ev.ctrlKey && !ev.isComposing) {
      ev.preventDefault();
      $('#btn-diag-send')?.click();
    }
  });

  const addressToggle = $('#diag-address-toggle');
  const addressLabel = $('#diag-address-label');
  const addressToggleWrapper = document.querySelector('.diag-address-toggle');
  let currentGroup = 'functional';

  const updateAddressToggle = (group) => {
    currentGroup = group;
    if (addressToggle) {
      addressToggle.checked = group === 'physical';
      addressToggle.setAttribute('aria-checked', group === 'physical' ? 'true' : 'false');
    }
    if (addressLabel) {
      addressLabel.textContent = group === 'physical' ? 'Physical' : 'Functional';
    }
    if (addressToggleWrapper) {
      addressToggleWrapper.setAttribute('data-mode', group === 'physical' ? 'physical' : 'functional');
    }
  };

  addressToggle?.addEventListener('change', (ev) => {
    updateAddressToggle(ev.target.checked ? 'physical' : 'functional');
  });
  updateAddressToggle(currentGroup);

  const diagLogScroll = (force = false) => {
    if (!diagLog) return;
    if (force || stickToBottom || isNearBottom(diagLog)) {
      diagLog.scrollTop = diagLog.scrollHeight;
    }
  };

  diagLog?.addEventListener('scroll', () => {
    stickToBottom = isNearBottom(diagLog);
  });

  const renderDiagEntry = (entry) => {
    if (!diagLog) return;
    const shouldStick = isNearBottom(diagLog);
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
    stickToBottom = shouldStick;
  };

  const addDiagLogEntry = (data) => {
    const entry = { ...data, time: new Date() };
    diagBuffer.push(entry);
    if (diagBuffer.length > MAX_LOG_ENTRIES) diagBuffer.shift();

    if (typeof getActiveTab === 'function' && getActiveTab() !== 'diag') return;
    renderDiagEntry(entry);
    diagLogScroll();
  };

  diagLogAppender = addDiagLogEntry;

  const renderBufferedLogs = () => {
    if (!diagLog) return;
    diagLog.innerHTML = '';
    diagBuffer.forEach(renderDiagEntry);
    stickToBottom = true;
    diagLogScroll(true);
  };

  if (typeof onTabChange === 'function') {
    onTabChange('diag', renderBufferedLogs);
  }

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

  const diagCustomCounters = { functional: 0, physical: 0 };

  const staticButtonsContainer = $('#diag-fast-buttons');
  if (staticButtonsContainer) {
    physicalStaticCommands.forEach(({ label, data }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'diag-static-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        sendDiagRequest({ group: currentGroup, raw: data, label });
      });
      staticButtonsContainer.appendChild(btn);
    });
  }

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
    const container = document.querySelector('#diag-custom-buttons');
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

  $('#btn-diag-send')?.addEventListener('click', () => sendDiagRequest({ group: currentGroup }));
  $('#btn-diag-send-did')?.addEventListener('click', () => {
    const valueInput = $('#diag-did-value');
    const baseInput = $('#diag-request-raw');
    if (!valueInput || !baseInput) return;
    const base = normalizeDiagRaw(baseInput.value);
    if (!base) {
      addDiagLogEntry({ label: 'Send DID', error: 'Base request is empty' });
      return;
    }
    const decimal = Number(valueInput.value);
    if (!Number.isInteger(decimal) || decimal < 0 || decimal > 255) {
      addDiagLogEntry({ label: 'Send DID', error: 'Value must be 0-255' });
      return;
    }
    const hexValue = decimal.toString(16).toUpperCase().padStart(2, '0');
    const request = `${base} ${hexValue}`.trim();
    sendDiagRequest({ group: currentGroup, raw: request, label: 'Send DID' });
  });

  $('#btn-diag-add')?.addEventListener('click', () => createCustomDiagButton(currentGroup));

  $('#btn-diag-unlock')?.addEventListener('click', async () => {
    const payload = {};
    const ecuId = getConfiguredEcuId();
    if (ecuId) payload.ecu_id = ecuId;
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

  let testerPresentActive = false;
  const tpButton = $('#btn-tp-toggle');
  const setTpState = (active) => {
    testerPresentActive = active;
    if (!tpButton) return;
    tpButton.textContent = active ? 'Stop Tester Present' : 'Start Tester Present';
    tpButton.setAttribute('aria-pressed', active ? 'true' : 'false');
  };
  setTpState(false);

  tpButton?.addEventListener('click', async () => {
    const payload = testerPresentActive ? { action: 'stop' } : { action: 'start', interval: getTesterPresentInterval() };
    try {
      const res = await fetch('/api/diag/tester_present', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(res.statusText || 'Tester Present failed');
      setTpState(!testerPresentActive);
    } catch (err) {
      addDiagLogEntry({ label: 'Tester Present', error: err.message || 'ERR' });
    }
  });
}
