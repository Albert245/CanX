/**
 * @fileoverview Implements Diagnostics tab actions including requests, security
 * unlock, tester present control, and log rendering.
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

export function initDiag() {
  const diagLog = $('#diag-log');

  const diagLogScroll = () => {
    if (!diagLog) return;
    diagLog.scrollTop = diagLog.scrollHeight;
  };

  const addDiagLogEntry = ({ label, ecuId, request, response, error }) => {
    if (!diagLog) return;
    const entry = document.createElement('div');
    entry.className = 'diag-log-entry';
    entry.classList.add(error ? 'error' : 'success');

    const meta = document.createElement('div');
    meta.className = 'diag-log-meta';
    const ts = document.createElement('span');
    ts.className = 'diag-log-time';
    ts.textContent = new Date().toLocaleTimeString();
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
    entry.appendChild(meta);

    if (request) {
      const req = document.createElement('pre');
      req.className = 'diag-log-req';
      req.textContent = `REQ: ${request}`;
      entry.appendChild(req);
    }

    if (error) {
      const err = document.createElement('pre');
      err.className = 'diag-log-resp';
      err.textContent = `ERR: ${error}`;
      entry.appendChild(err);
    } else if (response !== undefined) {
      const resp = document.createElement('pre');
      resp.className = 'diag-log-resp';
      const body = Array.isArray(response) ? response.join(' ') : response || '';
      resp.textContent = body ? `RESP: ${body}` : 'RESP: <no data>';
      entry.appendChild(resp);
    }

    diagLog.appendChild(entry);
    diagLogScroll();
  };

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

  const diagCustomCounters = {
    functional: 0,
    physical: 0,
  };

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
      sendDiagRequest({
        group,
        raw: normalized,
        ecuId,
        timeout,
        label,
      });
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
    const status = $('#diag-unlock-status');
    if (status) {
      status.textContent = '';
      status.style.color = '#9aa0a6';
    }
    try {
      const res = await fetch('/api/diag/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: false }));
      if (js.ok) {
        const ecuField = $('#diag-physical-id');
        if (ecuField && js.ecu_id) {
          ecuField.value = js.ecu_id;
        }
        addDiagLogEntry({
          label: 'Diagnostics Configured',
          ecuId: `${js.ecu_id || payload.ecu_id}/${js.tester_id || payload.tester_id}`,
          request: js.dll ? `DLL: ${js.dll}` : undefined,
        });
      } else {
        addDiagLogEntry({
          label: 'Diagnostics Config',
          error: js.error || 'ERR',
        });
      }
    } catch (err) {
      addDiagLogEntry({
        label: 'Diagnostics Config',
        error: err.message || 'ERR',
      });
    }
  });

  $('#btn-functional-send')?.addEventListener('click', () =>
    sendDiagRequest({ group: 'functional' }),
  );

  $('#btn-physical-send')?.addEventListener('click', () =>
    sendDiagRequest({ group: 'physical' }),
  );

  $('#btn-functional-add')?.addEventListener('click', () => createCustomDiagButton('functional'));
  $('#btn-physical-add')?.addEventListener('click', () => createCustomDiagButton('physical'));

  $('#btn-diag-unlock')?.addEventListener('click', async () => {
    const status = $('#diag-unlock-status');
    if (status) {
      status.textContent = 'Unlocking...';
      status.style.color = '#9aa0a6';
    }
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
      if (status) {
        if (js.ok) {
          const ecu = js.ecu_id ? ` ${js.ecu_id}` : '';
          status.textContent = `Security unlocked${ecu}`.trim();
          status.style.color = '#4caf50';
          addDiagLogEntry({
            label: 'Security Unlock',
            ecuId: js.ecu_id,
            request: payload.dll ? `DLL: ${payload.dll}` : undefined,
            response: 'Unlocked',
          });
        } else {
          status.textContent = js.error || 'Unlock failed';
          status.style.color = '#f88';
          addDiagLogEntry({
            label: 'Security Unlock',
            ecuId: payload.ecu_id,
            error: js.error || 'Unlock failed',
          });
        }
      }
    } catch (err) {
      if (status) {
        status.textContent = err.message || 'Unlock failed';
        status.style.color = '#f88';
      }
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
