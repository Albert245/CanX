const $ = (selector, ctx = document) => ctx.querySelector(selector);

export async function startReceiverNodeFromSettings() {
  const featureToggle = document.querySelector('#receiver-activate-all');
  if (featureToggle && !featureToggle.checked) {
    return { ok: false, reason: 'feature-disabled' };
  }
  const nodeName = $('#dbc-node')?.value.trim();
  if (!nodeName) return { ok: false, reason: 'missing-node' };
  try {
    const res = await fetch('/api/dbc/nodes');
    const js = await res.json().catch(() => ({ ok: false }));
    const nodes = js?.nodes || {};
    if (!js.ok || !nodes[nodeName]) {
      return { ok: false, reason: 'node-unavailable' };
    }
    const startRes = await fetch('/api/stim/node/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: nodeName, role: 'receiver' }),
    });
    const startJs = await startRes.json().catch(() => ({ ok: false }));
    if (!startRes.ok || !startJs.ok) {
      return { ok: false, reason: startJs.error || 'start-failed' };
    }
    return { ok: true, node: nodeName };
  } catch (err) {
    console.warn('Failed to start receiver node', err);
    return { ok: false, reason: err?.message || 'error' };
  }
}
