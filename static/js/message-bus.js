/**
 * Lightweight pub/sub helpers for synchronizing message state and signal data
 * across tabs.
 */

const bus = new EventTarget();

const EVENTS = {
  STATE: 'message:state',
  SIGNALS: 'message:signals',
};

const emit = (type, detail) => {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
};

export const notifyMessageStateChange = (message, running, { source = null } = {}) => {
  if (!message) return;
  emit(EVENTS.STATE, { message, running: !!running, source });
};

export const notifyMessageSignalsUpdated = (message, applied, { source = null } = {}) => {
  if (!message || !applied) return;
  emit(EVENTS.SIGNALS, { message, applied, source });
};

export const onMessageStateChange = (handler) => {
  if (typeof handler !== 'function') return () => {};
  const listener = (evt) => {
    try {
      handler(evt.detail || {});
    } catch (err) {
      console.error(err);
    }
  };
  bus.addEventListener(EVENTS.STATE, listener);
  return () => bus.removeEventListener(EVENTS.STATE, listener);
};

export const onMessageSignalsUpdated = (handler) => {
  if (typeof handler !== 'function') return () => {};
  const listener = (evt) => {
    try {
      handler(evt.detail || {});
    } catch (err) {
      console.error(err);
    }
  };
  bus.addEventListener(EVENTS.SIGNALS, listener);
  return () => bus.removeEventListener(EVENTS.SIGNALS, listener);
};
