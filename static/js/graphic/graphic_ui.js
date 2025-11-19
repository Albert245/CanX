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
      pauseBadge.hidden = !core.isPaused();
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
    if (!core.isPaused()) return;
    const container = event.currentTarget;
    const width = container?.clientWidth || container?.getBoundingClientRect()?.width;
    if (!width) return;
    dragState = {
      pointerId: event.pointerId,
      container,
      startX: event.clientX,
      width,
      applied: 0,
    };
    container.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (!core.isPaused()) {
      endDrag(event);
      return;
    }
    const dx = event.clientX - dragState.startX;
    const secondsPerPixel = core.getWindow().duration / Math.max(1, dragState.width);
    const targetShift = -dx * secondsPerPixel;
    const delta = targetShift - dragState.applied;
    dragState.applied = targetShift;
    core.shiftWindow(delta);
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
