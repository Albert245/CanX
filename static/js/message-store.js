/**
 * Central store for user-defined message signal values so they persist across
 * tabs, disconnects, and activation cycles.
 */

import { applySignalUpdates } from './signal-utils.js';

const store = new Map();

const clone = (obj) => {
  if (!obj) return null;
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (err) {
    return null;
  }
};

const toAppliedFromSignals = (signals = {}) => {
  const applied = {};
  Object.entries(signals || {}).forEach(([name, info]) => {
    if (!info) return;
    const entry = {};
    if (info.raw) {
      entry.raw_hex = info.raw;
    } else if (info.physical !== undefined && info.physical !== null) {
      const numeric = Number(info.physical);
      if (!Number.isNaN(numeric)) {
        entry.physical = numeric;
      }
    }
    if (Object.keys(entry).length) {
      applied[name] = entry;
    }
  });
  return applied;
};

const toPayloadFromApplied = (applied = {}) => {
  const payload = {};
  Object.entries(applied || {}).forEach(([name, info]) => {
    if (!info) return;
    if (info.raw_hex || info.raw) {
      payload[name] = { raw: info.raw_hex || info.raw };
      return;
    }
    if (info.raw_unsigned !== undefined && info.raw_unsigned !== null) {
      const numeric = Number(info.raw_unsigned);
      if (!Number.isNaN(numeric)) {
        payload[name] = { raw: `0x${numeric.toString(16).toUpperCase()}` };
        return;
      }
    }
    if (info.physical !== undefined && info.physical !== null) {
      payload[name] = { physical: info.physical };
    }
  });
  return payload;
};

const normalizeEntry = ({ signals = null, applied = null, pending = false } = {}) => {
  const payload = signals ? clone(signals) : toPayloadFromApplied(applied);
  const appliedValues = applied ? clone(applied) : toAppliedFromSignals(payload);
  if (!payload && !appliedValues) return null;
  return { payload: payload || null, applied: appliedValues || null, pending: !!pending };
};

export const saveMessageSignals = (message, data = {}) => {
  if (!message) return;
  const normalized = normalizeEntry(data);
  if (!normalized) return;
  const existing = store.get(message) || {};
  store.set(message, {
    ...existing,
    ...normalized,
  });
};

export const markPendingSignals = (message) => {
  if (!message || !store.has(message)) return;
  const entry = store.get(message);
  store.set(message, { ...entry, pending: true });
};

export const applyStoredSignalsToForm = (message, container) => {
  if (!message || !container) return;
  const entry = store.get(message);
  if (!entry?.applied) return;
  applySignalUpdates(container, entry.applied);
};

export const getMessagePayload = (message) => {
  const entry = message ? store.get(message) : null;
  return entry?.payload ? clone(entry.payload) : null;
};

export const getAllMessagePayloads = () => {
  const output = {};
  store.forEach((entry, name) => {
    if (entry?.payload) {
      output[name] = clone(entry.payload);
    }
  });
  return output;
};

export const seedMessagesFromSnapshots = (snapshots = {}) => {
  Object.entries(snapshots).forEach(([name, applied]) => {
    saveMessageSignals(name, { applied, pending: false });
  });
};

export const syncStoredSignals = async (message, { endpoint = '/api/periodic/update' } = {}) => {
  const payload = getMessagePayload(message);
  if (!message || !payload) {
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_name: message, signals: payload }),
    });
    const js = await res.json().catch(() => ({}));
    if (!res.ok || js.ok === false) {
      throw new Error(js?.error || res.statusText || 'Update failed');
    }
    saveMessageSignals(message, { signals: payload, applied: js.applied || null, pending: false });
    return { ok: true };
  } catch (err) {
    markPendingSignals(message);
    return { ok: false, error: err?.message || 'Update failed' };
  }
};

export const reapplyStoreToVisibleForms = () => {
  const currentMsg = document.getElementById('msg-details')?.dataset?.message;
  if (currentMsg) {
    applyStoredSignalsToForm(currentMsg, document.getElementById('signals-form'));
  }
  document.querySelectorAll('.stim-message').forEach((detail) => {
    const name = detail?.dataset?.message;
    const body = detail.querySelector('.stim-signals');
    if (name && body) {
      applyStoredSignalsToForm(name, body);
    }
  });
};
