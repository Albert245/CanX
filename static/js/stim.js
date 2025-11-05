/**
 * @fileoverview Controls the Stimulation tab: node discovery, message display,
 * and signal editing helpers.
 */

const $ = (selector, ctx = document) => ctx.querySelector(selector);

const parseNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const str = String(value).trim();
  if (!str) return null;
  if (/^0x/i.test(str)) {
    const parsed = parseInt(str, 16);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (/^0b/i.test(str)) {
    const parsed = parseInt(str.slice(2), 2);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (/^0o/i.test(str)) {
    const parsed = parseInt(str.slice(2), 8);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const num = Number(str);
  return Number.isNaN(num) ? null : num;
};

const trimZeros = (str) => {
  if (!str.includes('.')) return str;
  return str.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
};

const formatPhysical = (value, allowFloat) => {
  if (!Number.isFinite(value)) return '';
  if (!allowFloat && Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(allowFloat ? 6 : 3);
  return trimZeros(fixed);
};

const formatRaw = (value, allowFloat) => {
  if (!Number.isFinite(value)) return '';
  if (!allowFloat) return String(Math.round(value));
  const fixed = value.toFixed(6);
  return trimZeros(fixed);
};

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

  const syncFromRaw = (row, rawInput, physInput) => {
    const value = rawInput.value.trim();
    if (!value) return;
    const raw = parseNumber(value);
    if (raw === null) return;
    const scale = parseNumber(row.dataset.scale) ?? 1;
    const offset = parseNumber(row.dataset.offset) ?? 0;
    const allowFloat = row.dataset.isFloat === '1';
    const physical = scale === 0 ? raw : raw * scale + offset;
    if (Number.isFinite(physical)) {
      physInput.value = formatPhysical(physical, true);
    }
    if (!allowFloat) {
      rawInput.value = formatRaw(raw, false);
    }
  };

  const syncFromPhysical = (row, physInput, rawInput) => {
    const value = physInput.value.trim();
    if (!value) return;
    const physical = parseNumber(value);
    if (physical === null) return;
    const scale = parseNumber(row.dataset.scale) ?? 1;
    const offset = parseNumber(row.dataset.offset) ?? 0;
    const allowFloat = row.dataset.isFloat === '1';
    const raw = scale === 0 ? physical : (physical - offset) / scale;
    if (Number.isFinite(raw)) {
      rawInput.value = formatRaw(raw, allowFloat);
    }
    if (Number.isFinite(physical)) {
      physInput.value = formatPhysical(physical, true);
    }
  };

  const buildSignalRow = (signal) => {
    const row = document.createElement('div');
    row.className = 'stim-signal';
    row.dataset.signal = signal.name;
    row.dataset.scale = signal.scale ?? 1;
    row.dataset.offset = signal.offset ?? 0;
    row.dataset.isFloat = signal.is_float ? '1' : '0';

    const name = document.createElement('div');
    name.className = 'sig-name';
    name.textContent = signal.unit ? `${signal.name} (${signal.unit})` : signal.name;

    const inputs = document.createElement('div');
    inputs.className = 'sig-inputs';

    const rawLabel = document.createElement('label');
    rawLabel.textContent = 'Raw';
    const rawInput = document.createElement('input');
    rawInput.type = 'text';
    rawInput.className = 'sig-raw';
    rawInput.value = signal.raw ?? '';
    rawLabel.appendChild(rawInput);

    const physLabel = document.createElement('label');
    physLabel.textContent = 'Physical';
    const physInput = document.createElement('input');
    physInput.type = 'text';
    physInput.className = 'sig-physical';
    physInput.value = signal.physical ?? '';
    physLabel.appendChild(physInput);

    inputs.appendChild(rawLabel);
    inputs.appendChild(physLabel);

    rawInput.addEventListener('input', () => syncFromRaw(row, rawInput, physInput));
    physInput.addEventListener('input', () => syncFromPhysical(row, physInput, rawInput));

    row.appendChild(name);
    row.appendChild(inputs);

    if (signal.choices && Object.keys(signal.choices).length) {
      const choices = document.createElement('div');
      choices.className = 'stim-meta';
      const mapped = Object.entries(signal.choices).map(([k, v]) => `${k}:${v}`);
      choices.textContent = `Choices: ${mapped.join(', ')}`;
      row.appendChild(choices);
    }

    return row;
  };

  const loadMessageSignals = async (wrapper, messageName) => {
    const body = wrapper.querySelector('.stim-signals');
    const status = wrapper.querySelector('.stim-status');
    const meta = wrapper.querySelector('.stim-summary-meta');
    if (body) body.innerHTML = '';
    if (status) status.textContent = 'loading';
    try {
      const res = await fetch(`/api/dbc/message_info/${encodeURIComponent(messageName)}`);
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) throw new Error(js.error || 'Failed to load message');
      const msg = js.message;
      if (meta) {
        const parts = [`ID: ${msg.id_hex}`];
        if (msg.cycle_time !== undefined && msg.cycle_time !== null) {
          parts.push(`Cycle: ${msg.cycle_time}`);
        }
        meta.textContent = parts.join(' | ');
      }
      if (status) status.textContent = msg.running ? 'running' : 'stopped';
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
  };

  const collectSignalValues = (wrapper) => {
    const signals = {};
    wrapper.querySelectorAll('.stim-signal').forEach((row) => {
      const name = row.dataset.signal;
      const rawInput = row.querySelector('.sig-raw');
      const physInput = row.querySelector('.sig-physical');
      if (!name || !rawInput || !physInput) return;
      const rawVal = rawInput.value.trim();
      const physVal = physInput.value.trim();
      if (!rawVal && !physVal) return;
      signals[name] = {
        raw: rawVal || null,
        physical: physVal || null,
      };
    });
    return signals;
  };

  const handleStimUpdate = async (wrapper, messageName) => {
    const status = wrapper.querySelector('.stim-status');
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
      await loadMessageSignals(wrapper, messageName);
    } catch (err) {
      if (status) status.textContent = `error: ${err.message}`;
    }
  };

  const createMessageBlock = (messageName) => {
    const detail = document.createElement('details');
    detail.className = 'stim-message';
    detail.dataset.message = messageName;

    const summary = document.createElement('summary');

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = messageName;

    const meta = document.createElement('span');
    meta.className = 'stim-summary-meta';

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.textContent = 'Update';

    const status = document.createElement('span');
    status.className = 'stim-status';

    updateBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      handleStimUpdate(detail, messageName);
    });

    summary.appendChild(title);
    summary.appendChild(meta);
    summary.appendChild(updateBtn);
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

    const summary = document.createElement('summary');

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = nodeName;

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
    summary.appendChild(removeBtn);

    const messageWrap = document.createElement('div');
    messageWrap.className = 'stim-messages';
    messageNames.forEach((msgName) => {
      messageWrap.appendChild(createMessageBlock(msgName));
    });

    detail.appendChild(summary);
    detail.appendChild(messageWrap);

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
