import { formatTimePerDivision, formatZoomFactor } from './graphic_core.js';

const TIME_ZOOM_STEP = 1.2;

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
    modeInputs,
    combinedContainer,
    separateContainer,
    stageEl,
  } = elements;

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

  let dragState = null;

  const beginDrag = (event) => {
    const container = event.currentTarget;
    const paused = core.isPaused();
    const target = event.target instanceof Element ? event.target : null;
    const panel = target?.closest('.graphic-panel');
    const signalId = panel?.dataset.signalId || null;
    const targetEl = signalId ? panel : container;
    const rect = targetEl?.getBoundingClientRect?.();
    const width = rect?.width || targetEl?.clientWidth || 0;
    const height = rect?.height || targetEl?.clientHeight || 0;
    const allowValue = height > 0 && (container !== separateContainer || Boolean(signalId));
    const allowTime = paused && width > 0;
    if (!allowTime && !allowValue) return;

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
