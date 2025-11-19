const idPrefix = 'panel_widget_';
let widgetCounter = 0;

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
    defaultSize: { w: 3, h: 1 },
    defaults: {
      label: 'Input',
      mapping: { ...defaultMapping(), submitOnEnter: true },
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
    type: 'script',
    label: 'Script Block',
    icon: '{ }',
    category: 'Logic',
    defaultSize: { w: 4, h: 2 },
    defaults: {
      label: 'Script Block',
      script: 'on press {\n  // send("ECU", {Signal: 1});\n}',
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
  const id = overrides.id || `${idPrefix}${String(++widgetCounter).padStart(3, '0')}`;
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
    runtime: {},
  };
  return deepMerge(base, overrides);
};

export class PanelWidgetManager {
  constructor({ canvas, grid, onAction } = {}) {
    this.canvas = canvas;
    this.grid = grid;
    this.onAction = onAction;
    this.widgets = new Map();
    this.elements = new Map();
    this.signalIndex = new Map();
    this.mode = 'edit';
  }

  clear() {
    this.widgets.clear();
    this.signalIndex.clear();
    this.elements.forEach((el) => el.remove());
    this.elements.clear();
  }

  setMode(mode) {
    this.mode = mode === 'run' ? 'run' : 'edit';
    this.widgets.forEach((widget) => {
      if (widget.type === 'input') {
        const el = this.elements.get(widget.id);
        const input = el?.querySelector('input');
        if (input) {
          input.toggleAttribute('readonly', this.mode !== 'run');
        }
      }
    });
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
    const element = document.createElement('div');
    element.className = `panel-widget panel-widget--${data.type}`;
    element.dataset.widgetId = data.id;
    element.dataset.widgetType = data.type;
    element.setAttribute('role', 'group');
    element.style.touchAction = 'none';
    this.elements.set(data.id, element);
    if (this.canvas) {
      this.canvas.appendChild(element);
    }
    this.grid?.applyPosition(data, element);
    this._renderWidget(data);
    this._registerInteractionHandlers(data, element);
    this._updateSignalIndex(data);
    return data;
  }

  _renderWidget(widget) {
    const element = this.elements.get(widget.id);
    if (!element) return;
    element.className = `panel-widget panel-widget--${widget.type}`;
    element.dataset.widgetId = widget.id;
    element.dataset.widgetType = widget.type;
    element.innerHTML = '';
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
    const toggle = document.createElement('div');
    toggle.className = 'panel-toggle-switch';
    const thumb = document.createElement('div');
    thumb.className = 'panel-toggle-thumb';
    toggle.appendChild(thumb);
    if (widget.runtime?.isOn) {
      toggle.classList.add('is-on');
    }
    element.appendChild(toggle);
  }

  _renderLamp(widget, element) {
    const lamp = document.createElement('div');
    lamp.className = 'panel-lamp-indicator';
    if (widget.runtime?.isOn) {
      lamp.classList.add('is-on');
    }
    element.appendChild(lamp);
  }

  _renderProgress(widget, element) {
    const shell = document.createElement('div');
    shell.className = 'panel-progress-shell';
    const fill = document.createElement('div');
    fill.className = 'panel-progress-fill';
    fill.style.width = `${widget.runtime?.percent ?? 0}%`;
    shell.appendChild(fill);
    element.appendChild(shell);
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
    element.classList.add('panel-widget-input');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = widget.options?.placeholder || widget.label || 'Value';
    input.value = '';
    if (this.mode !== 'run') {
      input.setAttribute('readonly', 'readonly');
    }
    element.appendChild(input);
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
        this._renderWidget(widget);
        this._emitAction('press', widget, { value: widget.mapping?.pressValue });
      };
      const pointerUp = (event) => {
        if (this.mode !== 'run') return;
        event.preventDefault();
        if (widget.runtime) widget.runtime.isPressed = false;
        this._renderWidget(widget);
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
        this._renderWidget(widget);
        const value = widget.runtime.isOn ? widget.mapping?.onValue : widget.mapping?.offValue;
        this._emitAction('toggle', widget, { value, active: widget.runtime.isOn });
      });
    } else if (type === 'input') {
      element.addEventListener('keydown', (event) => {
        if (this.mode !== 'run') return;
        if (event.key !== 'Enter') return;
        const input = event.target;
        const value = input.value;
        this._emitAction('input', widget, { value });
        input.value = '';
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
    this._renderWidget(widget);
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

  loadWidgets(widgets = []) {
    this.clear();
    widgets.forEach((cfg) => {
      if (!cfg || !cfg.type) return;
      this.addWidget(cfg);
    });
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
    ids.forEach((id) => {
      const widget = this.widgets.get(id);
      if (!widget) return;
      const didChange = this._applyRx(widget, payload);
      if (didChange) {
        changed.push(widget);
        this._renderWidget(widget);
      }
      results.push({ widget, changed: didChange });
    });
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
      this._renderWidget(target);
      return;
    }
    if (action.type === 'widget_state') {
      const target = this.findWidgetByLabel(action.target) || this.widgets.get(action.target);
      if (!target) return;
      target.runtime = target.runtime || {};
      Object.assign(target.runtime, action.state || {});
      this._renderWidget(target);
    }
  }
}
