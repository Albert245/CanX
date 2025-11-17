/**
 * @fileoverview Handles the Messages tab: DBC loading, message selection, and
 * periodic signal updates.
 */

import {
  createSignalRow,
  gatherSignalValues,
  applySignalUpdates,
  shouldDisplaySignal,
} from './signal-utils.js';
import {
  notifyMessageSignalsUpdated,
  notifyMessageStateChange,
  onMessageSignalsUpdated,
  onMessageStateChange,
} from './message-bus.js';

const $ = (selector, ctx = document) => ctx.querySelector(selector);

export function initMessages({ stimApi } = {}) {
  let currentMessage = null;
  let currentMessageInfo = null;
  let messages = [];
  const activeMessages = new Map();

  const titleEl = $('#msg-title');
  const metaEl = $('#msg-meta');
  const form = $('#signals-form');
  const statusEl = $('#msg-status');

  const setStatusText = (running) => {
    if (!statusEl) return;
    if (running === null) {
      statusEl.textContent = '';
      statusEl.removeAttribute('data-state');
      return;
    }
    statusEl.textContent = running ? 'active' : 'inactive';
    statusEl.dataset.state = running ? 'active' : 'inactive';
  };

  const renderMeta = () => {
    if (!metaEl) return;
    if (!currentMessage) {
      metaEl.textContent = '';
      return;
    }
    const info = currentMessageInfo || {};
    const parts = [];
    parts.push(`DLC: ${currentMessage.dlc ?? info.dlc ?? '-'}`);
    const cycleValue = info.cycle_time ?? currentMessage.cycle_time;
    parts.push(`Cycle: ${cycleValue ?? '-'}`);
    parts.push(`Extended: ${currentMessage.is_extended ? 'yes' : 'no'}`);
    parts.push(`Running: ${info.running ? 'active' : 'inactive'}`);
    metaEl.textContent = parts.join(' | ');
  };

  const setRunningState = (messageName, running) => {
    if (!messageName) return;
    activeMessages.set(messageName, !!running);
    if (currentMessage && currentMessage.name === messageName) {
      if (!currentMessageInfo) currentMessageInfo = {};
      currentMessageInfo.running = !!running;
      setStatusText(currentMessageInfo.running);
      renderMeta();
    }
    renderMessageList();
  };

  const clearCurrentMessageView = () => {
    currentMessage = null;
    currentMessageInfo = null;
    if (titleEl) {
      titleEl.textContent = 'Select a message';
    }
    if (form) {
      form.innerHTML = '';
    }
    setStatusText(null);
    renderMeta();
    renderMessageList();
  };

  const renderMessageList = () => {
    const list = $('#msg-list');
    if (!list) return;
    list.innerHTML = '';
    const query = String($('#msg-search')?.value || '').toLowerCase();
    messages
      .filter((m) => {
        const name = String(m.name || '').toLowerCase();
        const id = String(m.id_hex || '').toLowerCase();
        return name.includes(query) || id.includes(query);
      })
      .forEach((m) => {
        const item = document.createElement('li');
        const isRunning = activeMessages.get(m.name) === true;
        item.textContent = `${m.name} (${m.id_hex}) - ${isRunning ? 'active' : 'inactive'}`;
        item.addEventListener('click', () => selectMessage(m));
        if (currentMessage && currentMessage.name === m.name) {
          item.classList.add('active');
        }
        list.appendChild(item);
      });
  };

  async function selectMessage(message) {
    currentMessage = message;
    currentMessageInfo = null;
    if (titleEl) {
      titleEl.textContent = `${message.name} - ${message.id_hex}`;
    }
    if (form) {
      form.innerHTML = '';
    }
    setStatusText(null);
    const response = await fetch(`/api/dbc/message_info/${encodeURIComponent(message.name)}`);
    const json = await response.json().catch(() => ({ ok: false }));
    if (form) {
      if (json.ok && json.message?.signals) {
        json.message.signals
          .filter((signal) => shouldDisplaySignal(signal))
          .forEach((signal) => {
            form.appendChild(createSignalRow(signal, { variant: 'message' }));
          });
      } else {
        const errorRow = document.createElement('div');
        errorRow.className = 'signal-meta';
        errorRow.textContent = json.error || 'Failed to load message signals';
        form.appendChild(errorRow);
      }
    }
    currentMessageInfo = json.ok ? json.message || {} : {};
    setRunningState(message.name, !!currentMessageInfo.running);
    renderMessageList();
  }

  const initButton = $('#btn-init');
  initButton?.addEventListener('click', async () => {
    const payload = {
      device: $('#device')?.value,
      channel: Number($('#channel')?.value || 0),
      is_fd: !!$('#is_fd')?.checked,
      padding: $('#padding')?.value || '00',
      dbc_path: $('#dbc_path')?.value || null,
    };
    const response = await fetch('/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await response.json().catch(() => ({}));
    const status = $('#init-status');
    if (status) {
      status.textContent = json.ok
        ? `OK - DBC: ${json.dbc_loaded ? 'yes' : 'no'}`
        : json.error || 'ERR';
    }
    if (json.ok && stimApi) {
      stimApi.resetNodes?.();
    }
  });

  const loadDbcButton = $('#btn-load-dbc');
  loadDbcButton?.addEventListener('click', async () => {
    const response = await fetch('/api/dbc/messages');
    const json = await response.json().catch(() => ({ ok: false }));
    if (!json.ok) return;
    messages = json.messages || [];
    activeMessages.clear();
    clearCurrentMessageView();
    if (stimApi) {
      stimApi.resetNodes?.();
      await stimApi.loadNodes?.();
    }
  });

  $('#msg-search')?.addEventListener('input', renderMessageList);

  const startPeriodic = $('#btn-start-periodic');
  startPeriodic?.addEventListener('click', async () => {
    if (!currentMessage) return;
    const payload = {
      message: currentMessage.name,
      period: Number($('#msg-period')?.value || 100),
      duration: Number($('#msg-duration')?.value || 0) || null,
    };
    const res = await fetch('/api/periodic/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      await selectMessage(currentMessage);
      notifyMessageStateChange(currentMessage.name, true, { source: 'messages' });
    }
  });

  const stopPeriodic = $('#btn-stop-periodic');
  stopPeriodic?.addEventListener('click', async () => {
    if (!currentMessage) return;
    const payload = { message: currentMessage.name };
    const res = await fetch('/api/periodic/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      await selectMessage(currentMessage);
      notifyMessageStateChange(currentMessage.name, false, { source: 'messages' });
    }
  });

  const updateSignals = $('#btn-update-signals');
  updateSignals?.addEventListener('click', async () => {
    if (!currentMessage) return;
    if (!form) return;
    const signals = gatherSignalValues(form);
    const payload = {
      message_name: currentMessage.name,
      signals,
    };
    const res = await fetch('/api/periodic/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const js = await res.json().catch(() => ({ ok: false }));
    if (!js.ok) {
      window.alert(js.error || 'Failed to update signals');
      return;
    }
    applySignalUpdates(form, js.applied || {});
    let applied = js.applied;
    if (!applied || !Object.keys(applied).length) {
      const derived = {};
      Object.entries(signals).forEach(([name, info]) => {
        if (!info) return;
        derived[name] = { ...info };
      });
      applied = Object.keys(derived).length ? derived : null;
    }
    if (applied) {
      notifyMessageSignalsUpdated(currentMessage.name, applied, { source: 'messages' });
    }
  });

  const removeMessageBtn = $('#btn-remove-message');
  removeMessageBtn?.addEventListener('click', async () => {
    if (!currentMessage) return;
    const name = currentMessage.name;
    removeMessageBtn.disabled = true;
    const originalText = removeMessageBtn.textContent;
    removeMessageBtn.textContent = 'Removing…';
    try {
      const payload = { message: name };
      const res = await fetch('/api/periodic/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to remove message');
      setRunningState(name, false);
      notifyMessageStateChange(name, false, { source: 'messages' });
      clearCurrentMessageView();
    } catch (err) {
      window.alert(err.message || 'Failed to remove message');
    } finally {
      removeMessageBtn.disabled = false;
      removeMessageBtn.textContent = originalText || 'Remove';
    }
  });

  onMessageStateChange(({ message, running, source }) => {
    if (source === 'messages' || !message) return;
    setRunningState(message, !!running);
  });

  onMessageSignalsUpdated(({ message, applied, source }) => {
    if (source === 'messages' || !message || !applied) return;
    if (!currentMessage || currentMessage.name !== message || !form) return;
    applySignalUpdates(form, applied);
  });

  return {};
}
