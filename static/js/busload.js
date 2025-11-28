import { subscribeTraceEntries } from './trace_bus.js';

const monotonicSeconds = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
};

const parseDlc = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
};

const estimateBits = (entry = {}) => {
  const dlc = parseDlc(entry.dlc);
  const payloadBits = dlc * 8;
  const framingBits = entry.isFd ? 70 : 55;
  return payloadBits + framingBits;
};

export function initBusloadMonitor({ targetId = '#busload-status', windowSec = 5 } = {}) {
  const target = document.querySelector(targetId);
  if (!target) return () => {};

  const buffer = [];

  const prune = (now) => {
    while (buffer.length && now - buffer[0].ts > windowSec) {
      buffer.shift();
    }
  };

  const render = () => {
    const now = monotonicSeconds();
    prune(now);
    if (!buffer.length) {
      target.textContent = '—';
      target.removeAttribute('data-tone');
      return;
    }
    const duration = Math.max(now - buffer[0].ts, 0.5);
    const bits = buffer.reduce((sum, item) => sum + item.bits, 0);
    const kbps = (bits / duration) / 1000;
    target.textContent = `${kbps.toFixed(1)} kbps`;
    target.dataset.tone = kbps > 750 ? 'warning' : 'info';
  };

  const onEntry = (entry) => {
    const now = monotonicSeconds();
    buffer.push({ ts: now, bits: estimateBits(entry) });
    prune(now);
    render();
  };

  const timer = window.setInterval(render, 1000);
  const unsubscribe = subscribeTraceEntries(onEntry);
  render();

  return () => {
    unsubscribe();
    window.clearInterval(timer);
  };
}
