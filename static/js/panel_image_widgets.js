import { PANEL_WIDGET_LIBRARY, PanelWidgetManager, getWidgetDefinition } from './panel_widgets.js';

const IMAGE_COLORS = ['white', 'blue', 'red'];

const normalizeImagePath = (folder, file) => {
  if (!folder || !file) return '';
  return `/static/assets/${folder}/${file}`;
};

let imageCatalog = null;

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
    label: 'Image Indicator',
    category: 'Images',
    icon: '🖼',
    description: 'Multi-state image indicator that swaps artwork based on received signal values.',
    defaultSize: { w: 2, h: 2 },
    defaults: {
      label: 'Image Indicator',
      mapping: { message: '', signal: '', onValue: 1 },
      states: [
        { value: 0, image: '/static/assets/white/icons8-temperature-50.png' },
        { value: 1, image: '/static/assets/red/icons8-temperature-50.png' },
      ],
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

  ensureDefinition('image_button', {
    label: 'Image Button (2-state)',
    category: 'Images',
    icon: '🖼',
    description: 'Two-state image button that toggles artwork on press and sends mapped values.',
    defaultSize: { w: 2, h: 2 },
    defaults: {
      label: 'Image Button',
      normalImage: '/static/assets/white/icons8-switch-off-50.png',
      pressedImage: '/static/assets/red/icons8-switch-on-50.png',
      mapping: { message: '', signal: '', pressValue: 1, releaseValue: 0 },
    },
    supportsScript: true,
    propertySections: [
      { title: 'Images', fields: [{ label: 'Images', path: 'images', type: 'imageButton' }] },
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
          { label: 'Press value', path: 'mapping.pressValue', type: 'number', enum: true },
          { label: 'Release value', path: 'mapping.releaseValue', type: 'number', enum: true },
        ],
      },
    ],
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
    label: 'Static Image',
    category: 'Images',
    icon: '🖼',
    description: 'Decorative static image for layout framing and legends.',
    defaultSize: { w: 2, h: 2 },
    defaults: { label: 'Image', image: '/static/assets/white/icons8-temperature-50.png' },
    propertySections: [{ title: 'Image', fields: [{ label: 'Image', path: 'image', type: 'imagePicker' }] }],
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

const parseCatalogPath = (src = '') => {
  const folder = (src.split('/') || []).find((part) => IMAGE_COLORS.includes(part)) || '';
  const file = src.split('/').filter(Boolean).pop() || '';
  return { folder, file };
};

const buildImageSelect = (catalog, currentSrc = '') => {
  const select = document.createElement('select');
  select.className = 'panel-image-select';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose image';
  select.appendChild(placeholder);

  const { folder: currentFolder, file: currentFile } = parseCatalogPath(currentSrc);

  Object.entries(catalog || {}).forEach(([folder, files]) => {
    const group = document.createElement('optgroup');
    group.label = folder;
    (files || []).forEach((file) => {
      const value = normalizeImagePath(folder, file);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = file;
      option.className = 'panel-image-option';
      option.style.backgroundImage = `url(${value})`;
      if (folder === currentFolder && file === currentFile) {
        option.selected = true;
      }
      group.appendChild(option);
    });
    select.appendChild(group);
  });

  if (currentSrc && !select.value) {
    const custom = document.createElement('option');
    custom.value = currentSrc;
    custom.textContent = 'Custom image';
    custom.selected = true;
    select.appendChild(custom);
  }

  return select;
};

const createPreview = (src) => {
  const wrap = document.createElement('div');
  wrap.className = 'panel-image-preview';
  const img = document.createElement('img');
  img.src = src || '';
  img.alt = 'preview';
  wrap.appendChild(img);
  return { wrap, img };
};

const attachImageStateEditor = (panel) => {
  panel.registerCustomRenderer('image_indicator', async ({ form, widget }) => {
    const catalog = await fetchImageCatalog();
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'panel-section-title';
    sectionTitle.textContent = 'Image States';
    form.appendChild(sectionTitle);

    const list = document.createElement('div');
    list.className = 'panel-image-state-list';

    const renderRows = () => {
      list.innerHTML = '';
      const states = Array.isArray(widget.states) ? widget.states : [];
      states.forEach((state, index) => {
        const row = document.createElement('div');
        row.className = 'panel-image-state-row';
        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.value = state.value ?? 0;

        const imageSelect = buildImageSelect(catalog, state.image);

        const preview = createPreview(state.image || '').img;

        const updateState = () => {
          const nextStates = Array.isArray(widget.states) ? [...widget.states] : [];
          nextStates[index] = {
            value: Number(valueInput.value),
            image: imageSelect.value || '',
          };
          panel._emitChange('states', nextStates);
          preview.src = nextStates[index].image;
        };

        valueInput.addEventListener('change', updateState);
        imageSelect.addEventListener('change', updateState);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = '–';
        deleteBtn.addEventListener('click', () => {
          const nextStates = Array.isArray(widget.states) ? [...widget.states] : [];
          nextStates.splice(index, 1);
          panel._emitChange('states', nextStates);
          renderRows();
        });

        row.append(
          valueInput,
          imageSelect,
          preview,
          deleteBtn,
        );
        list.appendChild(row);
      });
    };

    renderRows();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add State +';
    addBtn.addEventListener('click', () => {
      const nextStates = Array.isArray(widget.states) ? [...widget.states] : [];
      nextStates.push({ value: nextStates.length, image: '' });
      panel._emitChange('states', nextStates);
      renderRows();
    });

    form.appendChild(list);
    form.appendChild(addBtn);
  });
};

const attachImageSwitchEditor = (panel) => {
  panel.registerCustomRenderer('image_switch', async ({ form, widget }) => {
    const catalog = await fetchImageCatalog();
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'panel-section-title';
    sectionTitle.textContent = 'Image States';
    form.appendChild(sectionTitle);

    const list = document.createElement('div');
    list.className = 'panel-image-state-list';

    const renderRows = () => {
      list.innerHTML = '';
      const states = Array.isArray(widget.images?.states) ? widget.images.states : [];
      states.forEach((state, index) => {
        const row = document.createElement('div');
        row.className = 'panel-image-state-row';

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.value = state.value ?? 0;

        const imageSelect = buildImageSelect(catalog, state.src);

        const preview = createPreview(state.src || '').img;

        const update = () => {
          const nextStates = Array.isArray(widget.images?.states) ? [...widget.images.states] : [];
          nextStates[index] = {
            value: Number(valueInput.value),
            src: imageSelect.value || '',
          };
          panel._emitChange('images.states', nextStates);
          preview.src = nextStates[index].src;
        };

        valueInput.addEventListener('change', update);
        imageSelect.addEventListener('change', update);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = '–';
        deleteBtn.addEventListener('click', () => {
          const nextStates = Array.isArray(widget.images?.states) ? [...widget.images.states] : [];
          nextStates.splice(index, 1);
          panel._emitChange('images.states', nextStates);
          renderRows();
        });

        row.append(valueInput, imageSelect, preview, deleteBtn);
        list.appendChild(row);
      });
    };

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
  const renderImagePicker = async (wrapper, currentValue, onChange) => {
    const catalog = await fetchImageCatalog();
    const imageSelect = buildImageSelect(catalog, currentValue);
    const preview = createPreview(currentValue || '').img;

    const update = () => {
      const src = imageSelect.value || '';
      preview.src = src;
      onChange(src);
    };

    imageSelect.addEventListener('change', update);

    wrapper.append(imageSelect, preview);
  };

  panel.registerCustomRenderer('image_button', ({ form, widget }) => {
    const title = document.createElement('div');
    title.className = 'panel-section-title';
    title.textContent = 'Images';
    form.appendChild(title);
    const normalRow = document.createElement('div');
    normalRow.className = 'panel-field panel-image-inline';
    normalRow.appendChild(document.createElement('label')).textContent = 'Normal image';
    renderImagePicker(normalRow, widget.normalImage || widget.images?.normal, (src) => {
      panel._emitChange('normalImage', src);
    });
    form.appendChild(normalRow);

    const pressedRow = document.createElement('div');
    pressedRow.className = 'panel-field panel-image-inline';
    pressedRow.appendChild(document.createElement('label')).textContent = 'Pressed image';
    renderImagePicker(pressedRow, widget.pressedImage || widget.images?.pressed, (src) => {
      panel._emitChange('pressedImage', src);
    });
    form.appendChild(pressedRow);
  });

  panel.registerCustomRenderer('image_toggle', ({ form, widget }) => {
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
      renderImagePicker(wrapper, widget[row.key], (src) => panel._emitChange(row.key, src));
      form.appendChild(wrapper);
    });
  });

  panel.registerCustomRenderer('static_image', ({ form, widget }) => {
    const title = document.createElement('div');
    title.className = 'panel-section-title';
    title.textContent = 'Image';
    form.appendChild(title);
    const wrapper = document.createElement('div');
    wrapper.className = 'panel-field panel-image-inline';
    wrapper.appendChild(document.createElement('label')).textContent = 'Image';
    renderImagePicker(wrapper, widget.image || widget.images?.src, (src) => panel._emitChange('image', src));
    form.appendChild(wrapper);
  });
};

const extendWidgetManager = () => {
  const originalRender = PanelWidgetManager.prototype._renderWidget;
  PanelWidgetManager.prototype._renderWidget = function patchedRender(widget) {
    const element = this.elements.get(widget.id);
    if (!element) return;
    if (widget.type === 'image_indicator') {
      element.className = `panel-widget panel-widget--${widget.type}`;
      element.dataset.widgetId = widget.id;
      element.dataset.widgetType = widget.type;
      element.innerHTML = '';
      const img = document.createElement('img');
      const states = Array.isArray(widget.states) ? widget.states : [];
      const stateMatch = states.find((state) => Number(state.value) === Number(widget.runtime?.activeValue));
      const src = stateMatch?.image || states[0]?.image || '';
      img.src = src || '';
      img.alt = widget.label || 'Image Indicator';
      img.style.objectFit = 'contain';
      element.appendChild(img);
      this.grid?.applyPosition(widget, element);
      return;
    }
    if (widget.type === 'image_button') {
      element.className = `panel-widget panel-widget--${widget.type}`;
      element.dataset.widgetId = widget.id;
      element.dataset.widgetType = widget.type;
      element.innerHTML = '';
      const img = document.createElement('img');
      const pressed = widget.runtime?.isPressed;
      const normalSrc = widget.normalImage || widget.images?.normal || '';
      const pressedSrc = widget.pressedImage || widget.images?.pressed || normalSrc;
      img.src = pressed ? pressedSrc : normalSrc;
      img.alt = widget.label || 'Image Button';
      img.style.objectFit = 'contain';
      element.appendChild(img);
      this.grid?.applyPosition(widget, element);
      return;
    }
    if (widget.type === 'image_toggle') {
      element.className = `panel-widget panel-widget--${widget.type}`;
      element.dataset.widgetId = widget.id;
      element.dataset.widgetType = widget.type;
      element.innerHTML = '';
      const img = document.createElement('img');
      const state = widget.runtime?.state || 'off';
      const src = state === 'on' ? widget.onImage : state === 'mid' ? widget.midImage || widget.onImage : widget.offImage;
      img.src = src || '';
      img.alt = widget.label || 'Image Toggle';
      img.style.objectFit = 'contain';
      element.appendChild(img);
      this.grid?.applyPosition(widget, element);
      return;
    }
    if (widget.type === 'static_image') {
      element.className = `panel-widget panel-widget--${widget.type}`;
      element.dataset.widgetId = widget.id;
      element.dataset.widgetType = widget.type;
      element.innerHTML = '';
      const img = document.createElement('img');
      img.src = widget.image || widget.images?.src || '';
      img.alt = widget.label || 'Static';
      img.style.objectFit = 'contain';
      element.appendChild(img);
      this.grid?.applyPosition(widget, element);
      return;
    }
    originalRender.call(this, widget);
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
    if (widget.type === 'image_indicator') {
      const states = Array.isArray(widget.states) ? widget.states : [];
      const value = payload.physical ?? payload.raw;
      const numeric = Number(value);
      const match = states.find((state) => Number(state.value) === numeric);
      const nextImage = match?.image || states[0]?.image || '';
      if (!widget.runtime) widget.runtime = {};
      const changed = widget.runtime.activeValue !== numeric || widget.runtime.activeImage !== nextImage;
      widget.runtime.activeValue = numeric;
      widget.runtime.activeImage = nextImage;
      return changed;
    }
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
