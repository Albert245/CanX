const listeners = new Set();

export const subscribeTraceEntries = (listener) => {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const broadcastTraceEntry = (entry) => {
  if (!entry) return;
  listeners.forEach((listener) => {
    try {
      listener(entry);
    } catch (err) {
      console.error('Trace bus listener error', err);
    }
  });
};
