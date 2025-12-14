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

let startLogActive = false;

const diagCustomButtons = [];
let selectedCustomButtonId = null;
const diagCustomCounters = { functional: 0, physical: 0 };

const scriptExecution = {
  running: false,
  cancelFlag: false,
  startedTesterPresent: false,
  currentButtonId: null,
  warnedManualSend: false,
};

let addCustomButtonEntryFn = null;
let resetCustomButtonsFn = null;

const decodeAsciiFromHex = (payload = '') => {
  const tokens = `${payload}`
    .trim()
    .split(/\s+/)
    .filter((tok) => /^[0-9A-Fa-f]{2}$/.test(tok));
  if (!tokens.length) return '';
  const chars = tokens.map((tok) => {
    const code = parseInt(tok, 16);
    if (Number.isNaN(code)) return '.';
    if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
    return '.';
  });
  return chars.join('');
};

const stringifyPayload = (val) => {
  if (Array.isArray(val)) return val.join(' ');
  if (val === null || val === undefined) return '';
  return String(val).trim();
};

const isNegativeResponse = (payload = '') => {
  const firstToken = `${payload}`
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .shift();
  return (firstToken || '').toUpperCase() === '7F';
};

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

const normalizeFileName = (name = '') => name.replace(/\.[^.]+$/, '') || 'Script';

const parseSleepCommand = (value) => {
  const match = value.trim().match(/^(\d+)\s*(MS|S)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || 'MS').toUpperCase();
  const durationMs = unit === 'S' ? amount * 1000 : amount;
  return { value: `${amount}${unit}`, durationMs };
};

const parseScriptText = (text = '') => {
  const steps = [];
  const lines = `${text}`.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    const line = rawLine.trim();
    if (!line) continue;
    const lineNumber = idx + 1;
    if (line.startsWith('//')) {
      steps.push({ comment: line.slice(2).trim() });
      continue;
    }
    if (/^\[.*\]$/.test(line)) {
      const inner = line.slice(1, -1).trim();
      const upper = inner.toUpperCase();
      if (upper.startsWith('SLEEP ')) {
        const parsed = parseSleepCommand(inner.slice(6));
        if (!parsed) {
          throw new Error(`Line ${lineNumber}: Invalid SLEEP value in \"${rawLine}\"`);
        }
        steps.push({ cmd: 'SLEEP', value: parsed.value, durationMs: parsed.durationMs });
        continue;
      }
      if (upper === 'TESTER PRESENT START') {
        steps.push({ cmd: 'TESTER_PRESENT_START' });
        continue;
      }
      if (upper === 'TESTER PRESENT STOP') {
        steps.push({ cmd: 'TESTER_PRESENT_STOP' });
        continue;
      }
      if (upper === 'UNLOCK SECA') {
        steps.push({ cmd: 'UNLOCK_SECA' });
        continue;
      }
      throw new Error(`Line ${lineNumber}: Unsupported command \"${rawLine}\"`);
    }
    const tokens = line.split(/\s+/);
    if (!tokens.every((tok) => /^[0-9A-Fa-f]{2}$/.test(tok))) {
      throw new Error(`Line ${lineNumber}: Invalid hex payload \"${rawLine}\"`);
    }
    steps.push({ req: tokens.map((tok) => tok.toUpperCase()).join(' ') });
  }
  if (!steps.length) {
    throw new Error('No executable script content found');
  }
  return steps;
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
      type: 'error',
      payload: 'Provide a Physical or Functional ID in Settings',
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
      const dllInfo = js.dll || payload.dll;
      if (dllInfo) {
        diagLogAppender?.({ type: 'info', payload: `DLL: ${dllInfo}`, canId: ecu });
      }
      reportStatus?.(`Configured (${ecu})`, 'success');
      return { ok: true, ecuId: ecu, testerId: tester, dll: js.dll || payload.dll };
    }
    const error = js.error || 'ERR';
    diagLogAppender?.({ type: 'error', payload: error });
    reportStatus?.(error, 'error');
    return { ok: false, error };
  } catch (err) {
    const error = err?.message || 'ERR';
    diagLogAppender?.({ type: 'error', payload: error });
    reportStatus?.(error, 'error');
    return { ok: false, error };
  }
}

export const getDiagProfileData = () => ({
  customButtons: diagCustomButtons.map((entry) => {
    const base = {
      type: entry.type,
      name: entry.name,
      label: entry.label,
      group: entry.group,
      req: entry.req,
      ecuId: entry.ecuId,
      timeout: entry.timeout,
    };
    if (entry.type === 'script') {
      base.steps = (entry.steps || []).map((step) => {
        if (step.comment) return { comment: step.comment };
        if (step.cmd) {
          return { cmd: step.cmd, value: step.value, durationMs: step.durationMs };
        }
        if (step.req) return { req: step.req };
        return null;
      }).filter(Boolean);
    }
    return base;
  }),
});

export const applyDiagProfileData = (data = {}) => {
  if (!resetCustomButtonsFn || !addCustomButtonEntryFn) return;
  resetCustomButtonsFn();
  const buttons = Array.isArray(data.customButtons) ? data.customButtons : [];
  buttons.forEach((entry, idx) => {
    if (entry?.type === 'script') {
      const steps = (entry.steps || []).map((step) => {
        if (step?.comment) return { comment: step.comment };
        if (step?.cmd) {
          if (step.cmd === 'SLEEP') {
            const parsed = step.durationMs ? { value: step.value, durationMs: step.durationMs } : parseSleepCommand(step.value || '');
            return parsed
              ? { cmd: 'SLEEP', value: parsed.value, durationMs: parsed.durationMs }
              : { cmd: 'SLEEP', value: step.value, durationMs: step.durationMs };
          }
          return { cmd: step.cmd };
        }
        if (step?.req) return { req: normalizeDiagRaw(step.req) };
        return null;
      }).filter(Boolean);
      addCustomButtonEntryFn({
        id: `script-${Date.now()}-${idx}`,
        type: 'script',
        name: entry.name || entry.label || 'Script',
        label: entry.label || entry.name || 'Script',
        steps,
      });
      return;
    }
    if (entry?.req) {
      addCustomButtonEntryFn({
        id: `custom-${Date.now()}-${idx}`,
        type: 'manual',
        group: entry.group || 'functional',
        req: normalizeDiagRaw(entry.req),
        ecuId: entry.ecuId || '',
        timeout: entry.timeout,
        label: entry.label || entry.name || entry.req,
        name: entry.name || entry.label || 'Custom',
      });
    }
  });
  diagCustomCounters.functional = diagCustomButtons.filter((btn) => btn.type === 'manual' && btn.group === 'functional').length;
  diagCustomCounters.physical = diagCustomButtons.filter((btn) => btn.type === 'manual' && btn.group === 'physical').length;
};

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

  const loadScriptBtn = $('#btn-diag-load-script');
  const stopScriptBtn = $('#btn-diag-stop-script');
  const scriptFileInput = $('#diag-script-file');
  const customButtonsContainer = $('#diag-custom-buttons');
  const sendBtn = $('#btn-diag-send');
  const sendDidBtn = $('#btn-diag-send-did');
  const unlockBtn = $('#btn-diag-unlock');
  const tpButton = $('#btn-tp-toggle');

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

  const updateDiagActionDisabledState = () => {
    const blocked = !startLogActive || scriptExecution.running;
    [sendBtn, sendDidBtn, unlockBtn, tpButton].forEach((btn) => {
      if (btn) btn.disabled = blocked;
    });
    if (loadScriptBtn) loadScriptBtn.disabled = scriptExecution.running;
    if (stopScriptBtn) stopScriptBtn.disabled = !scriptExecution.running;
  };

  const syncStartLogState = () => {
    const logToggle = $('#btn-log-toggle');
    const nextState = logToggle?.getAttribute('aria-pressed') === 'true';
    startLogActive = !!nextState;
    updateDiagActionDisabledState();
  };

  const observeStartLogToggle = () => {
    const logToggle = $('#btn-log-toggle');
    if (!logToggle || typeof MutationObserver === 'undefined') {
      syncStartLogState();
      return;
    }
    syncStartLogState();
    const observer = new MutationObserver(syncStartLogState);
    observer.observe(logToggle, { attributes: true, attributeFilter: ['aria-pressed', 'class'] });
    logToggle.addEventListener('click', syncStartLogState);
  };

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

  const clearDiagLog = () => {
    diagBuffer.length = 0;
    if (diagLog) {
      diagLog.innerHTML = '';
    }
    stickToBottom = true;
    diagLogScroll(true);
  };

  diagLog?.addEventListener('scroll', () => {
    stickToBottom = isNearBottom(diagLog);
  });

  const renderDiagEntry = (entry) => {
    if (!diagLog) return;
    const shouldStick = isNearBottom(diagLog);
    const { type = 'info', payload = '', canId = '', time } = entry;
    const logEntry = document.createElement('div');
    logEntry.className = `diag-log-entry ${type}`;

    const body = document.createElement('div');
    body.className = type === 'req' ? 'diag-log-req' : 'diag-log-resp';
    body.style.color = 'inherit';
    body.textContent = payload;
    logEntry.appendChild(body);

    const meta = document.createElement('div');
    meta.className = 'diag-log-meta';

    const tsRow = document.createElement('div');
    tsRow.className = 'diag-log-time';
    const ts = document.createElement('span');
    ts.className = 'time';
    ts.textContent = (time || new Date()).toLocaleTimeString();
    const can = document.createElement('span');
    can.className = 'can-id';
    can.textContent = (canId || '—').toUpperCase();
    tsRow.appendChild(ts);
    tsRow.appendChild(can);

    const asciiRow = document.createElement('div');
    asciiRow.className = 'diag-log-ascii';
    asciiRow.textContent = decodeAsciiFromHex(payload);

    meta.appendChild(tsRow);
    meta.appendChild(asciiRow);

    logEntry.appendChild(meta);

    diagLog.appendChild(logEntry);
    stickToBottom = shouldStick;
  };

  const addDiagLogEntry = (data) => {
    const entry = { ...data, time: data.time || new Date() };
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

  const setSelectedCustomButton = (id) => {
    selectedCustomButtonId = id;
    if (!customButtonsContainer) return;
    customButtonsContainer.querySelectorAll('.diag-custom-btn').forEach((btn) => {
      btn.classList.toggle('is-selected', btn.dataset.customId === id);
    });
  };

  const removeCustomButtonById = (id) => {
    const idx = diagCustomButtons.findIndex((btn) => btn.id === id);
    if (idx >= 0) {
      diagCustomButtons.splice(idx, 1);
    }
    const btn = customButtonsContainer?.querySelector(`[data-custom-id="${id}"]`);
    if (btn) btn.remove();
    if (selectedCustomButtonId === id) {
      selectedCustomButtonId = null;
    }
  };

  const handleDeleteKey = (ev) => {
    if (ev.key !== 'Delete') return;
    if (typeof getActiveTab === 'function' && getActiveTab() !== 'diag') return;
    if (startLogActive) return;
    if (!selectedCustomButtonId) return;
    ev.preventDefault();
    removeCustomButtonById(selectedCustomButtonId);
  };

  window.addEventListener('keydown', handleDeleteKey);

  const sendDiagRequest = async ({ group, raw, ecuId, timeout, label, allowDuringScript = false }) => {
    const settings = diagGroups[group];
    if (!settings) return;
    if (!startLogActive) {
      addDiagLogEntry({ type: 'warn', payload: 'Start Log to run diagnostics' });
      return;
    }
    if (scriptExecution.running && !allowDuringScript) {
      if (!scriptExecution.warnedManualSend) {
        addDiagLogEntry({ type: 'warn', payload: 'Script is running. Stop it before sending another request.' });
        scriptExecution.warnedManualSend = true;
      }
      return;
    }
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
      addDiagLogEntry({ type: 'warn', payload: 'Request payload is empty', canId: target?.toUpperCase?.() });
      return;
    }
    const sentAt = new Date();
    try {
      const res = await fetch('/api/diag/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: false }));
      addDiagLogEntry({ type: 'req', payload: payload.data, canId: target?.toUpperCase?.(), time: sentAt });
      if (js.ok) {
        const responsePayload = stringifyPayload(js.response);
        if (responsePayload) {
          const responseType = isNegativeResponse(responsePayload) ? 'warn' : 'resp';
          addDiagLogEntry({
            type: responseType,
            payload: responsePayload,
            canId: js.ecu_id || target?.toUpperCase?.(),
            time: new Date(),
          });
        } else {
          addDiagLogEntry({
            type: 'error',
            payload: 'No response from ECU (timeout)',
            canId: js.ecu_id || target?.toUpperCase?.(),
            time: new Date(),
          });
        }
      } else {
        addDiagLogEntry({
          type: 'error',
          payload: stringifyPayload(js.error) || 'No response from ECU (timeout)',
          canId: target?.toUpperCase?.(),
          time: new Date(),
        });
      }
      diagLogScroll(true);
    } catch (err) {
      addDiagLogEntry({ type: 'req', payload: payload.data, canId: target?.toUpperCase?.(), time: sentAt });
      addDiagLogEntry({
        type: 'error',
        payload: stringifyPayload(err.message) || 'No response from ECU (timeout)',
        canId: target?.toUpperCase?.(),
        time: new Date(),
      });
      diagLogScroll(true);
    }
  };

  let executeScriptButton = async () => {};

  const renderCustomButton = (entry) => {
    if (!customButtonsContainer) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'diag-custom-btn';
    btn.dataset.customId = entry.id;
    btn.textContent = entry.label || entry.name || entry.req || 'Custom';
    const selectOnly = () => setSelectedCustomButton(entry.id);
    btn.addEventListener('mousedown', selectOnly);
    btn.addEventListener('focus', selectOnly);
    btn.addEventListener('click', () => {
      setSelectedCustomButton(entry.id);
      if (!startLogActive) return;
      if (scriptExecution.running) return;
      if (entry.type === 'script') {
        executeScriptButton(entry);
      } else {
        sendDiagRequest({
          group: entry.group || currentGroup,
          raw: entry.req,
          ecuId: entry.ecuId,
          timeout: entry.timeout,
          label: entry.label,
        });
      }
    });
    customButtonsContainer.appendChild(btn);
    return btn;
  };

  const addCustomButtonEntry = (entry) => {
    diagCustomButtons.push(entry);
    renderCustomButton(entry);
  };

  const resetCustomButtons = () => {
    diagCustomButtons.length = 0;
    if (customButtonsContainer) {
      customButtonsContainer.innerHTML = '';
    }
    setSelectedCustomButton(null);
    diagCustomCounters.functional = 0;
    diagCustomCounters.physical = 0;
  };

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
      addDiagLogEntry({ type: 'warn', payload: 'Cannot add custom sender without payload' });
      return;
    }
    const normalized = normalizeDiagRaw(rawInput.value);
    const ecuId = ecuInput ? ecuInput.value.trim() : '';
    const timeout = timeoutInput ? Number(timeoutInput.value || 500) : 500;
    const index = ++diagCustomCounters[group];
    const label = `${settings.defaultLabel} ${index}`;
    const preview = normalized.split(' ').slice(0, 3).join(' ');
    const buttonLabel = preview ? `${label}: ${preview}` : label;
    addCustomButtonEntry({
      id: `custom-${Date.now()}-${diagCustomButtons.length}`,
      type: 'manual',
      group,
      req: normalized,
      ecuId,
      timeout,
      label: buttonLabel,
      name: label,
    });
  };

  $('#btn-diag-send')?.addEventListener('click', () => sendDiagRequest({ group: currentGroup }));
  $('#btn-diag-send-did')?.addEventListener('click', () => {
    const valueInput = $('#diag-did-value');
    const baseInput = $('#diag-request-raw');
    if (!valueInput || !baseInput) return;
    const base = normalizeDiagRaw(baseInput.value);
    if (!base) {
      addDiagLogEntry({ type: 'warn', payload: 'Base request is empty' });
      return;
    }
    const decimal = Number(valueInput.value);
    if (!Number.isInteger(decimal) || decimal < 0 || decimal > 255) {
      addDiagLogEntry({ type: 'warn', payload: 'Value must be 0-255' });
      return;
    }
    const hexValue = decimal.toString(16).toUpperCase().padStart(2, '0');
    const request = `${base} ${hexValue}`.trim();
    sendDiagRequest({ group: currentGroup, raw: request, label: 'Send DID' });
  });

  $('#btn-diag-add')?.addEventListener('click', () => createCustomDiagButton(currentGroup));

  loadScriptBtn?.addEventListener('click', () => {
    if (!scriptFileInput) return;
    scriptFileInput.click();
  });

  scriptFileInput?.addEventListener('change', async () => {
    const file = scriptFileInput.files?.[0];
    scriptFileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const steps = parseScriptText(text);
      const name = normalizeFileName(file.name);
      addCustomButtonEntry({
        id: `script-${Date.now()}-${diagCustomButtons.length}`,
        type: 'script',
        name,
        label: name,
        steps,
      });
    } catch (err) {
      const message = err?.message || 'Invalid script file';
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(message);
      }
    }
  });

  stopScriptBtn?.addEventListener('click', () => {
    if (!scriptExecution.running) return;
    scriptExecution.cancelFlag = true;
  });

  $('#btn-diag-clear-log')?.addEventListener('click', clearDiagLog);

  const performUnlock = async () => {
    if (!startLogActive) {
      addDiagLogEntry({ type: 'warn', payload: 'Start Log to run diagnostics' });
      return false;
    }
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
          type: 'info',
          payload: payload.dll ? `DLL: ${payload.dll}` : 'Unlocked',
          canId: js.ecu_id,
        });
        return true;
      }
      addDiagLogEntry({
        type: 'error',
        payload: stringifyPayload(js.error || 'Unlock failed'),
        canId: payload.ecu_id,
      });
    } catch (err) {
      addDiagLogEntry({
        type: 'error',
        payload: stringifyPayload(err.message || 'Unlock failed'),
        canId: payload.ecu_id,
      });
    }
    return false;
  };

  $('#btn-diag-unlock')?.addEventListener('click', performUnlock);

  let testerPresentActive = false;
  const setTpState = (active) => {
    testerPresentActive = active;
    if (!tpButton) return;
    tpButton.textContent = active ? 'Stop Tester Present' : 'Start Tester Present';
    tpButton.setAttribute('aria-pressed', active ? 'true' : 'false');
  };
  setTpState(false);

  const requestTesterPresent = async (action) => {
    if (!startLogActive) {
      addDiagLogEntry({ type: 'warn', payload: 'Start Log to run diagnostics' });
      return false;
    }
    const payload =
      action === 'start'
        ? { action: 'start', interval: getTesterPresentInterval() }
        : { action: 'stop' };
    try {
      const res = await fetch('/api/diag/tester_present', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(res.statusText || 'Tester Present failed');
      setTpState(action === 'start');
      return true;
    } catch (err) {
      addDiagLogEntry({ type: 'error', payload: stringifyPayload(err.message || 'ERR') });
    }
    return false;
  };

  tpButton?.addEventListener('click', async () => {
    await requestTesterPresent(testerPresentActive ? 'stop' : 'start');
  });

  const setScriptRunning = (running) => {
    scriptExecution.running = running;
    if (!running) {
      scriptExecution.cancelFlag = false;
      scriptExecution.currentButtonId = null;
      scriptExecution.startedTesterPresent = false;
      scriptExecution.warnedManualSend = false;
    }
    if (running) scriptExecution.warnedManualSend = false;
    updateDiagActionDisabledState();
  };

  const runScriptCommand = async (step) => {
    const describeCommand = () => {
      if (step.cmd === 'SLEEP') {
        const display = (step.value || '')
          .toString()
          .replace(/MS$/, ' ms')
          .replace(/S$/, ' s');
        return `CMD: SLEEP ${display}`.trim();
      }
      if (step.cmd === 'TESTER_PRESENT_START') return 'CMD: TESTER PRESENT START';
      if (step.cmd === 'TESTER_PRESENT_STOP') return 'CMD: TESTER PRESENT STOP';
      if (step.cmd === 'UNLOCK_SECA') return 'CMD: UNLOCK SECURITY ACCESS';
      return 'CMD';
    };

    addDiagLogEntry({ type: 'info', payload: describeCommand() });

    if (step.cmd === 'SLEEP') {
      await new Promise((resolve) => setTimeout(resolve, step.durationMs || 0));
      return;
    }
    if (step.cmd === 'TESTER_PRESENT_START') {
      if (!testerPresentActive) {
        const started = await requestTesterPresent('start');
        if (started) scriptExecution.startedTesterPresent = true;
      }
      return;
    }
    if (step.cmd === 'TESTER_PRESENT_STOP') {
      if (scriptExecution.startedTesterPresent && testerPresentActive) {
        await requestTesterPresent('stop');
        scriptExecution.startedTesterPresent = false;
      }
      return;
    }
    if (step.cmd === 'UNLOCK_SECA') {
      await performUnlock();
    }
  };

  executeScriptButton = async (entry) => {
    if (scriptExecution.running || !startLogActive) return;
    scriptExecution.cancelFlag = false;
    scriptExecution.currentButtonId = entry.id;
    setScriptRunning(true);
    try {
      for (const step of entry.steps || []) {
        if (scriptExecution.cancelFlag) break;
        if (step.comment) continue;
        if (step.cmd) {
          await runScriptCommand(step);
        } else if (step.req) {
          await sendDiagRequest({ group: currentGroup, raw: step.req, allowDuringScript: true });
        }
        if (scriptExecution.cancelFlag) break;
      }
    } finally {
      const wasCancelled = scriptExecution.cancelFlag;
      if (scriptExecution.startedTesterPresent && testerPresentActive) {
        await requestTesterPresent('stop');
      }
      setScriptRunning(false);
      addDiagLogEntry({
        type: 'info',
        payload: wasCancelled ? 'Script stopped by user' : 'Script finished',
      });
    }
  };

  observeStartLogToggle();
  updateDiagActionDisabledState();

  addCustomButtonEntryFn = addCustomButtonEntry;
  resetCustomButtonsFn = resetCustomButtons;
}
