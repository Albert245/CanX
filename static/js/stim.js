/**
 * @fileoverview Controls the Stimulation tab: node discovery, message display,
 * and signal editing helpers.
 */

import { createSignalRow, gatherSignalValues, applySignalUpdates } from './signal-utils.js';

const $ = (selector, ctx = document) => ctx.querySelector(selector);

export function initStim({ onTabChange } = {}) {
  const stimContainer = $('#stim-nodes-container');
  const nodeSelect = $('#stim-node-select');
  const stimStatus = $('#stim-status');
  const stimNodesAdded = new Set();
  let nodeMap = {};

  const setStimStatus = (text, isError = false) => {
    if (!stimStatus) return;
    stimStatus.textContent = text || '';
    stimStatus.style.color = isError ? '#f88' : '#9aa0a6';
  };

  const setMessageRunning = (detail, running) => {
    if (!detail) return;
    detail.dataset.running = running ? '1' : '0';
    const status = detail.querySelector('.stim-status');
    if (status) {
      status.textContent = running ? 'active' : 'inactive';
      status.dataset.state = running ? 'active' : 'inactive';
    }
    const toggle = detail.querySelector('.stim-message-toggle');
    if (toggle) {
      toggle.textContent = running ? 'Deactivate' : 'Activate';
    }
  };

  const updateNodeStatusFromMessages = (nodeDetail) => {
    if (!nodeDetail) return;
    const running = Array.from(nodeDetail.querySelectorAll('.stim-message')).some(
      (msg) => msg.dataset.running === '1',
    );
    nodeDetail.dataset.running = running ? '1' : '0';
    const status = nodeDetail.querySelector('.stim-node-status');
    if (status) {
      status.textContent = running ? 'active' : 'inactive';
      status.dataset.state = running ? 'active' : 'inactive';
    }
    const toggle = nodeDetail.querySelector('.stim-node-toggle');
    if (toggle) {
      toggle.textContent = running ? 'Deactivate' : 'Activate';
    }
  };

  const toggleMessageActivation = async (detail, messageName) => {
    if (!detail) return;
    const running = detail.dataset.running === '1';
    const status = detail.querySelector('.stim-status');
    if (status) {
      status.textContent = running ? 'stopping…' : 'starting…';
    }
    const endpoint = running ? '/api/periodic/stop' : '/api/periodic/start';
    const payload = running
      ? { message: messageName }
      : { message: messageName, period: null, duration: null };
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: res.ok }));
      if (!res.ok || (js && js.ok === false)) {
        const error = js?.error || res.statusText || 'Unable to toggle message';
        throw new Error(error);
      }
      await loadMessageSignals(detail, messageName);
      updateNodeStatusFromMessages(detail.closest('.stim-node'));
    } catch (err) {
      if (status) {
        status.textContent = `error: ${err.message || 'toggle failed'}`;
      }
    }
  };

  const toggleNodeActivation = async (detail, nodeName) => {
    if (!detail) return;
    const running = detail.dataset.running === '1';
    const status = detail.querySelector('.stim-node-status');
    if (status) {
      status.textContent = running ? 'stopping…' : 'starting…';
    }
    const endpoint = running ? '/api/stim/node/stop' : '/api/stim/node/start';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: nodeName }),
      });
      const js = await res.json().catch(() => ({ ok: res.ok }));
      if (!res.ok || (js && js.ok === false)) {
        const error = js?.error || res.statusText || 'Unable to toggle node';
        throw new Error(error);
      }
      const statuses = js?.statuses || {};
      detail.querySelectorAll('.stim-message').forEach((msgDetail) => {
        const name = msgDetail.dataset.message;
        if (Object.prototype.hasOwnProperty.call(statuses, name)) {
          setMessageRunning(msgDetail, !!statuses[name]);
        }
      });
      updateNodeStatusFromMessages(detail);
      setStimStatus('');
    } catch (err) {
      if (status) {
        status.textContent = `error: ${err.message || 'toggle failed'}`;
      }
      setStimStatus(err.message || 'Unable to toggle node', true);
    }
  };

  const populateNodeSelect = () => {
    if (!nodeSelect) return;
    nodeSelect.innerHTML = '';
    const names = Object.keys(nodeMap || {}).sort();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = names.length ? 'Select node' : 'No nodes available';
    placeholder.disabled = true;
    placeholder.selected = true;
    nodeSelect.appendChild(placeholder);
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      nodeSelect.appendChild(opt);
    });
  };

  const clearStimNodes = () => {
    if (stimContainer) {
      stimContainer.innerHTML = '';
    }
    stimNodesAdded.clear();
  };

  const buildSignalRow = (signal) => createSignalRow(signal, { variant: 'stim' });

  const loadMessageSignals = async (wrapper, messageName) => {
    const body = wrapper.querySelector('.stim-signals');
    const status = wrapper.querySelector('.stim-status');
    const meta = wrapper.querySelector('.stim-summary-meta');
    if (body) body.innerHTML = '';
    if (status) status.textContent = 'loading…';
    try {
      const res = await fetch(`/api/dbc/message_info/${encodeURIComponent(messageName)}`);
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) throw new Error(js.error || 'Failed to load message');
      const msg = js.message;
      if (meta) {
        const parts = [];
        if (msg.id_hex) {
          parts.push(`ID: ${msg.id_hex}`);
        }
        if (msg.cycle_time !== undefined && msg.cycle_time !== null) {
          parts.push(`Cycle: ${msg.cycle_time}`);
        }
        meta.textContent = parts.join(' | ') || '';
      }
      setMessageRunning(wrapper, !!msg.running);
      if (body) {
        msg.signals.forEach((sig) => {
          body.appendChild(buildSignalRow(sig));
        });
      }
    } catch (err) {
      if (body) {
        const div = document.createElement('div');
        div.className = 'stim-meta';
        div.textContent = err.message || 'Error';
        body.appendChild(div);
      }
      if (status) status.textContent = 'error';
    }
    updateNodeStatusFromMessages(wrapper.closest('.stim-node'));
  };

  const collectSignalValues = (wrapper) => gatherSignalValues(wrapper);

  const handleStimUpdate = async (wrapper, messageName) => {
    const status = wrapper.querySelector('.stim-status');
    const signalsContainer = wrapper.querySelector('.stim-signals');
    if (status) status.textContent = 'updating';
    const signals = collectSignalValues(wrapper);
    const payload = { message_name: messageName, signals };
    try {
      const res = await fetch('/api/stim/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) throw new Error(js.error || 'update failed');
      if (status) {
        status.textContent = js.started ? 'started' : 'updated';
      }
      if (signalsContainer) {
        applySignalUpdates(signalsContainer, js.applied || {});
      }
      if (typeof js.running === 'boolean') {
        setMessageRunning(wrapper, js.running);
      }
      updateNodeStatusFromMessages(wrapper.closest('.stim-node'));
    } catch (err) {
      if (status) status.textContent = `error: ${err.message}`;
    }
  };

  const createMessageBlock = (messageName) => {
    const detail = document.createElement('details');
    detail.className = 'stim-message';
    detail.dataset.message = messageName;
    detail.dataset.running = '0';

    const summary = document.createElement('summary');

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = messageName;

    const meta = document.createElement('span');
    meta.className = 'stim-summary-meta';

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.textContent = 'Update';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'stim-message-toggle';
    toggleBtn.textContent = 'Activate';

    const status = document.createElement('span');
    status.className = 'stim-status';
    status.textContent = 'inactive';

    updateBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      handleStimUpdate(detail, messageName);
    });

    toggleBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      toggleMessageActivation(detail, messageName);
    });

    summary.appendChild(title);
    summary.appendChild(meta);
    summary.appendChild(updateBtn);
    summary.appendChild(toggleBtn);
    summary.appendChild(status);

    const body = document.createElement('div');
    body.className = 'stim-signals';

    detail.appendChild(summary);
    detail.appendChild(body);

    detail.addEventListener('toggle', () => {
      if (detail.open) {
        loadMessageSignals(detail, messageName);
      }
    });

    return detail;
  };

  const createNodeCard = (nodeName, messageNames) => {
    const detail = document.createElement('details');
    detail.className = 'stim-node';
    detail.dataset.node = nodeName;
    detail.dataset.running = '0';

    const summary = document.createElement('summary');

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = nodeName;

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'stim-node-toggle';
    toggleBtn.textContent = 'Activate';

    const status = document.createElement('span');
    status.className = 'stim-node-status';
    status.textContent = 'inactive';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      stimNodesAdded.delete(nodeName);
      detail.remove();
    });

    summary.appendChild(title);
    summary.appendChild(toggleBtn);
    summary.appendChild(status);
    summary.appendChild(removeBtn);

    const messageWrap = document.createElement('div');
    messageWrap.className = 'stim-messages';
    messageNames.forEach((msgName) => {
      messageWrap.appendChild(createMessageBlock(msgName));
    });

    detail.appendChild(summary);
    detail.appendChild(messageWrap);

    toggleBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      toggleNodeActivation(detail, nodeName);
    });

    return detail;
  };

  const addNodeToView = (nodeName) => {
    if (!stimContainer) return;
    if (!nodeMap[nodeName]) {
      setStimStatus(`Node ${nodeName} not found`, true);
      return;
    }
    if (stimNodesAdded.has(nodeName)) {
      setStimStatus(`Node ${nodeName} already added`, true);
      return;
    }
    const card = createNodeCard(nodeName, nodeMap[nodeName]);
    stimContainer.appendChild(card);
    stimNodesAdded.add(nodeName);
    setStimStatus('');
  };

  const loadNodes = async () => {
    if (!nodeSelect) return;
    try {
      const res = await fetch('/api/dbc/nodes');
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) throw new Error(js.error || 'DBC not loaded');
      nodeMap = js.nodes || {};
      populateNodeSelect();
      setStimStatus(Object.keys(nodeMap).length ? '' : 'No nodes available');
    } catch (err) {
      nodeMap = {};
      populateNodeSelect();
      setStimStatus(err.message || 'Unable to load nodes', true);
    }
  };

  if (nodeSelect) {
    nodeSelect.addEventListener('change', () => setStimStatus(''));
  }

  const addNodeButton = $('#btn-stim-add');
  addNodeButton?.addEventListener('click', () => {
    if (!nodeSelect) return;
    const nodeName = nodeSelect.value;
    if (!nodeName) {
      setStimStatus('Select a node first', true);
      return;
    }
    addNodeToView(nodeName);
  });

  if (typeof onTabChange === 'function') {
    onTabChange('stim', () => {
      if (!Object.keys(nodeMap).length) {
        loadNodes();
      }
    });
  }

  populateNodeSelect();

  return {
    clearNodes: clearStimNodes,
    resetNodes: () => {
      clearStimNodes();
      nodeMap = {};
      populateNodeSelect();
      setStimStatus('');
    },
    loadNodes,
  };
}
