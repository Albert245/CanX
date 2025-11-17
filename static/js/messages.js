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
  let busConnected = false;
  let dbcLoaded = false;

  const titleEl = $('#msg-title');
  const metaEl = $('#msg-meta');
  const form = $('#signals-form');
  const statusEl = $('#msg-status');
  const toggleBtn = $('#btn-toggle-periodic');
  const initStatusEl = $('#init-status');
  const connectionToggle = $('#btn-connection-toggle');
  const resetMessagesBtn = $('#btn-reset-signals');

  const setInitStatus = (text, tone = 'info') => {
    if (!initStatusEl) return;
    if (!text) {
      initStatusEl.textContent = '';
      initStatusEl.removeAttribute('data-tone');
      return;
    }
    initStatusEl.textContent = text;
    initStatusEl.dataset.tone = tone;
  };

  const updateConnectionButton = () => {
    if (!connectionToggle) return;
    connectionToggle.textContent = busConnected ? 'Disconnect' : 'Connect';
    connectionToggle.setAttribute('aria-pressed', busConnected ? 'true' : 'false');
    connectionToggle.classList.toggle('is-active', busConnected);
  };

  const updateResetButtonState = () => {
    if (!resetMessagesBtn) return;
    resetMessagesBtn.disabled = !dbcLoaded;
  };

  const setToggleState = (running) => {
    if (!toggleBtn) return;
    if (running === null) {
      toggleBtn.textContent = 'Activate';
      toggleBtn.dataset.state = 'inactive';
      toggleBtn.disabled = true;
      return;
    }
    toggleBtn.disabled = false;
    toggleBtn.textContent = running ? 'Deactivate' : 'Activate';
    toggleBtn.dataset.state = running ? 'active' : 'inactive';
  };

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
      setToggleState(currentMessageInfo.running);
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
    setToggleState(null);
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
    setToggleState(null);
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

  const buildInitPayload = () => ({
    device: $('#device')?.value,
    channel: Number($('#channel')?.value || 0),
    is_fd: !!$('#is_fd')?.checked,
    padding: $('#padding')?.value || '00',
    dbc_path: $('#dbc_path')?.value || null,
  });

  const connectBus = async () => {
    if (!connectionToggle) return;
    connectionToggle.disabled = true;
    connectionToggle.textContent = 'Connecting…';
    try {
      const payload = buildInitPayload();
      const response = await fetch('/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Failed to connect');
      }
      busConnected = true;
      dbcLoaded = !!json.dbc_loaded;
      setInitStatus(`Connected - DBC: ${json.dbc_loaded ? 'yes' : 'no'}`, json.dbc_loaded ? 'success' : 'warning');
      stimApi?.resetNodes?.();
    } catch (err) {
      setInitStatus(err.message || 'Failed to connect to CAN bus.', 'error');
    } finally {
      connectionToggle.disabled = false;
      updateConnectionButton();
      updateResetButtonState();
    }
  };

  const disconnectBus = async () => {
    if (!connectionToggle) return;
    connectionToggle.disabled = true;
    connectionToggle.textContent = 'Disconnecting…';
    try {
      const response = await fetch('/api/shutdown', { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Failed to disconnect');
      }
      busConnected = false;
      dbcLoaded = !!json.dbc_loaded;
      setInitStatus('Disconnected from CAN bus.', 'info');
      stimApi?.resetNodes?.();
    } catch (err) {
      setInitStatus(err.message || 'Failed to disconnect from CAN bus.', 'error');
    } finally {
      connectionToggle.disabled = false;
      updateConnectionButton();
      updateResetButtonState();
    }
  };

  connectionToggle?.addEventListener('click', () => {
    if (connectionToggle.disabled) return;
    if (busConnected) {
      disconnectBus();
    } else {
      connectBus();
    }
  });

  resetMessagesBtn?.addEventListener('click', async () => {
    if (!dbcLoaded) {
      setInitStatus('DBC not loaded. Connect before initializing.', 'warning');
      return;
    }
    resetMessagesBtn.disabled = true;
    const original = resetMessagesBtn.textContent;
    resetMessagesBtn.textContent = 'Initializing…';
    try {
      const response = await fetch('/api/messages/reset', { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Failed to initialize messages');
      }
      const snapshots = json.messages || {};
      Object.entries(snapshots).forEach(([msgName, applied]) => {
        notifyMessageSignalsUpdated(msgName, applied, { source: 'reset' });
      });
      setInitStatus('Messages reset to default values.', 'success');
    } catch (err) {
      setInitStatus(err.message || 'Failed to reset messages.', 'error');
    } finally {
      resetMessagesBtn.textContent = original;
      resetMessagesBtn.disabled = !dbcLoaded;
    }
  });

  updateConnectionButton();
  updateResetButtonState();

  const loadDbcButton = $('#btn-load-dbc');
  loadDbcButton?.addEventListener('click', async () => {
    const response = await fetch('/api/dbc/messages');
    const json = await response.json().catch(() => ({ ok: false }));
    if (!json.ok) return;
    messages = json.messages || [];
    activeMessages.clear();
    clearCurrentMessageView();
    dbcLoaded = true;
    updateResetButtonState();
    if (stimApi) {
      stimApi.resetNodes?.();
      await stimApi.loadNodes?.();
    }
  });

  $('#msg-search')?.addEventListener('input', renderMessageList);

  toggleBtn?.addEventListener('click', async () => {
    if (!currentMessage) return;
    const isRunning = activeMessages.get(currentMessage.name) === true;
    const endpoint = isRunning ? '/api/periodic/stop' : '/api/periodic/start';
    const payload = isRunning
      ? { message: currentMessage.name }
      : {
          message: currentMessage.name,
          period: Number($('#msg-period')?.value || 100),
          duration: Number($('#msg-duration')?.value || 0) || null,
        };
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = isRunning ? 'Deactivating…' : 'Activating…';
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error('Failed to toggle message');
      }
      await selectMessage(currentMessage);
      notifyMessageStateChange(currentMessage.name, !isRunning, { source: 'messages' });
    } catch (err) {
      window.alert(err.message || 'Failed to toggle message');
    } finally {
      const runningNow = activeMessages.get(currentMessage?.name || '') === true;
      setToggleState(currentMessage ? runningNow : null);
      if (toggleBtn) {
        toggleBtn.disabled = !currentMessage;
      }
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

  setToggleState(null);
  return {};
}
