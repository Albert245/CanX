import { PanelGrid } from './panel_grid.js';
import { PanelWidgetManager, PANEL_WIDGET_LIBRARY } from './panel_widgets.js';
import { PanelPropertiesPanel } from './panel_properties.js';
import { PanelScriptEngine } from './panel_script.js';
import { registerImageWidgetExtensions } from './panel_image_widgets.js';
import { notifyMessageStateChange } from './message-bus.js';

const PANEL_STORAGE_FILE = 'canx_panel.json';

const setByPath = (obj, path, value) => {
  if (!obj || !path) return;
  const parts = path.split('.');
  const last = parts.pop();
  let ref = obj;
  for (const part of parts) {
    if (typeof ref[part] !== 'object' || ref[part] === null) {
      ref[part] = {};
    }
    ref = ref[part];
  }
  ref[last] = value;
};

const waitForSocket = () =>
  new Promise((resolve) => {
    if (window.socket) {
      resolve(window.socket);
      return;
    }
    let attempts = 0;
    const timer = setInterval(() => {
      if (window.socket) {
        clearInterval(timer);
        resolve(window.socket);
        return;
      }
      attempts += 1;
      if (attempts > 50) {
        clearInterval(timer);
        resolve(null);
      }
    }, 200);
  });

const initPanel = () => {
  const panelTab = document.getElementById('tab-panel');
  const canvas = document.getElementById('panel-canvas');
  const toolboxEl = document.getElementById('panel-toolbox');
  const propertiesEl = document.getElementById('panel-properties');
  const objectRibbon = document.getElementById('panel-object-ribbon');
  const runBtn = document.getElementById('panel-run-mode');
  const exportBtn = document.getElementById('panel-export');
  const importBtn = document.getElementById('panel-import');
  const importFile = document.getElementById('panel-import-file');
  const clearBtn = document.getElementById('panel-clear');
  const toolboxDescription = document.getElementById('panel-toolbox-description');

  if (!panelTab || !canvas || !toolboxEl || !propertiesEl) {
    return;
  }

  const grid = new PanelGrid(canvas);
  const state = {
    selectedId: null,
    pendingTool: null,
    mode: 'edit',
    restoring: false,
  };

  const messageCache = new Map();

  const fetchMessageInfo = async (messageName) => {
    const key = messageName.trim();
    if (!key) return null;
    if (messageCache.has(key)) {
      return messageCache.get(key);
    }
    const response = await fetch(`/api/dbc/message_info/${encodeURIComponent(key)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.message) {
      throw new Error(data?.error || 'Unable to load message info');
    }
    messageCache.set(key, data.message);
    return data.message;
  };

  const sendSignal = async ({ message, signal, value, signals }) => {
    if (!message) return null;
    const payload = { message_name: message, signals: {} };
    if (signals && typeof signals === 'object') {
      payload.signals = signals;
    } else if (signal) {
      payload.signals[signal] = value;
    }
    const response = await fetch('/api/stim/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Signal send failed');
    }
    if (payload.message_name && data.running !== undefined) {
      notifyMessageStateChange(payload.message_name, !!data.running, { source: 'panel' });
    }
    return data;
  };

  const evaluateScriptRequest = async (payload) => {
    const response = await fetch('/api/panel/script-eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Script evaluation failed');
    }
    return data;
  };

  const sendMappingValue = async (widget, value) => {
    const mapping = widget.mapping || {};
    if (!mapping.message || !mapping.signal) return;
    await sendSignal({ message: mapping.message, signal: mapping.signal, value });
  };

  let scriptEngine = null;

  const widgetManager = new PanelWidgetManager({
    canvas,
    grid,
    onAction: (widget, eventType, payload) => {
      if (state.mode !== 'run') return;
      const usingScript = Boolean(widget.useScript);
      if (!usingScript) {
        if (payload && Object.prototype.hasOwnProperty.call(payload, 'value')) {
          const maybeValue = payload.value;
          if (maybeValue !== undefined && maybeValue !== null) {
            sendMappingValue(widget, maybeValue).catch((err) => console.warn(err));
          }
        }
        if (eventType === 'input' && payload?.value !== undefined) {
          sendMappingValue(widget, payload.value).catch((err) => console.warn(err));
        }
      }
      if (usingScript) {
        scriptEngine?.trigger(widget, eventType, payload);
      }
    },
    onRemove: (id) => {
      if (state.selectedId === id) {
        selectWidget(null);
      }
      if (!state.restoring) {
        scheduleSave();
      }
    },
  });

  scriptEngine = new PanelScriptEngine({
    evaluateScript: evaluateScriptRequest,
    sendSignal,
    applyWidgetAction: (action) => widgetManager.applyScriptAction(action),
  });

  const propertiesPanel = new PanelPropertiesPanel(propertiesEl, {
    onChange: (id, path, value) => {
      const widget = widgetManager.updateWidget(id, (data) => setByPath(data, path, value));
      if (!widget) return;
      if (!state.restoring) {
        scheduleSave();
      }
    },
    onRemoveWidget: (id) => {
      widgetManager.removeWidget(id);
      selectWidget(null);
    },
    fetchMessageInfo,
  });

  registerImageWidgetExtensions({ propertiesPanel });

  const buildToolbox = () => {
    toolboxEl.innerHTML = '';
    const select = document.createElement('select');
    select.className = 'panel-toolbox-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a widget';
    select.appendChild(placeholder);

    PANEL_WIDGET_LIBRARY.filter((item) => item.type !== 'script').forEach((item) => {
      const option = document.createElement('option');
      option.value = item.type;
      option.textContent = item.label;
      select.appendChild(option);
    });

    select.addEventListener('change', (event) => {
      if (state.mode === 'run') {
        select.value = '';
        return;
      }
      state.pendingTool = event.target.value || null;
      updateToolboxSelection();
    });

    toolboxEl.appendChild(select);
  };

  buildToolbox();

  const updateToolboxSelection = () => {
    const selectEl = toolboxEl.querySelector('select');
    if (selectEl) {
      selectEl.value = state.mode === 'run' ? '' : state.pendingTool || '';
      selectEl.disabled = state.mode === 'run';
    }
    updateToolDescription();
  };

  const updateToolDescription = () => {
    if (!toolboxDescription) return;
    if (!state.pendingTool) {
      toolboxDescription.hidden = true;
      toolboxDescription.textContent = '';
      return;
    }
    const def = PANEL_WIDGET_LIBRARY.find((entry) => entry.type === state.pendingTool);
    const descriptionText = def?.description || 'Select a position on the grid to place this widget.';
    toolboxDescription.hidden = false;
    toolboxDescription.innerHTML = '';
    const intro = document.createElement('div');
    intro.textContent = 'Select a grid cell to place this widget.';
    const detail = document.createElement('div');
    detail.textContent = descriptionText;
    toolboxDescription.append(intro, detail);
  };

  const selectWidget = (id) => {
    state.selectedId = id;
    widgetManager.elements.forEach((el, widgetId) => {
      el.classList.toggle('is-selected', widgetId === id);
    });
    const widget = id ? widgetManager.getWidget(id) : null;
    propertiesPanel.setWidget(widget || null);
    if (objectRibbon) {
      objectRibbon.hidden = !widget || state.mode === 'run';
    }
  };

  const handleCanvasClick = (event) => {
    if (state.mode === 'run') return;
    const widgetEl = event.target.closest('.panel-widget');
    if (widgetEl) {
      selectWidget(widgetEl.dataset.widgetId);
      return;
    }
    if (!state.pendingTool) {
      selectWidget(null);
      return;
    }
    const coords = grid.getCellFromEvent(event);
    if (!coords) return;
    const widget = widgetManager.addWidget({ type: state.pendingTool, pos: coords });
    selectWidget(widget?.id || null);
    if (!state.restoring) {
      scheduleSave();
    }
  };

  canvas.addEventListener('click', handleCanvasClick);

  const setMode = (mode) => {
    state.mode = mode;
    panelTab.classList.toggle('is-run-mode', mode === 'run');
    widgetManager.setMode(mode);
    if (mode === 'run') {
      state.pendingTool = null;
      updateToolboxSelection();
      grid.toggleGrid(false);
    } else {
      grid.toggleGrid(true);
    }
    syncModeButtons();
  };

  const syncModeButtons = () => {
    if (runBtn) {
      const label = runBtn.parentElement?.querySelector('.panel-ribbon-label');
      const icon = runBtn.querySelector('.panel-ribbon-icon');
      if (label) {
        label.textContent = state.mode === 'run' ? 'Running' : 'Editing';
      }
      if (icon) {
        icon.classList.toggle('panel-icon-running', state.mode === 'run');
        icon.classList.toggle('panel-icon-editing', state.mode !== 'run');
      }
    }
    if (objectRibbon) {
      objectRibbon.hidden = state.mode === 'run' || !state.selectedId;
    }
  };

  runBtn?.addEventListener('click', () => setMode(state.mode === 'run' ? 'edit' : 'run'));

  clearBtn?.addEventListener('click', () => {
    if (state.mode === 'run') return;
    if (!widgetManager.widgets.size) return;
    widgetManager.clear();
    selectWidget(null);
    if (!state.restoring) {
      scheduleSave();
    }
  });

  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const layout = JSON.parse(text);
      if (!validateLayout(layout)) {
        throw new Error('Invalid panel layout');
      }
      applyLayout(layout);
      await saveLayout();
    } catch (err) {
      console.error('Panel import failed', err);
    } finally {
      importFile.value = '';
    }
  });

  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(buildLayout(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = PANEL_STORAGE_FILE;
    link.click();
    URL.revokeObjectURL(url);
  });

  const buildLayout = () => ({
    version: 1,
    grid: grid.serialize(),
    widgets: widgetManager.serialize(),
  });

  const validateLayout = (layout) => layout && typeof layout === 'object' && Array.isArray(layout.widgets);

  const applyLayout = (layout) => {
    state.restoring = true;
    if (layout.grid) {
      grid.setConfig(layout.grid);
    }
    widgetManager.loadWidgets(layout.widgets || []);
    selectWidget(null);
    state.restoring = false;
  };

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveLayout().catch((err) => console.warn(err));
    }, 500);
  };

  const saveLayout = async () => {
    const payload = buildLayout();
    const response = await fetch('/api/panel/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error('Failed to save panel layout');
    }
  };

  const loadLayout = async () => {
    try {
      const response = await fetch('/api/panel/load');
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.layout) {
        applyLayout(data.layout);
      }
    } catch (err) {
      console.warn('Panel layout load failed', err);
    }
  };

  const handleTrace = (msg) => {
    if (state.mode !== 'run') return;
    if (!msg?.frame_name || !Array.isArray(msg.signals)) return;
    msg.signals.forEach((signal) => {
      const responses = widgetManager.applySignalUpdate(msg.frame_name, signal.name, {
        physical: signal.physical_value,
        raw: signal.raw_value,
        named: signal.named_value,
      });
      responses.forEach(({ widget }) => {
        if (!widget) return;
        if (widget.useScript) {
          scriptEngine.trigger(widget, 'rx', {
            value: signal.physical_value ?? signal.raw_value,
            raw: signal.raw_value,
            named: signal.named_value,
          });
        }
      });
    });
  };

  const setupSocketBridge = async () => {
    const socket = await waitForSocket();
    if (!socket || typeof socket.on !== 'function') return;
    socket.on('trace', handleTrace);
  };

  loadLayout();
  setMode('edit');
  setupSocketBridge();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPanel);
} else {
  initPanel();
}
