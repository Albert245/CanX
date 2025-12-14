import { PANEL_WIDGET_LIBRARY, PanelWidgetManager, getWidgetDefinition } from './panel_widgets.js';

const IMAGE_COLORS = ['white', 'blue', 'red'];

let imageCatalog = null;

const normalizeImagePath = (folder, file) => {
  if (!folder || !file) return '';
  return `/static/assets/${folder}/${file}`;
};

export const fetchImageCatalog = async () => {
  if (imageCatalog) return imageCatalog;
  try {
    const response = await fetch('/api/panel/list-images');
    const data = await response.json().catch(() => ({}));
    imageCatalog = data || {};
  } catch (err) {
    console.warn('Unable to load image catalog', err);
    imageCatalog = IMAGE_COLORS.reduce((acc, color) => ({ ...acc, [color]: [] }), {});
  }
  return imageCatalog;
};

const ensureDefinition = (type, defaults) => {
  const entry = getWidgetDefinition(type);
  if (entry) {
    Object.assign(entry.defaults || {}, defaults.defaults || {});
    if (defaults.propertySections) {
      entry.propertySections = defaults.propertySections;
    }
    if (defaults.defaultSize) {
      entry.defaultSize = defaults.defaultSize;
    }
    return entry;
  }
  PANEL_WIDGET_LIBRARY.push({ type, ...defaults });
  return getWidgetDefinition(type);
};

const mutateDefinitionDefaults = () => {
  ensureDefinition('image_indicator', {
    defaults: {
      label: 'Image Indicator',
      mapping: { message: '', signal: '', onValue: 1 },
      images: {
        off: '/static/assets/white/icons8-temperature-50.png',
        on: '/static/assets/red/icons8-temperature-50.png',
      },
    },
  });

  ensureDefinition('image_button', {
    defaults: {
      label: 'Image Button',
      mapping: { message: '', signal: '', pressValue: 1, releaseValue: 0 },
      images: {
        normal: '/static/assets/white/icons8-switch-off-50.png',
        pressed: '/static/assets/red/icons8-switch-on-50.png',
      },
    },
  });

  ensureDefinition('image_toggle', {
    label: 'Image Toggle (3-state)',
    category: 'Images',
    icon: '🖼',
    description: 'Up to three-state toggle that cycles images and values on each click.',
    defaultSize: { w: 2, h: 2 },
    defaults: {
      label: 'Image Toggle',
      offImage: '/static/assets/white/icons8-toggle-off-50.png',
      onImage: '/static/assets/blue/icons8-toggle-on-50.png',
      midImage: '/static/assets/red/icons8-warning.png',
      mapping: { message: '', signal: '', offValue: 0, onValue: 1, midValue: 2 },
    },
    supportsScript: true,
    propertySections: [
      { title: 'Images', fields: [{ label: 'Images', path: 'images', type: 'imageToggle' }] },
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
          { label: 'OFF value', path: 'mapping.offValue', type: 'number', enum: true },
          { label: 'ON value', path: 'mapping.onValue', type: 'number', enum: true },
          { label: 'MID value', path: 'mapping.midValue', type: 'number', enum: true },
        ],
      },
    ],
  });

  ensureDefinition('static_image', {
    defaults: {
      label: 'Image',
      images: { src: '/static/assets/white/icons8-temperature-50.png' },
    },
  });

  ensureDefinition('image_switch', {
    label: 'Image Switch',
    category: 'Images',
    icon: '🖼',
    description: 'Multi-state switch that chooses an image based on an enumerated signal value.',
    defaultSize: { w: 3, h: 2 },
    defaults: {
      label: 'Image Switch',
      mapping: { message: '', signal: '' },
      images: { states: [] },
    },
    acceptsRx: true,
    supportsScript: true,
    propertySections: [
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
        ],
      },
    ],
  });
};

const normalizeImageSchema = (widget) => {
  if (!widget || typeof widget !== 'object') return widget;
  widget.images = widget.images || {};

  if (widget.type === 'image_button') {
    if (!widget.images.normal && widget.normalImage) {
      widget.images.normal = widget.normalImage;
    }
    if (!widget.images.pressed && widget.pressedImage) {
      widget.images.pressed = widget.pressedImage;
    }
  }

  if (widget.type === 'image_indicator') {
    const states = Array.isArray(widget.states) ? widget.states : [];
    if (!widget.images.off && states[0]?.image) {
      widget.images.off = states[0].image;
    }
    if (!widget.images.on && states[1]?.image) {
      widget.images.on = states[1].image;
    }
    if (!widget.images.off && widget.offImage) {
      widget.images.off = widget.offImage;
    }
    if (!widget.images.on && widget.onImage) {
      widget.images.on = widget.onImage;
    }
  }

  if (widget.type === 'static_image' && !widget.images.src && widget.image) {
    widget.images.src = widget.image;
  }

  if (widget.type === 'image_switch') {
    const legacyStates = Array.isArray(widget.states) ? widget.states : [];
    if (legacyStates.length && (!Array.isArray(widget.images.states) || !widget.images.states.length)) {
      widget.images.states = legacyStates.map((state) => ({ value: state.value, src: state.src || state.image || '' }));
    } else if (Array.isArray(widget.images.states)) {
      widget.images.states = widget.images.states.map((state) => ({ value: state.value, src: state.src || state.image || '' }));
    }
  }

  return widget;
};

const placeholderImage =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="%23141821"/><path d="M20 20h24v24H20z" fill="none" stroke="%238aa0c0" stroke-width="2"/><circle cx="28" cy="28" r="4" fill="%238aa0c0"/><path d="M24 40l6-8 6 8 4-6 6 10H18z" fill="%238aa0c0"/></svg>';

const createImageDropdown = ({ value = '', onSelect }) => {
  const root = document.createElement('div');
  root.className = 'img-dropdown';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'img-dropdown-toggle';

  const preview = document.createElement('img');
  preview.className = 'img-dropdown-preview';
  preview.alt = 'selected image';
  preview.src = value || placeholderImage;
  toggle.appendChild(preview);

  const menu = document.createElement('div');
  menu.className = 'img-dropdown-menu image-dropdown-container';
  menu.hidden = true;

  const scrollable = document.createElement('div');
  scrollable.className = 'image-dropdown-scrollable';
  menu.appendChild(scrollable);

  let currentValue = value || '';
  let isOpen = false;
  let menuBuilt = false;

  const closeMenu = () => {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    menu.hidden = true;
  };

  const handleOutsideClick = (event) => {
    if (!root.contains(event.target)) {
      closeMenu();
    }
  };

  const openMenu = () => {
    if (isOpen) {
      closeMenu();
      return;
    }
    isOpen = true;
    root.classList.add('open');
    menu.hidden = false;
    if (!menuBuilt) {
      menuBuilt = true;
      buildMenu();
    }
  };

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  });

  const applySelection = (nextValue) => {
    currentValue = nextValue || '';
    preview.src = currentValue || placeholderImage;
    if (typeof onSelect === 'function') {
      onSelect(currentValue);
    }
    closeMenu();
  };

  const buildMenu = async () => {
    scrollable.innerHTML = '';
    const catalog = await fetchImageCatalog();
    const folders = Object.entries(catalog || {});
    const buttons = [];

    const setSelected = (val) => {
      buttons.forEach((btn) => {
        if (btn.dataset.value === val) {
          btn.classList.add('selected');
        } else {
          btn.classList.remove('selected');
        }
      });
    };

    if (!folders.length) {
      const empty = document.createElement('div');
      empty.className = 'img-dropdown-empty';
      empty.textContent = 'No images';
      scrollable.appendChild(empty);
      return setSelected(currentValue);
    }

    folders.forEach(([folder, files]) => {
      const section = document.createElement('div');
      section.className = 'img-dropdown-section';

      const title = document.createElement('div');
      title.className = 'color-title';
      title.textContent = folder;
      section.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'icon-grid';

      if (!files || !files.length) {
        const noImg = document.createElement('div');
        noImg.className = 'img-dropdown-empty';
        noImg.textContent = 'No images';
        grid.appendChild(noImg);
      } else {
        files.forEach((file) => {
          const fullPath = normalizeImagePath(folder, file);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'icon-grid-button';
          button.dataset.value = fullPath;

          const img = document.createElement('img');
          img.src = fullPath;
          img.alt = `${folder}/${file}`;

          const wrapper = document.createElement('div');
          wrapper.className = 'panel-image-icon-only';
          wrapper.appendChild(img);
          button.appendChild(wrapper);

          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            applySelection(fullPath);
            setSelected(fullPath);
          });

          buttons.push(button);
          grid.appendChild(button);
        });
      }

      section.appendChild(grid);
      scrollable.appendChild(section);
    });

    setSelected(currentValue);
  };

  document.addEventListener('click', handleOutsideClick);

  const cleanup = () => {
    document.removeEventListener('click', handleOutsideClick);
    closeMenu();
  };

  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      cleanup();
      observer.disconnect();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  root.append(toggle, menu);

  root.destroy = () => {
    cleanup();
    observer.disconnect();
  };

  if (!currentValue) {
    preview.src = placeholderImage;
  }

  return root;
};

const attachImageStateEditor = (panel) => {
  panel.registerCustomRenderer('image_indicator', async ({ form, widget, registerCleanup }) => {
    normalizeImageSchema(widget);
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'panel-section-title';
    sectionTitle.textContent = 'Images';
    form.appendChild(sectionTitle);

    const rows = [
      { label: 'Off image', key: 'images.off' },
      { label: 'On image', key: 'images.on' },
    ];

    rows.forEach((row) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'panel-field panel-image-inline';
      wrapper.appendChild(document.createElement('label')).textContent = row.label;
      const currentValue = row.key === 'images.off' ? widget.images?.off : widget.images?.on;
      renderImagePicker(wrapper, currentValue, (src) => panel._emitChange(row.key, src), registerCleanup);
      form.appendChild(wrapper);
    });
  });
};

const attachImageSwitchEditor = (panel) => {
  panel.registerCustomRenderer('image_switch', async ({ form, widget, registerCleanup }) => {
    normalizeImageSchema(widget);
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'panel-section-title';
    sectionTitle.textContent = 'Image States';
    form.appendChild(sectionTitle);

    const list = document.createElement('div');
    list.className = 'panel-image-state-list';

    let rowCleanups = [];

    const renderRows = () => {
      rowCleanups.forEach((fn) => fn?.());
      rowCleanups = [];
      list.innerHTML = '';
      const states = Array.isArray(widget.images?.states) ? widget.images.states : [];
      states.forEach((state, index) => {
        const row = document.createElement('div');
        row.className = 'panel-image-state-row';

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.value = state.value ?? 0;

        let currentImage = state.src || '';

        const dropdown = createImageDropdown({
          value: currentImage,
          onSelect: (nextValue) => {
            currentImage = nextValue || '';
            const nextStates = Array.isArray(widget.images?.states) ? [...widget.images.states] : [];
            nextStates[index] = {
              value: Number(valueInput.value),
              src: currentImage,
            };
            panel._emitChange('images.states', nextStates);
          },
        });

        const update = () => {
          const nextStates = Array.isArray(widget.images?.states) ? [...widget.images.states] : [];
          nextStates[index] = {
            value: Number(valueInput.value),
            src: currentImage,
          };
          panel._emitChange('images.states', nextStates);
        };

        valueInput.addEventListener('change', update);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = '–';
        deleteBtn.addEventListener('click', () => {
          const nextStates = Array.isArray(widget.images?.states) ? [...widget.images.states] : [];
          nextStates.splice(index, 1);
          panel._emitChange('images.states', nextStates);
          renderRows();
        });

        row.append(valueInput, dropdown, deleteBtn);
        list.appendChild(row);

        if (typeof dropdown.destroy === 'function') {
          rowCleanups.push(() => dropdown.destroy());
        }
      });
    };

    registerCleanup?.(() => {
      rowCleanups.forEach((fn) => fn?.());
      rowCleanups = [];
    });

    renderRows();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add State +';
    addBtn.addEventListener('click', () => {
      const nextStates = Array.isArray(widget.images?.states) ? [...widget.images.states] : [];
      nextStates.push({ value: nextStates.length, src: '' });
      panel._emitChange('images.states', nextStates);
      renderRows();
    });

    form.appendChild(list);
    form.appendChild(addBtn);
  });
};

const attachButtonToggleEditors = (panel) => {
  const renderImagePicker = (wrapper, currentValue, onChange, registerCleanup) => {
    const dropdown = createImageDropdown({
      value: currentValue,
      onSelect: (src) => {
        onChange(src || '');
      },
    });
    wrapper.append(dropdown);
    if (registerCleanup && typeof dropdown.destroy === 'function') {
      registerCleanup(() => dropdown.destroy());
    }
    return dropdown;
  };

  panel.registerCustomRenderer('image_button', ({ form, widget, registerCleanup }) => {
    normalizeImageSchema(widget);
    const title = document.createElement('div');
    title.className = 'panel-section-title';
    title.textContent = 'Images';
    form.appendChild(title);
    const normalRow = document.createElement('div');
    normalRow.className = 'panel-field panel-image-inline';
    normalRow.appendChild(document.createElement('label')).textContent = 'Normal image';
    renderImagePicker(normalRow, widget.images?.normal || widget.normalImage, (src) => {
      panel._emitChange('images.normal', src);
    }, registerCleanup);
    form.appendChild(normalRow);

    const pressedRow = document.createElement('div');
    pressedRow.className = 'panel-field panel-image-inline';
    pressedRow.appendChild(document.createElement('label')).textContent = 'Pressed image';
    renderImagePicker(pressedRow, widget.images?.pressed || widget.pressedImage, (src) => {
      panel._emitChange('images.pressed', src);
    }, registerCleanup);
    form.appendChild(pressedRow);
  });

  panel.registerCustomRenderer('image_toggle', ({ form, widget, registerCleanup }) => {
    normalizeImageSchema(widget);
    const title = document.createElement('div');
    title.className = 'panel-section-title';
    title.textContent = 'Images';
    form.appendChild(title);
    const rows = [
      { label: 'Off image', key: 'offImage' },
      { label: 'On image', key: 'onImage' },
      { label: 'Mid image', key: 'midImage' },
    ];
    rows.forEach((row) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'panel-field panel-image-inline';
      wrapper.appendChild(document.createElement('label')).textContent = row.label;
      const currentValue =
        row.key === 'offImage'
          ? widget.offImage ?? widget.images?.off
          : row.key === 'onImage'
          ? widget.onImage ?? widget.images?.on
          : widget.midImage ?? widget.images?.mid;
      renderImagePicker(wrapper, currentValue, (src) => panel._emitChange(row.key, src), registerCleanup);
      form.appendChild(wrapper);
    });
  });

  panel.registerCustomRenderer('static_image', ({ form, widget, registerCleanup }) => {
    normalizeImageSchema(widget);
    const title = document.createElement('div');
    title.className = 'panel-section-title';
    title.textContent = 'Image';
    form.appendChild(title);
    const wrapper = document.createElement('div');
    wrapper.className = 'panel-field panel-image-inline';
    wrapper.appendChild(document.createElement('label')).textContent = 'Image';
    renderImagePicker(wrapper, widget.images?.src || widget.image, (src) => panel._emitChange('images.src', src), registerCleanup);
    form.appendChild(wrapper);
  });
};

const extendWidgetManager = () => {
  const originalRender = PanelWidgetManager.prototype._renderWidget;
  PanelWidgetManager.prototype._renderWidget = function patchedRender(widget, element) {
    normalizeImageSchema(widget);
    const el = element || this.elements.get(widget.id);
    if (!el) return;

    if (widget.type === 'image_button') {
      el.className = 'panel-widget panel-widget--image_button';
      el.innerHTML = '';
      const normal = document.createElement('img');
      const pressed = document.createElement('img');
      normal.src = widget.images?.normal || '';
      pressed.src = widget.images?.pressed || widget.images?.normal || '';
      const isPressed = widget.runtime?.isPressed;
      normal.style.display = isPressed ? 'none' : 'block';
      pressed.style.display = isPressed ? 'block' : 'none';
      el.append(normal, pressed);
      return;
    }

    if (widget.type === 'image_indicator') {
      el.className = 'panel-widget panel-widget--image_indicator';
      el.innerHTML = '';
      const off = document.createElement('img');
      const on = document.createElement('img');
      off.src = widget.images?.off || '';
      on.src = widget.images?.on || '';
      const isOn = widget.runtime?.isOn;
      off.style.display = isOn ? 'none' : 'block';
      on.style.display = isOn ? 'block' : 'none';
      el.append(off, on);
      return;
    }

    if (widget.type === 'static_image') {
      el.className = 'panel-widget panel-widget--static_image panel-widget-static';
      el.innerHTML = '';
      const img = document.createElement('img');
      img.src = widget.images?.src || '';
      el.appendChild(img);
      return;
    }

    if (widget.type === 'image_switch') {
      el.className = 'panel-widget panel-widget--image_switch panel-widget-image-switch';
      el.innerHTML = '';
      const img = document.createElement('img');
      const states = widget.images?.states || [];
      const active = widget.runtime?.activeImage || states[0]?.src || '';
      img.src = active;
      el.appendChild(img);
      return;
    }

    if (widget.type === 'image_toggle') {
      el.className = 'panel-widget panel-widget--image_toggle';
      el.innerHTML = '';
      const img = document.createElement('img');
      const state = widget.runtime?.state || 'off';
      const src =
        state === 'on'
          ? widget.onImage || widget.images?.on
          : state === 'mid'
          ? widget.midImage || widget.images?.mid || widget.onImage || widget.images?.on
          : widget.offImage || widget.images?.off;
      img.src = src || '';
      img.alt = widget.label || 'Image Toggle';
      img.style.objectFit = 'contain';
      el.appendChild(img);
      return;
    }

    return originalRender.call(this, widget, el);
  };

  const originalHandlers = PanelWidgetManager.prototype._registerInteractionHandlers;
  PanelWidgetManager.prototype._registerInteractionHandlers = function patchedHandlers(widget, element) {
    if (widget.type === 'image_toggle') {
      element.addEventListener('click', (event) => {
        if (this.mode !== 'run') return;
        event.preventDefault();
        widget.runtime = widget.runtime || {};
        const hasMid = Boolean(widget.midImage);
        const order = hasMid ? ['off', 'on', 'mid'] : ['off', 'on'];
        const currentIndex = order.indexOf(widget.runtime.state || 'off');
        const nextIndex = (currentIndex + 1) % order.length;
        widget.runtime.state = order[nextIndex];
        this._renderWidget(widget);
        const value = widget.runtime.state === 'on' ? widget.mapping?.onValue : widget.runtime.state === 'mid' ? widget.mapping?.midValue : widget.mapping?.offValue;
        this._emitAction('toggle', widget, { value, state: widget.runtime.state });
      });
      return;
    }
    if (widget.type === 'image_button') {
      element.addEventListener('pointerdown', (event) => {
        if (this.mode !== 'run') return;
        event.preventDefault();
        widget.runtime = widget.runtime || {};
        widget.runtime.isPressed = true;
        this._renderWidget(widget);
        this._emitAction('press', widget, { value: widget.mapping?.pressValue });
      });
      const release = (event) => {
        if (this.mode !== 'run') return;
        event.preventDefault();
        widget.runtime = widget.runtime || {};
        widget.runtime.isPressed = false;
        this._renderWidget(widget);
        this._emitAction('release', widget, { value: widget.mapping?.releaseValue });
      };
      element.addEventListener('pointerup', release);
      element.addEventListener('pointerleave', release);
      return;
    }
    originalHandlers.call(this, widget, element);
  };

  const originalApplyRx = PanelWidgetManager.prototype._applyRx;
  PanelWidgetManager.prototype._applyRx = function patchedApplyRx(widget, payload) {
    normalizeImageSchema(widget);
    return originalApplyRx.call(this, widget, payload);
  };
};

export const registerImageWidgetExtensions = ({ propertiesPanel }) => {
  mutateDefinitionDefaults();
  extendWidgetManager();
  if (propertiesPanel) {
    attachImageStateEditor(propertiesPanel);
    attachImageSwitchEditor(propertiesPanel);
    attachButtonToggleEditors(propertiesPanel);
  }
};

export { createImageDropdown };
