import { formatTimePerDivision, formatZoomFactor, formatDeltaTime } from './graphic_core.js';

const TIME_ZOOM_STEP = 1.2;
const CURSOR_GRAB_THRESHOLD = 12;
const PLOT_OFFSETS = { left: 60, right: 20, top: 16, bottom: 24 };

export function initGraphicUi(core, renderer, elements) {
  const {
    pauseButton,
    pauseBadge,
    timeScaleEl,
    valueScaleEl,
    zoomInBtn,
    zoomOutBtn,
    zoomResetBtn,
    autoScaleBtn,
    cursorButton,
    cursorDeltaEl,
    modeInputs,
    combinedContainer,
    separateContainer,
    stageEl,
  } = elements;

  const cursorState = {
    enabled: false,
    combined: { positions: [null, null] },
    perSignal: new Map(),
  };

  const getCursorPair = (signalId = null) => {
    if (!signalId) {
      return cursorState.combined;
    }
    if (!cursorState.perSignal.has(signalId)) {
      cursorState.perSignal.set(signalId, { positions: [null, null] });
    }
    return cursorState.perSignal.get(signalId);
  };

  const ensureCursorDefaults = (pair) => {
    if (!pair || !Array.isArray(pair.positions)) return;
    const windowState = core.getWindow();
    const { start, duration } = windowState;
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(pair.positions[0])) {
      pair.positions[0] = start + duration * 0.3;
    }
    if (!Number.isFinite(pair.positions[1])) {
      pair.positions[1] = start + duration * 0.7;
    }
  };

  const pruneCursorSignals = () => {
    const activeIds = new Set(core.getSignals().map((signal) => signal.id));
    Array.from(cursorState.perSignal.keys()).forEach((id) => {
      if (!activeIds.has(id)) {
        cursorState.perSignal.delete(id);
      }
    });
    if (cursorState.enabled) {
      ensureCursorDefaults(cursorState.combined);
      core.getSignals().forEach((signal) => {
        ensureCursorDefaults(getCursorPair(signal.id));
      });
    }
  };

  const getCursorDeltaSeconds = (pair) => {
    if (!pair || !Array.isArray(pair.positions)) return null;
    const [a, b] = pair.positions;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.abs(b - a);
  };

  const updateCursorUi = () => {
    const paused = core.isPaused();
    if (!paused && cursorState.enabled) {
      cursorState.enabled = false;
    }
    pruneCursorSignals();
    const effectiveEnabled = paused && cursorState.enabled;
    if (cursorButton) {
      cursorButton.disabled = !paused;
      cursorButton.classList.toggle('is-active', effectiveEnabled);
      cursorButton.setAttribute('aria-pressed', effectiveEnabled ? 'true' : 'false');
    }
    const deltaSeconds = effectiveEnabled ? getCursorDeltaSeconds(cursorState.combined) : null;
    if (cursorDeltaEl) {
      cursorDeltaEl.textContent = `Δt ${formatDeltaTime(deltaSeconds)}`;
    }
    renderer.setCursorState?.({
      enabled: effectiveEnabled,
      combined: cursorState.combined,
      perSignal: cursorState.perSignal,
    });
  };

  const updateReadouts = () => {
    if (timeScaleEl) {
      timeScaleEl.textContent = formatTimePerDivision(core.getTimePerDivision());
    }
    if (valueScaleEl) {
      valueScaleEl.textContent = formatZoomFactor(core.getCombinedVerticalZoom());
    }
    if (pauseButton) {
      pauseButton.textContent = core.isPaused() ? 'Resume' : 'Pause';
      pauseButton.classList.toggle('is-active', core.isPaused());
    }
    if (pauseBadge) {
      const paused = core.isPaused();
      pauseBadge.classList.toggle('is-visible', paused);
      pauseBadge.setAttribute('aria-hidden', paused ? 'false' : 'true');
    }
    updateCursorUi();
  };

  pauseButton?.addEventListener('click', () => {
    if (core.isPaused()) {
      core.resume();
    } else {
      core.pause();
    }
    updateReadouts();
  });

  zoomInBtn?.addEventListener('click', () => {
    core.adjustTimePerDivision(1 / TIME_ZOOM_STEP);
    updateReadouts();
  });

  zoomOutBtn?.addEventListener('click', () => {
    core.adjustTimePerDivision(TIME_ZOOM_STEP);
    updateReadouts();
  });

  zoomResetBtn?.addEventListener('click', () => {
    if (typeof core.resetValueAxisScaling === 'function') {
      core.resetValueAxisScaling();
    } else {
      core.resetCombinedVerticalZoom();
      core.getSignals().forEach((signal) => {
        core.resetSignalVerticalZoom(signal.id);
      });
    }
    if (typeof core.getDefaultTimePerDivision === 'function' && typeof core.setTimePerDivision === 'function') {
      core.setTimePerDivision(core.getDefaultTimePerDivision());
    }
    updateReadouts();
  });

  autoScaleBtn?.addEventListener('click', () => {
    if (typeof core.autoScaleAxes === 'function') {
      core.autoScaleAxes();
    }
    updateReadouts();
  });

  cursorButton?.addEventListener('click', () => {
    if (!core.isPaused()) return;
    cursorState.enabled = !cursorState.enabled;
    if (cursorState.enabled) {
      ensureCursorDefaults(cursorState.combined);
      core.getSignals().forEach((signal) => {
        ensureCursorDefaults(getCursorPair(signal.id));
      });
    }
    updateCursorUi();
  });

  modeInputs?.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        renderer.setMode(input.value);
        updateReadouts();
      }
    });
  });

  const handleWheel = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !stageEl?.contains(target)) return;
    event.preventDefault();
    const { deltaX, deltaY } = event;
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      const factor = deltaY > 0 ? TIME_ZOOM_STEP : 1 / TIME_ZOOM_STEP;
      const panel = target.closest('.graphic-panel');
      if (panel?.dataset.signalId) {
        core.adjustSignalVerticalZoom(panel.dataset.signalId, factor);
      } else {
        core.adjustCombinedVerticalZoom(factor);
      }
      updateReadouts();
      return;
    }
    const timeFactor = deltaX > 0 ? TIME_ZOOM_STEP : 1 / TIME_ZOOM_STEP;
    core.adjustTimePerDivision(timeFactor);
    updateReadouts();
  };

  stageEl?.addEventListener('wheel', handleWheel, { passive: false });

  const getPlotRectForElement = (element) => {
    if (!element) return null;
    const width = element.clientWidth || element.getBoundingClientRect?.().width || 0;
    const height = element.clientHeight || element.getBoundingClientRect?.().height || 0;
    return {
      x: PLOT_OFFSETS.left,
      y: PLOT_OFFSETS.top,
      width: Math.max(0, width - (PLOT_OFFSETS.left + PLOT_OFFSETS.right)),
      height: Math.max(0, height - (PLOT_OFFSETS.top + PLOT_OFFSETS.bottom)),
    };
  };

  const resolveCursorPointer = (event, targetEl) => {
    if (!targetEl) return null;
    const bounds = targetEl.getBoundingClientRect?.();
    if (!bounds) return null;
    const rect = getPlotRectForElement(targetEl);
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    if (localY < rect.y || localY > rect.y + rect.height) return null;
    const ratio = (localX - rect.x) / rect.width;
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const windowState = core.getWindow();
    const { start, duration } = windowState;
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const time = start + duration * clampedRatio;
    return {
      rect,
      time,
      x: rect.x + clampedRatio * rect.width,
      windowState,
    };
  };

  const pickCursorHandle = (signalId, pointerInfo) => {
    if (!pointerInfo) return null;
    const pair = getCursorPair(signalId);
    ensureCursorDefaults(pair);
    const positions = Array.isArray(pair.positions) ? pair.positions : [];
    let bestIndex = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    positions.forEach((timestamp, index) => {
      if (!Number.isFinite(timestamp)) return;
      const ratio = (timestamp - pointerInfo.windowState.start) / pointerInfo.windowState.duration;
      const clamped = Math.min(1, Math.max(0, ratio));
      const x = pointerInfo.rect.x + clamped * pointerInfo.rect.width;
      const distance = Math.abs(pointerInfo.x - x);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    if (bestIndex == null) return null;
    return { pair, index: bestIndex, distance: bestDistance };
  };

  let dragState = null;

  const beginDrag = (event) => {
    const container = event.currentTarget;
    const paused = core.isPaused();
    const target = event.target instanceof Element ? event.target : null;
    const panel = target?.closest('.graphic-panel');
    const signalId = panel?.dataset.signalId || null;
    const targetEl = signalId ? panel : container;
    const cursorSurface = signalId
      ? panel?.querySelector('.graphic-panel-canvas') || targetEl
      : targetEl;
    const rect = targetEl?.getBoundingClientRect?.();
    const width = rect?.width || targetEl?.clientWidth || 0;
    const height = rect?.height || targetEl?.clientHeight || 0;
    const allowValue = height > 0 && (container !== separateContainer || Boolean(signalId));
    const allowTime = paused && width > 0;
    const canUseCursors = cursorState.enabled && paused && cursorSurface;
    if (!allowTime && !allowValue && !canUseCursors) return;

    if (canUseCursors) {
      const pointerInfo = resolveCursorPointer(event, cursorSurface);
      const selection = pickCursorHandle(signalId, pointerInfo);
      if (selection && selection.distance <= CURSOR_GRAB_THRESHOLD) {
        dragState = {
          pointerId: event.pointerId,
          container,
          targetEl,
          pointerSurface: cursorSurface,
          signalId,
          type: 'cursor',
          cursorIndex: selection.index,
        };
        container.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        return;
      }
    }

    dragState = {
      pointerId: event.pointerId,
      container,
      targetEl,
      signalId,
      allowTime,
      allowValue,
      type: allowTime ? null : 'value',
      startX: event.clientX,
      startY: event.clientY,
      width,
      height,
      applied: 0,
      prevClientY: event.clientY,
    };
    container.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const pickDragType = (event, dx, dy) => {
    if (!dragState || dragState.type) return dragState?.type || null;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const threshold = 3;
    if (absDx < threshold && absDy < threshold) {
      return null;
    }
    if (dragState.allowTime && absDx >= absDy * 1.2 && core.isPaused()) {
      dragState.type = 'time';
      dragState.applied = 0;
      dragState.startX = event.clientX;
      return dragState.type;
    }
    if (dragState.allowValue) {
      dragState.type = 'value';
      dragState.prevClientY = event.clientY;
      return dragState.type;
    }
    dragState.type = dragState.allowTime ? 'time' : null;
    return dragState.type;
  };

  const moveDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (dragState.type === 'cursor') {
      const pointerInfo = resolveCursorPointer(event, dragState.pointerSurface || dragState.targetEl);
      if (!pointerInfo) return;
      const pair = getCursorPair(dragState.signalId);
      if (!pair || !Array.isArray(pair.positions)) return;
      pair.positions[dragState.cursorIndex] = pointerInfo.time;
      updateCursorUi();
      event.preventDefault();
      return;
    }
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    const currentType = dragState.type || pickDragType(event, dx, dy);
    if (currentType === 'time') {
      if (!core.isPaused()) {
        endDrag(event);
        return;
      }
      const localDx = event.clientX - dragState.startX;
      const secondsPerPixel = core.getWindow().duration / Math.max(1, dragState.width);
      const targetShift = -localDx * secondsPerPixel;
      const delta = targetShift - dragState.applied;
      dragState.applied = targetShift;
      core.shiftWindow(delta);
      return;
    }
    if (currentType === 'value') {
      const referenceEl = dragState.targetEl;
      const height = referenceEl?.getBoundingClientRect?.().height || referenceEl?.clientHeight || dragState.height;
      const deltaY = event.clientY - (dragState.prevClientY ?? event.clientY);
      dragState.prevClientY = event.clientY;
      if (!height || deltaY === 0) return;
      if (dragState.signalId) {
        core.panSignalValueAxis?.(dragState.signalId, deltaY, height);
      } else {
        core.panCombinedValueAxis?.(deltaY, height);
      }
    }
  };

  const endDrag = (event) => {
    if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
    dragState.container?.releasePointerCapture?.(dragState.pointerId);
    dragState = null;
  };

  [combinedContainer, separateContainer].forEach((container) => {
    if (!container) return;
    container.addEventListener('pointerdown', beginDrag);
    container.addEventListener('pointermove', moveDrag);
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
    container.addEventListener('pointerleave', (event) => {
      if (dragState && event.pointerId === dragState.pointerId) {
        endDrag(event);
      }
    });
  });

  separateContainer?.addEventListener('dblclick', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const panel = target?.closest('.graphic-panel');
    if (panel?.dataset.signalId) {
      core.resetSignalVerticalZoom(panel.dataset.signalId);
      updateReadouts();
    }
  });

  combinedContainer?.addEventListener('dblclick', () => {
    core.resetCombinedVerticalZoom();
    updateReadouts();
  });

  updateReadouts();
}
