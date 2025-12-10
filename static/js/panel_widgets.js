const idPrefix = 'widget-';

const generateId = () => {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${idPrefix}${suffix}`;
};

const deepMerge = (target, source) => {
  if (!source || typeof source !== 'object') return target;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = value.map((item) => (typeof item === 'object' ? deepClone(item) : item));
      continue;
    }
    if (value && typeof value === 'object') {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      deepMerge(target[key], value);
      continue;
    }
    target[key] = value;
  }
  return target;
};

const deepClone = (value) => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = deepClone(val);
  }
  return out;
};

const toNumber = (value, fallback = null) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toKey = (value) => (value ? String(value).trim().toUpperCase() : '');

const defaultMapping = () => ({ message: '', signal: '' });

export const PANEL_WIDGET_LIBRARY = [
  {
    type: 'button',
    label: 'Button',
    icon: '⏺',
    category: 'Standard',
    description: 'Momentary push button that transmits press and release values mapped to a signal.',
    defaultSize: { w: 2, h: 1 },
    defaults: {
      label: 'Button',
      mapping: { ...defaultMapping(), pressValue: 1, releaseValue: 0 },
    },
    acceptsRx: false,
    supportsScript: true,
    propertySections: [
      {
        title: 'Content',
        fields: [{ label: 'Label', path: 'label', type: 'text', placeholder: 'Button label' }],
      },
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
  },
  {
    type: 'toggle',
    label: 'Toggle Switch',
    icon: '↕',
    category: 'Standard',
    description: 'Two-state toggle that flips values on click and sends mapped on/off values.',
    defaultSize: { w: 2, h: 1 },
    defaults: {
      label: 'Toggle',
      mapping: { ...defaultMapping(), onValue: 1, offValue: 0 },
    },
    supportsScript: true,
    propertySections: [
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
          { label: 'ON value', path: 'mapping.onValue', type: 'number', enum: true },
          { label: 'OFF value', path: 'mapping.offValue', type: 'number', enum: true },
        ],
      },
    ],
  },
  {
    type: 'lamp',
    label: 'Lamp / Indicator',
    icon: '💡',
    category: 'Standard',
    description: 'Receive-only indicator that turns on when the mapped signal matches the configured value.',
    defaultSize: { w: 2, h: 1 },
    defaults: {
      label: 'Lamp',
      mapping: { ...defaultMapping(), onValue: 1, onNamedValue: '' },
    },
    acceptsRx: true,
    supportsScript: true,
    propertySections: [
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
          { label: 'ON value', path: 'mapping.onValue', type: 'number', enum: true },
          { label: 'ON named value', path: 'mapping.onNamedValue', type: 'text' },
        ],
      },
    ],
  },
  {
    type: 'progress',
    label: 'Progress Bar',
    icon: '%',
    category: 'Standard',
    description: 'Receive-only bar that tracks the mapped signal as a percentage.',
    defaultSize: { w: 4, h: 1 },
    defaults: {
      label: 'Progress',
      mapping: { ...defaultMapping(), min: 0, max: 100 },
    },
    acceptsRx: true,
    supportsScript: true,
    propertySections: [
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
          { label: 'Min', path: 'mapping.min', type: 'number' },
          { label: 'Max', path: 'mapping.max', type: 'number' },
        ],
      },
    ],
  },
  {
    type: 'label',
    label: 'Label',
    icon: 'TXT',
    category: 'Standard',
    description: 'Receive-only text label that shows numeric and named values from the mapped signal.',
    defaultSize: { w: 3, h: 2 },
    defaults: {
      label: 'Label',
      mapping: { ...defaultMapping(), unit: '' },
    },
    acceptsRx: true,
    supportsScript: true,
    propertySections: [
      {
        title: 'Content',
        fields: [{ label: 'Title', path: 'label', type: 'text' }],
      },
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
          { label: 'Unit', path: 'mapping.unit', type: 'text' },
        ],
      },
    ],
  },
  {
    type: 'input',
    label: 'Input Box',
    icon: '✎',
    category: 'Standard',
    description: 'Transmit text or numeric values to the mapped signal when edited.',
    defaultSize: { w: 3, h: 1 },
    defaults: {
      label: 'Input',
      mapping: { ...defaultMapping(), submitOnEnter: true },
      options: { placeholder: '' },
    },
    supportsScript: true,
    propertySections: [
      {
        title: 'Content',
        fields: [{ label: 'Placeholder', path: 'options.placeholder', type: 'text' }],
      },
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
        ],
      },
    ],
  },
  {
    type: 'input_button',
    label: 'Input + Button',
    icon: '➡',
    category: 'Standard',
    description: 'Editable input with an explicit send button for mapped signals.',
    defaultSize: { w: 3, h: 1 },
    defaults: {
      label: 'Input',
      mapping: { ...defaultMapping() },
      options: { placeholder: '', buttonLabel: 'Send' },
    },
    supportsScript: true,
    propertySections: [
      {
        title: 'Content',
        fields: [
          { label: 'Placeholder', path: 'options.placeholder', type: 'text' },
          { label: 'Button label', path: 'options.buttonLabel', type: 'text' },
        ],
      },
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
        ],
      },
    ],
  },
  {
    type: 'script',
    label: 'Script Block',
    icon: '{ }',
    category: 'Logic',
    description: 'CAPL-style script block that reacts to widget events and signal updates.',
    defaultSize: { w: 4, h: 2 },
    defaults: {
      label: 'Script Block',
      script: 'on press {\n  // send("ECU", {Signal: 1});\n}',
      useScript: true,
    },
    supportsScript: true,
    propertySections: [
      {
        title: 'Script',
        fields: [{ label: 'Script', path: 'script', type: 'textarea', rows: 6 }],
      },
    ],
  },
  {
    type: 'image_button',
    label: 'Image Button',
    icon: '🖼',
    category: 'Images',
    description: 'Two-state image button that swaps artwork on press and sends mapped values.',
    defaultSize: { w: 3, h: 2 },
    defaults: {
      label: 'Image Button',
      mapping: { ...defaultMapping(), pressValue: 1, releaseValue: 0 },
      images: { normal: '', pressed: '' },
    },
    supportsScript: true,
    propertySections: [
      {
        title: 'Images',
        fields: [
          { label: 'Normal image URL', path: 'images.normal', type: 'text' },
          { label: 'Pressed image URL', path: 'images.pressed', type: 'text' },
        ],
      },
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
  },
  {
    type: 'image_indicator',
    label: 'Image Indicator',
    icon: '🖼',
    category: 'Images',
    description: 'Multi-state image indicator that swaps artwork based on received signal values.',
    defaultSize: { w: 3, h: 2 },
    defaults: {
      label: 'Image Indicator',
      mapping: { ...defaultMapping(), onValue: 1 },
      images: { off: '', on: '' },
    },
    acceptsRx: true,
    supportsScript: true,
    propertySections: [
      {
        title: 'Images',
        fields: [
          { label: 'Off image URL', path: 'images.off', type: 'text' },
          { label: 'On image URL', path: 'images.on', type: 'text' },
        ],
      },
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
          { label: 'ON value', path: 'mapping.onValue', type: 'number', enum: true },
        ],
      },
    ],
  },
  {
    type: 'static_image',
    label: 'Static Image',
    icon: '🖼',
    category: 'Images',
    description: 'Decorative static image for layout framing and labels.',
    defaultSize: { w: 4, h: 3 },
    defaults: {
      label: 'Image',
      images: { src: '' },
    },
    supportsScript: false,
    propertySections: [
      {
        title: 'Image',
        fields: [{ label: 'Image URL', path: 'images.src', type: 'text' }],
      },
    ],
  },
  {
    type: 'image_switch',
    label: 'Image Switch',
    icon: '🖼',
    category: 'Images',
    description: 'Multi-state switch that chooses an image based on an enumerated signal value.',
    defaultSize: { w: 4, h: 3 },
    defaults: {
      label: 'Image Switch',
      mapping: { ...defaultMapping() },
      images: { states: [] },
    },
    acceptsRx: true,
    supportsScript: true,
    propertySections: [
      {
        title: 'States',
        fields: [
          {
            label: 'States (value=url per line)',
            path: 'images.states',
            type: 'textarea',
            rows: 4,
            formatter: 'statePairs',
          },
        ],
      },
      {
        title: 'Mapping',
        fields: [
          { label: 'Message', path: 'mapping.message', type: 'text', autocomplete: 'message' },
          { label: 'Signal', path: 'mapping.signal', type: 'text', autocomplete: 'signal' },
        ],
      },
    ],
  },
];

export const getWidgetDefinition = (type) => PANEL_WIDGET_LIBRARY.find((entry) => entry.type === type);

export const createWidgetData = (type, overrides = {}) => {
  const definition = getWidgetDefinition(type);
  if (!definition) return null;
  const id = overrides.id || generateId();
  const base = {
    id,
    type,
    label: definition.defaults?.label ?? definition.label,
    pos: { x: 1, y: 1 },
    size: { ...(definition.defaultSize || { w: 2, h: 1 }) },
    mapping: { ...defaultMapping(), ...(definition.defaults?.mapping || {}) },
    images: deepClone(definition.defaults?.images || {}),
    options: deepClone(definition.defaults?.options || {}),
    script: definition.defaults?.script || '',
    useScript: Boolean(overrides.useScript ?? definition.defaults?.useScript ?? false),
    runtime: {},
  };
  if (definition.defaults) {
    const extras = { ...definition.defaults };
    delete extras.label;
    delete extras.mapping;
    delete extras.images;
    delete extras.options;
    delete extras.script;
    deepMerge(base, extras);
  }
  return deepMerge(base, overrides);
};

export class PanelWidgetManager {
  constructor({ canvas, grid, onAction, onRemove } = {}) {
    this.canvas = canvas;
    this.grid = grid;
    this.onAction = onAction;
    this.onRemove = onRemove;
    this.onRender = null;
    this.widgets = new Map();
    this.elements = new Map();
    this.signalIndex = new Map();
    this.mode = 'edit';
  }

  setRenderCallback(callback) {
    this.onRender = typeof callback === 'function' ? callback : null;
  }

  clear() {
    this.widgets.clear();
    this.signalIndex.clear();
    this.renderAll();
    this._purgeOrphanDom();
  }

  setMode(mode) {
    this.mode = mode === 'run' ? 'run' : 'edit';
    this.renderAll();
  }

  _buildSignalKey(message, signal) {
    const msgKey = toKey(message);
    const sigKey = toKey(signal);
    if (!msgKey || !sigKey) return '';
    return `${msgKey}::${sigKey}`;
  }

  _updateSignalIndex(widget) {
    const currentKey = widget._signalKey;
    if (currentKey && this.signalIndex.has(currentKey)) {
      const set = this.signalIndex.get(currentKey);
      set.delete(widget.id);
      if (!set.size) {
        this.signalIndex.delete(currentKey);
      }
    }
    const mapping = widget.mapping || {};
    const nextKey = this._buildSignalKey(mapping.message, mapping.signal);
    if (nextKey) {
      if (!this.signalIndex.has(nextKey)) {
        this.signalIndex.set(nextKey, new Set());
      }
      this.signalIndex.get(nextKey).add(widget.id);
      widget._signalKey = nextKey;
    } else {
      widget._signalKey = null;
    }
  }

  addWidget(config) {
    const data = createWidgetData(config.type, config);
    if (!data) return null;
    this.widgets.set(data.id, data);
    this._updateSignalIndex(data);
    this.renderAll();
    return data;
  }

  _renderWidget(widget, element) {
    if (!widget || !element) return;
    element.className = `panel-widget panel-widget--${widget.type}`;
    element.dataset.widgetId = widget.id;
    element.dataset.widgetType = widget.type;
    element.setAttribute('data-widget-id', widget.id);
    element.setAttribute('data-widget-type', widget.type);
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    switch (widget.type) {
      case 'button':
        this._renderButton(widget, element);
        break;
      case 'toggle':
        this._renderToggle(widget, element);
        break;
      case 'lamp':
        this._renderLamp(widget, element);
        break;
      case 'progress':
        this._renderProgress(widget, element);
        break;
      case 'label':
        this._renderLabel(widget, element);
        break;
      case 'input':
        this._renderInput(widget, element);
        break;
      case 'input_button':
        this._renderInputButton(widget, element);
        break;
      case 'script':
        this._renderScript(widget, element);
        break;
      case 'image_button':
        this._renderImageButton(widget, element);
        break;
      case 'image_indicator':
        this._renderImageIndicator(widget, element);
        break;
      case 'static_image':
        this._renderStaticImage(widget, element);
        break;
      case 'image_switch':
        this._renderImageSwitch(widget, element);
        break;
      default:
        element.textContent = widget.label || widget.type;
    }
    this.grid?.applyPosition(widget, element);
  }

  _renderButton(widget, element) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = widget.label || 'Button';
    element.appendChild(btn);
  }

  _renderToggle(widget, element) {
    element.classList.add('panel-widget-with-caption');
    const body = document.createElement('div');
    body.className = 'panel-widget-body';
    const toggle = document.createElement('div');
    toggle.className = 'panel-toggle-switch';
    const thumb = document.createElement('div');
    thumb.className = 'panel-toggle-thumb';
    toggle.appendChild(thumb);
    if (widget.runtime?.isOn) {
      toggle.classList.add('is-on');
    }
    body.appendChild(toggle);
    const caption = document.createElement('div');
    caption.className = 'panel-widget-caption';
    caption.textContent = widget.label || 'Toggle';
    element.append(body, caption);
  }

  _renderLamp(widget, element) {
    element.classList.add('panel-widget-with-caption');
    const body = document.createElement('div');
    body.className = 'panel-widget-body';
    const lamp = document.createElement('div');
    lamp.className = 'panel-lamp-indicator';
    if (widget.runtime?.isOn) {
      lamp.classList.add('is-on');
    }
    body.appendChild(lamp);
    const caption = document.createElement('div');
    caption.className = 'panel-widget-caption';
    caption.textContent = widget.label || 'Lamp';
    element.append(body, caption);
  }

  _renderProgress(widget, element) {
    element.classList.add('panel-widget-with-caption');
    const body = document.createElement('div');
    body.className = 'panel-widget-body';
    const shell = document.createElement('div');
    shell.className = 'panel-progress-shell';
    const fill = document.createElement('div');
    fill.className = 'panel-progress-fill';
    fill.style.width = `${widget.runtime?.percent ?? 0}%`;
    shell.appendChild(fill);
    body.appendChild(shell);
    const caption = document.createElement('div');
    caption.className = 'panel-widget-caption';
    caption.textContent = widget.label || 'Progress';
    element.append(body, caption);
  }

  _renderLabel(widget, element) {
    const wrapper = document.createElement('div');
    wrapper.className = 'panel-widget-label';
    const title = document.createElement('div');
    title.textContent = widget.label || 'Label';
    const valueEl = document.createElement('span');
    valueEl.className = 'panel-label-value';
    valueEl.textContent = widget.runtime?.displayValue ?? '—';
    const namedEl = document.createElement('span');
    namedEl.className = 'panel-label-named';
    namedEl.textContent = widget.runtime?.namedValue ?? '';
    wrapper.append(title, valueEl, namedEl);
    element.appendChild(wrapper);
  }

  _renderInput(widget, element) {
    element.classList.add('panel-widget-with-caption', 'panel-widget-input');
    const caption = document.createElement('div');
    caption.className = 'panel-widget-caption';
    caption.textContent = widget.label || 'Input';
    const row = document.createElement('div');
    row.className = 'panel-input-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = widget.options?.placeholder || widget.label || 'Value';
    const currentValue = widget.runtime?.inputValue ?? '';
    input.value = currentValue;
    input.addEventListener('input', (event) => {
      widget.runtime = widget.runtime || {};
      widget.runtime.inputValue = event.target.value;
    });
    input.addEventListener('focus', () => {
      input.select();
    });
    if (this.mode !== 'run') {
      input.setAttribute('readonly', 'readonly');
    }
    row.append(input);
    element.append(caption, row);
  }

  _renderInputButton(widget, element) {
    element.classList.add('panel-widget-with-caption', 'panel-widget-input', 'panel-widget-input-button');
    const caption = document.createElement('div');
    caption.className = 'panel-widget-caption';
    caption.textContent = widget.label || 'Input';
    const row = document.createElement('div');
    row.className = 'panel-input-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = widget.options?.placeholder || widget.label || 'Value';
    input.value = widget.runtime?.inputValue ?? '';
    input.addEventListener('input', (event) => {
      widget.runtime = widget.runtime || {};
      widget.runtime.inputValue = event.target.value;
    });
    input.addEventListener('focus', () => {
      input.select();
    });
    if (this.mode !== 'run') {
      input.setAttribute('readonly', 'readonly');
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = widget.options?.buttonLabel || 'Send';
    button.toggleAttribute('disabled', this.mode !== 'run');
    row.append(input, button);
    element.append(caption, row);
  }

  _renderScript(widget, element) {
    const block = document.createElement('div');
    block.className = 'panel-script-block';
    block.textContent = widget.script || 'on press {\n  // script\n}';
    element.appendChild(block);
  }

  _renderImageButton(widget, element) {
    const normal = document.createElement('img');
    normal.src = widget.images?.normal || '';
    normal.alt = widget.label || 'Button';
    const pressed = document.createElement('img');
    pressed.src = widget.images?.pressed || widget.images?.normal || '';
    pressed.alt = (widget.label || 'Button') + ' pressed';
    pressed.style.display = widget.runtime?.isPressed ? 'block' : 'none';
    normal.style.display = widget.runtime?.isPressed ? 'none' : 'block';
    element.append(normal, pressed);
  }

  _renderImageIndicator(widget, element) {
    const offImg = document.createElement('img');
    offImg.src = widget.images?.off || '';
    const onImg = document.createElement('img');
    onImg.src = widget.images?.on || '';
    const isOn = widget.runtime?.isOn;
    offImg.style.display = isOn ? 'none' : 'block';
    onImg.style.display = isOn ? 'block' : 'none';
    element.append(offImg, onImg);
  }

  _renderStaticImage(widget, element) {
    const img = document.createElement('img');
    img.src = widget.images?.src || '';
    img.alt = widget.label || 'Image';
    element.classList.add('panel-widget-static');
    element.appendChild(img);
  }

  _renderImageSwitch(widget, element) {
    const img = document.createElement('img');
    img.src = widget.runtime?.activeImage || widget.images?.states?.[0]?.src || '';
    img.alt = widget.label || 'Image';
    element.classList.add('panel-widget-image-switch');
    element.appendChild(img);
  }

  _registerInteractionHandlers(widget, element) {
    if (!element) return;
    const type = widget.type;
    if (type === 'button' || type === 'image_button' || type === 'script') {
      const pointerDown = (event) => {
        if (this.mode !== 'run') return;
        event.preventDefault();
        if (widget.runtime) widget.runtime.isPressed = true;
        this._renderWidget(widget, element);
        this._emitAction('press', widget, { value: widget.mapping?.pressValue });
      };
      const pointerUp = (event) => {
        if (this.mode !== 'run') return;
        event.preventDefault();
        if (widget.runtime) widget.runtime.isPressed = false;
        this._renderWidget(widget, element);
        this._emitAction('release', widget, { value: widget.mapping?.releaseValue });
      };
      element.addEventListener('pointerdown', pointerDown);
      element.addEventListener('pointerup', pointerUp);
      element.addEventListener('pointerleave', pointerUp);
    } else if (type === 'toggle') {
      element.addEventListener('click', (event) => {
        if (this.mode !== 'run') return;
        event.preventDefault();
        widget.runtime = widget.runtime || {};
        widget.runtime.isOn = !widget.runtime.isOn;
        this._renderWidget(widget, element);
        const value = widget.runtime.isOn ? widget.mapping?.onValue : widget.mapping?.offValue;
        this._emitAction('toggle', widget, { value, active: widget.runtime.isOn });
      });
    } else if (type === 'input') {
      element.addEventListener('keydown', (event) => {
        if (this.mode !== 'run') return;
        if (event.key !== 'Enter') return;
        const input = event.target;
        const value = input.value;
        widget.runtime = widget.runtime || {};
        widget.runtime.inputValue = value;
        this._emitAction('input', widget, { value });
      });
    } else if (type === 'input_button') {
      element.addEventListener('keydown', (event) => {
        if (this.mode !== 'run') return;
        if (event.key !== 'Enter') return;
        const input = event.target;
        const value = input.value;
        widget.runtime = widget.runtime || {};
        widget.runtime.inputValue = value;
        this._emitAction('submit', widget, { value });
      });
      element.addEventListener('click', (event) => {
        if (this.mode !== 'run') return;
        const button = event.target.closest('button');
        if (!button || !element.contains(button)) return;
        const input = element.querySelector('input');
        const value = input?.value ?? '';
        widget.runtime = widget.runtime || {};
        widget.runtime.inputValue = value;
        this._emitAction('submit', widget, { value });
      });
    }
  }

  _emitAction(type, widget, payload = {}) {
    if (this.mode !== 'run') return;
    if (typeof this.onAction === 'function') {
      this.onAction(widget, type, payload);
    }
  }

  getWidget(id) {
    return this.widgets.get(id) || null;
  }

  updateWidget(id, updater) {
    const widget = this.widgets.get(id);
    if (!widget) return null;
    if (typeof updater === 'function') {
      updater(widget);
    } else if (updater && typeof updater === 'object') {
      deepMerge(widget, updater);
    }
    this._updateSignalIndex(widget);
    this.renderAll();
    return widget;
  }

  serialize() {
    return Array.from(this.widgets.values()).map((widget) => {
      const copy = deepClone(widget);
      delete copy.runtime;
      delete copy._signalKey;
      return copy;
    });
  }

  _refreshCanvasSpace() {
    let maxRow = 0;
    this.widgets.forEach((widget) => {
      const height = typeof widget.size?.h === 'number' ? widget.size.h : 1;
      const start = typeof widget.pos?.y === 'number' ? widget.pos.y : 1;
      const bottom = start + height - 1;
      if (bottom > maxRow) {
        maxRow = bottom;
      }
    });
    this.grid?.ensureSpareRows(maxRow);
  }

  loadWidgets(widgets = []) {
    this.widgets.clear();
    this.signalIndex.clear();
    const usedIds = new Set();
    widgets.forEach((cfg) => {
      if (!cfg || !cfg.type) return;
      const base = { ...cfg };
      const id = base.id && !usedIds.has(base.id) ? base.id : generateId();
      base.id = id;
      usedIds.add(id);
      const data = createWidgetData(base.type, base);
      if (!data) return;
      this.widgets.set(data.id, data);
      this._updateSignalIndex(data);
    });
    this.renderAll();
    this._purgeOrphanDom();
  }

  removeWidget(id) {
    const widget = this.widgets.get(id);
    if (!widget) return;
    const element = this.canvas?.querySelector(`[data-widget-id="${id}"]`);
    element?.remove();
    this.widgets.delete(id);
    this.elements.delete(id);
    const key = widget._signalKey;
    if (key && this.signalIndex.has(key)) {
      const set = this.signalIndex.get(key);
      set.delete(id);
      if (!set.size) {
        this.signalIndex.delete(key);
      }
    }
    this.renderAll();
    this._purgeOrphanDom();
    if (typeof this.onRemove === 'function') {
      this.onRemove(id, widget);
    }
  }

  forEach(callback) {
    this.widgets.forEach((widget, id) => callback(widget, id));
  }

  applySignalUpdate(message, signal, payload) {
    const key = this._buildSignalKey(message, signal);
    if (!key) return [];
    const ids = this.signalIndex.get(key);
    if (!ids || !ids.size) return [];
    const results = [];
    let needsRender = false;
    ids.forEach((id) => {
      const widget = this.widgets.get(id);
      if (!widget) return;
      const didChange = this._applyRx(widget, payload);
      if (didChange) {
        needsRender = true;
      }
      results.push({ widget, changed: didChange });
    });
    if (needsRender) {
      this.renderAll();
    }
    return results;
  }

  _applyRx(widget, payload) {
    const { physical, raw, named } = payload;
    const value = physical ?? raw;
    const mapping = widget.mapping || {};
    widget.runtime = widget.runtime || {};
    if (widget.type === 'lamp' || widget.type === 'image_indicator') {
      const onValue = mapping.onValue;
      const onNamed = mapping.onNamedValue ? String(mapping.onNamedValue).trim().toLowerCase() : '';
      let isOn = false;
      if (typeof onValue === 'number') {
        isOn = Number(value) === Number(onValue);
      } else if (onValue !== undefined && onValue !== null && onValue !== '') {
        isOn = Number(value) === Number(onValue);
      }
      if (!isOn && onNamed && named) {
        isOn = String(named).trim().toLowerCase() === onNamed;
      }
      if (widget.runtime.isOn === isOn) return false;
      widget.runtime.isOn = isOn;
      return true;
    }
    if (widget.type === 'progress') {
      const min = toNumber(mapping.min, 0);
      const max = toNumber(mapping.max, 100);
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return false;
      const percent = ((numeric - min) / (max - min || 1)) * 100;
      const clamped = Math.max(0, Math.min(100, percent));
      const prev = widget.runtime.percent;
      widget.runtime.percent = clamped;
      return prev !== clamped;
    }
    if (widget.type === 'label') {
      const unit = mapping.unit ? ` ${mapping.unit}` : '';
      const hasNumeric = Number.isFinite(Number(value));
      const displayValue = hasNumeric ? `${Number(value)}${unit}` : named || '—';
      const prevValue = widget.runtime.displayValue;
      const prevNamed = widget.runtime.namedValue;
      widget.runtime.displayValue = displayValue;
      widget.runtime.namedValue = named ? String(named) : '';
      return prevValue !== displayValue || prevNamed !== widget.runtime.namedValue;
    }
    if (widget.type === 'image_switch') {
      const states = widget.images?.states || [];
      const numeric = Number(value);
      let targetSrc = states.find((state) => Number(state.value) === numeric)?.src;
      if (!targetSrc && states.length) {
        targetSrc = states[0].src;
      }
      if (!targetSrc || widget.runtime.activeImage === targetSrc) return false;
      widget.runtime.activeImage = targetSrc;
      return true;
    }
    return false;
  }

  findWidgetByLabel(label) {
    if (!label) return null;
    const normalized = String(label).trim().toLowerCase();
    for (const widget of this.widgets.values()) {
      if (String(widget.label || '').trim().toLowerCase() === normalized) {
        return widget;
      }
    }
    return null;
  }

  applyScriptAction(action) {
    if (!action || !action.type) return;
    if (action.type === 'lamp') {
      const target = this.findWidgetByLabel(action.target) || this.widgets.get(action.target);
      if (!target) return;
      target.runtime = target.runtime || {};
      target.runtime.isOn = action.state === 'on';
      this.renderAll();
      return;
    }
    if (action.type === 'widget_state') {
      const target = this.findWidgetByLabel(action.target) || this.widgets.get(action.target);
      if (!target) return;
      target.runtime = target.runtime || {};
      Object.assign(target.runtime, action.state || {});
      this.renderAll();
    }
  }

  _purgeOrphanDom() {
    if (!this.canvas) return;
    requestAnimationFrame(() => {
      const nodes = Array.from(this.canvas.querySelectorAll('.panel-widget'));
      nodes.forEach((node) => {
        const widgetId = node.dataset?.widgetId;
        if (!widgetId || !this.widgets.has(widgetId)) {
          node.remove();
        }
      });
    });
  }

  _createElement(widget) {
    const element = document.createElement('div');
    element.setAttribute('role', 'group');
    element.style.touchAction = 'none';
    element.dataset.widgetId = widget.id;
    element.dataset.widgetType = widget.type;
    element.classList.add('panel-widget');
    this._renderWidget(widget, element);
    this._registerInteractionHandlers(widget, element);
    return element;
  }

  renderAll() {
    if (!this.canvas) return;
    this.elements.clear();
    this.canvas.innerHTML = '';
    this.widgets.forEach((widget) => {
      const element = this._createElement(widget);
      this.elements.set(widget.id, element);
      this.canvas.appendChild(element);
      this.grid?.applyPosition(widget, element);
    });
    this._refreshCanvasSpace();
    if (typeof this.onRender === 'function') {
      this.onRender();
    }
  }
}
