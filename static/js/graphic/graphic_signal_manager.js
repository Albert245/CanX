const COLOR_PALETTE = [
  '#4f8cff',
  '#ff6b6b',
  '#ffd93b',
  '#6c5ce7',
  '#2ecc71',
  '#00cec9',
  '#ff9f1a',
  '#e84393',
  '#a29bfe',
  '#00b894',
  '#f368e0',
  '#1dd1a1',
  '#ff9ff3',
  '#48dbfb',
  '#feca57',
  '#ee5253',
];

const RESULT_LIMIT = 120;

const $ = (selector, ctx = document) => ctx.querySelector(selector);

const createPlaceholder = (text) => {
  const li = document.createElement('li');
  li.className = 'graphic-result';
  li.textContent = text;
  li.tabIndex = -1;
  li.setAttribute('aria-hidden', 'true');
  return li;
};

export function initGraphicSignalManager(options) {
  const {
    refreshButton,
    searchInput,
    resultsList,
    selectedList,
    statusEl,
    onSignalAdded,
    onSignalRemoved,
    onSignalToggled,
  } = options;

  if (!resultsList || !selectedList) {
    console.warn('Graphic signal manager missing list elements; skipping initialization');
    const noop = () => {};
    return {
      loadSignalIndex: noop,
      removeSignal: noop,
      toggleSignal: noop,
      getSelectedSignals: () => [],
      setStatus: noop,
    };
  }

  let signalIndex = [];
  const messageInfoCache = new Map();
  const selectedSignals = new Map();
  const colorPool = [...COLOR_PALETTE];

  const setStatus = (message, tone = 'info') => {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.tone = tone;
  };

  const allocateColor = () => {
    if (colorPool.length) {
      return colorPool.shift();
    }
    return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
  };

  const releaseColor = (color) => {
    if (!color) return;
    if (colorPool.includes(color)) return;
    colorPool.push(color);
  };

  const renderResults = () => {
    const query = (searchInput?.value || '').trim().toLowerCase();
    resultsList.innerHTML = '';
    if (!signalIndex.length) {
      resultsList.appendChild(createPlaceholder('Load a DBC to search signals.'));
      return;
    }
    const matches = signalIndex.filter((entry) => {
      if (!query) return true;
      return [entry.signalName, entry.messageName, entry.idDisplay]
        .filter(Boolean)
        .some((part) => part.toLowerCase().includes(query));
    }).slice(0, RESULT_LIMIT);
    if (!matches.length) {
      resultsList.appendChild(createPlaceholder('No results.'));
      return;
    }
    matches.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'graphic-result';
      li.dataset.signalKey = entry.key;
      li.tabIndex = 0;
      if (selectedSignals.has(entry.key)) {
        li.classList.add('is-added');
      }
      const name = document.createElement('span');
      name.className = 'graphic-result-name';
      name.textContent = entry.signalName;
      const meta = document.createElement('span');
      meta.className = 'graphic-result-meta';
      const idLabel = entry.idDisplay ? ` · ${entry.idDisplay}` : '';
      meta.textContent = `${entry.messageName}${idLabel}`;
      li.appendChild(name);
      li.appendChild(meta);
      resultsList.appendChild(li);
    });
  };

  const fetchMessageSignals = async (messageName) => {
    if (messageInfoCache.has(messageName)) {
      return messageInfoCache.get(messageName);
    }
    const response = await fetch(`/api/dbc/message_info/${encodeURIComponent(messageName)}`);
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || response.statusText || 'Failed to load message info');
    }
    const signals = Array.isArray(json.message?.signals) ? json.message.signals : [];
    messageInfoCache.set(messageName, signals);
    return signals;
  };

  const createSelectedItem = (descriptor) => {
    const li = document.createElement('li');
    li.className = 'graphic-selected-item';
    li.dataset.signalId = descriptor.id;

    const toggle = document.createElement('label');
    toggle.className = 'graphic-selected-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.setAttribute('aria-label', `Toggle ${descriptor.displayName}`);
    const color = document.createElement('span');
    color.className = 'graphic-color-dot';
    color.style.setProperty('--dot-color', descriptor.color);
    const name = document.createElement('span');
    name.className = 'graphic-selected-name';
    name.textContent = descriptor.displayName;
    toggle.appendChild(checkbox);
    toggle.appendChild(color);
    toggle.appendChild(name);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'graphic-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove ${descriptor.displayName}`);

    li.appendChild(toggle);
    li.appendChild(removeBtn);

    descriptor.elements = { li, checkbox };
    return li;
  };

  const coerceInitialValue = (value) => {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const addSignal = async (entry) => {
    if (!entry) return;
    if (selectedSignals.has(entry.key)) {
      setStatus('Signal already added.', 'warning');
      return;
    }
    try {
      const signals = await fetchMessageSignals(entry.messageName);
      const signalMeta = signals.find((sig) => sig?.name === entry.signalName);
      if (!signalMeta) {
        throw new Error('Signal metadata not available');
      }
      const aliasSet = new Set([entry.messageName]);
      [entry.idDisplay, entry.idHex, entry.idDec]
        .filter((token) => token != null && token !== '')
        .forEach((token) => aliasSet.add(String(token)));
      const numericCandidates = [];
      const decimalValue = Number(entry.idDec);
      if (Number.isFinite(decimalValue)) {
        numericCandidates.push(decimalValue);
      }
      const hexSource = entry.idHex || (typeof entry.idDisplay === 'string' && entry.idDisplay.startsWith('0x') ? entry.idDisplay : null);
      if (hexSource) {
        const parsed = Number.parseInt(hexSource, 16);
        if (Number.isFinite(parsed)) {
          numericCandidates.push(parsed);
        }
      }
      numericCandidates.forEach((val) => {
        aliasSet.add(String(val));
        aliasSet.add(`0x${val.toString(16)}`);
      });
      const frameAliases = Array.from(aliasSet).filter(Boolean);

      const descriptor = {
        id: entry.key,
        messageName: entry.messageName,
        signalName: entry.signalName,
        displayName: `${entry.signalName} (${entry.messageName})`,
        unit: signalMeta.unit || '',
        color: allocateColor(),
        minValue: signalMeta.minimum,
        maxValue: signalMeta.maximum,
        idDisplay: entry.idDisplay,
        frameAliases,
        initialValue: coerceInitialValue(signalMeta.physical),
      };
      const element = createSelectedItem(descriptor);
      selectedList.appendChild(element);
      selectedSignals.set(descriptor.id, descriptor);
      if (typeof onSignalAdded === 'function') {
        onSignalAdded(descriptor);
      }
      setStatus(`Added ${descriptor.displayName}.`, 'success');
      renderResults();
    } catch (err) {
      setStatus(err?.message || 'Failed to add signal', 'error');
    }
  };

  const removeSignal = (signalId) => {
    const descriptor = selectedSignals.get(signalId);
    if (!descriptor) return;
    descriptor.elements?.li?.remove();
    selectedSignals.delete(signalId);
    releaseColor(descriptor.color);
    if (typeof onSignalRemoved === 'function') {
      onSignalRemoved(signalId);
    }
    renderResults();
  };

  const toggleSignal = (signalId, enabled) => {
    const descriptor = selectedSignals.get(signalId);
    if (!descriptor) return;
    descriptor.enabled = enabled;
    if (typeof onSignalToggled === 'function') {
      onSignalToggled(signalId, enabled);
    }
  };

  const handleResultActivate = (event) => {
    const item = event.target.closest('.graphic-result');
    if (!item) return;
    const key = item.dataset.signalKey;
    const entry = signalIndex.find((sig) => sig.key === key);
    if (!entry) return;
    addSignal(entry);
  };

  const loadSignalIndex = async () => {
    if (refreshButton) refreshButton.disabled = true;
    setStatus('Loading DBC signals…', 'info');
    try {
      const response = await fetch('/api/dbc/messages');
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || response.statusText || 'Failed to load DBC');
      }
      const messages = Array.isArray(json.messages) ? json.messages : [];
      signalIndex = [];
      messages.forEach((msg) => {
        const messageName = msg?.name;
        const idHex = msg?.id_hex || null;
        const idDecValue = msg?.id;
        const idDec =
          typeof idDecValue === 'string'
            ? idDecValue
            : Number.isFinite(idDecValue)
              ? String(idDecValue)
              : null;
        const idDisplay = idHex || idDec || '';
        if (!messageName) return;
        (Array.isArray(msg?.signals) ? msg.signals : []).forEach((signalName) => {
          const key = `${messageName}::${signalName}`;
          signalIndex.push({
            key,
            messageName,
            signalName,
            idDisplay,
            idHex,
            idDec,
          });
        });
      });
      if (!signalIndex.length) {
        setStatus('DBC loaded but no signals available.', 'warning');
      } else {
        setStatus(`Loaded ${signalIndex.length} signals.`, 'success');
      }
    } catch (err) {
      signalIndex = [];
      setStatus(err?.message || 'Failed to load DBC', 'error');
    } finally {
      renderResults();
      if (refreshButton) refreshButton.disabled = false;
    }
  };

  resultsList.addEventListener('click', handleResultActivate);
  resultsList.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleResultActivate(event);
    }
  });

  selectedList.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
      const li = event.target.closest('.graphic-selected-item');
      const signalId = li?.dataset.signalId;
      if (signalId) {
        toggleSignal(signalId, event.target.checked);
      }
    }
  });

  selectedList.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('.graphic-remove')) {
      const li = event.target.closest('.graphic-selected-item');
      const signalId = li?.dataset.signalId;
      if (signalId) {
        removeSignal(signalId);
      }
    }
  });

  searchInput?.addEventListener('input', () => {
    renderResults();
  });

  refreshButton?.addEventListener('click', () => {
    loadSignalIndex();
  });

  renderResults();

  return {
    loadSignalIndex,
    removeSignal,
    toggleSignal,
    getSelectedSignals: () => Array.from(selectedSignals.values()),
    setStatus,
  };
}
