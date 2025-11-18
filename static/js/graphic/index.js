import { createGraphicCore } from './graphic_core.js';
import { createGraphicRenderer } from './graphic_renderer.js';
import { initGraphicSignalManager } from './graphic_signal_manager.js';
import { initGraphicUi } from './graphic_ui.js';

const $ = (selector, ctx = document) => ctx.querySelector(selector);

const normalizeSignalDetail = (detail = {}) => {
  const name = typeof detail?.name === 'string' ? detail.name : '';
  const physical = detail?.physical_value ?? detail?.physical ?? detail?.value;
  return { name, physical_value: physical };
};

const normalizeTraceEntry = (msg = {}) => {
  const tsRaw = Number(msg?.ts);
  const ts = Number.isFinite(tsRaw) ? tsRaw : Date.now() / 1000;
  const safeString = (value) => (typeof value === 'string' && value ? value : undefined);
  const signals = Array.isArray(msg?.signals)
    ? msg.signals.map((detail) => normalizeSignalDetail(detail)).filter((detail) => detail.name)
    : [];
  return {
    ts,
    frame_name: safeString(msg?.frame_name),
    frameName: safeString(msg?.frameName),
    message_name: safeString(msg?.message_name),
    messageName: safeString(msg?.messageName),
    frame: safeString(msg?.frame),
    id: msg?.id,
    id_hex: msg?.id_hex ?? msg?.idHex,
    arbitration_id: msg?.arbitration_id ?? msg?.arbitrationId,
    can_id: msg?.can_id ?? msg?.canId,
    signals,
  };
};

export function initGraphic({ socket, onTabChange }) {
  const combinedCanvas = $('#graphic-combined-canvas');
  const combinedContainer = $('#graphic-combined');
  const separateContainer = $('#graphic-separate-container');
  const placeholderEl = $('#graphic-placeholder');
  const stageEl = $('#graphic-stage');

  if (!combinedCanvas || !combinedContainer || !separateContainer) {
    return;
  }

  const core = createGraphicCore();
  const renderer = createGraphicRenderer(core, {
    combinedCanvas,
    combinedContainer,
    separateContainer,
    placeholderEl,
    stageEl,
  });

  const signalManager = initGraphicSignalManager({
    refreshButton: $('#btn-graphic-refresh'),
    searchInput: $('#graphic-search'),
    resultsList: $('#graphic-results'),
    selectedList: $('#graphic-selected'),
    statusEl: $('#graphic-status'),
    onSignalAdded: (descriptor) => {
      core.registerSignal({
        id: descriptor.id,
        messageName: descriptor.messageName,
        signalName: descriptor.signalName,
        displayName: descriptor.displayName,
        unit: descriptor.unit,
        color: descriptor.color,
        minValue: descriptor.minValue,
        maxValue: descriptor.maxValue,
        frameAliases: descriptor.frameAliases,
      });
    },
    onSignalRemoved: (signalId) => {
      core.removeSignal(signalId);
    },
    onSignalToggled: (signalId, enabled) => {
      core.setSignalEnabled(signalId, enabled);
    },
  });

  initGraphicUi(core, renderer, {
    pauseButton: $('#graphic-pause'),
    pauseBadge: $('#graphic-pause-indicator'),
    timeScaleEl: $('#graphic-time-scale'),
    valueScaleEl: $('#graphic-value-scale'),
    zoomInBtn: $('#graphic-zoom-in'),
    zoomOutBtn: $('#graphic-zoom-out'),
    zoomResetBtn: $('#graphic-zoom-reset'),
    modeInputs: Array.from(document.querySelectorAll('input[name="graphic-mode"]')),
    combinedContainer,
    separateContainer,
    stageEl,
  });

  signalManager.loadSignalIndex();

  const handleTrace = (payload) => {
    const entry = normalizeTraceEntry(payload);
    core.ingestTraceEntry(entry);
  };

  socket?.on?.('trace', handleTrace);

  onTabChange?.('graphic', () => {
    window.requestAnimationFrame(() => {
      renderer.start();
    });
  });

  renderer.start();

  if (typeof window !== 'undefined') {
    window.CanXGraphicExample = {
      /**
       * Inject a sample into the live plot for testing.
       * Example: window.CanXGraphicExample.push('EngineStatus', 'RPM', 1500);
       */
      push(messageName, signalName, value) {
        const entry = {
          frame_name: messageName,
          ts: performance.now() / 1000,
          signals: [{ name: signalName, physical_value: value }],
        };
        core.ingestTraceEntry(entry);
      },
    };
  }
}
