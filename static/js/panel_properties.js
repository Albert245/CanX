import { getWidgetDefinition } from './panel_widgets.js';
import { createIconDropdown } from './panel_image_widgets.js';

const createElement = (tag, className, textContent) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
};

const serializeStatesText = (states = []) =>
  states
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const value = entry.value ?? '';
      const src = entry.src ?? '';
      if (src === '') return '';
      return `${value}=${src}`;
    })
    .filter(Boolean)
    .join('\n');

const parseStatesText = (text) => {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [valuePart, url] = line.split('=');
      if (!url) return null;
      const numeric = Number(valuePart.trim());
      if (!Number.isFinite(numeric)) return null;
      return { value: numeric, src: url.trim() };
    })
    .filter(Boolean);
};

export class PanelPropertiesPanel {
  constructor(container, { onChange, fetchMessageInfo } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.fetchMessageInfo = fetchMessageInfo;
    this.widget = null;
    this.enumBindings = [];
    this.signalChoices = {};
    this.statusEl = null;
    this.signalDatalistId = 'panel-signal-options';
    this.customRenderers = new Map();
    this.behaviorScriptCache = new Map();
    this.rendererCleanups = [];
    this.messageInput = document.getElementById('panel-map-message');
    this.signalInput = document.getElementById('panel-map-signal');
    this.scriptEditor = document.getElementById('panel-script-editor');
    this.layoutInputs = {
      col: document.getElementById('panel-layout-col'),
      row: document.getElementById('panel-layout-row'),
      width: document.getElementById('panel-layout-width'),
      height: document.getElementById('panel-layout-height'),
    };

    this._handleMessageChange = () => {
      if (!this.widget || !this.messageInput) return;
      const value = this.messageInput.value;
      this._emitChange('mapping.message', value);
      this._loadMessageInfo(value);
    };

    this._handleSignalChange = () => {
      if (!this.widget || !this.signalInput) return;
      const value = this.signalInput.value;
      this._emitChange('mapping.signal', value);
      this._refreshEnumBindings();
    };

    this._handleScriptChange = () => {
      if (!this.widget || !this.scriptEditor) return;
      this._emitChange('script', this.scriptEditor.value);
    };

    this._handleLayoutChange = (path, inputKey) => () => {
      if (!this.widget) return;
      const input = this.layoutInputs[inputKey];
      if (!input) return;
      const numeric = Number(input.value);
      this._emitChange(path, Number.isFinite(numeric) ? numeric : 1);
    };

    this._attachStaticListeners();
  }

  _attachStaticListeners() {
    this.messageInput?.addEventListener('change', this._handleMessageChange);
    this.signalInput?.addEventListener('change', this._handleSignalChange);
    this.scriptEditor?.addEventListener('change', this._handleScriptChange);
    this.layoutInputs.col?.addEventListener('change', this._handleLayoutChange('pos.x', 'col'));
    this.layoutInputs.row?.addEventListener('change', this._handleLayoutChange('pos.y', 'row'));
    this.layoutInputs.width?.addEventListener('change', this._handleLayoutChange('size.w', 'width'));
    this.layoutInputs.height?.addEventListener('change', this._handleLayoutChange('size.h', 'height'));
  }

  registerCustomRenderer(type, renderer) {
    if (!type || typeof renderer !== 'function') return;
    this.customRenderers.set(type, renderer);
  }

  clear() {
    this.widget = null;
    this._syncMappingInputs();
    this._syncLayoutInputs();
    this._syncScriptEditor();
    this._runRendererCleanups();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  setWidget(widget) {
    this.widget = widget;
    this._syncMappingInputs();
    this._syncLayoutInputs();
    this._syncScriptEditor();
    this._render();
    if (widget?.mapping?.message) {
      this._loadMessageInfo(widget.mapping.message);
    } else {
      this.signalChoices = {};
      this._refreshEnumBindings();
    }
  }

  _render() {
    if (!this.container) return;
    this._runRendererCleanups();
    this.container.classList.add('panel-properties');
    this.container.innerHTML = '';
    this.behaviorScriptCache.clear();
    if (!this.widget) {
      this.container.appendChild(createElement('div', 'panel-properties-empty', 'Select a widget to edit.'));
      return;
    }

    const definition = getWidgetDefinition(this.widget.type) || {};
    const title = createElement('h3', 'panel-properties-title', `${definition.label || this.widget.type} Properties`);
    this.container.appendChild(title);

    const form = document.createElement('form');
    form.className = 'panel-properties-form';
    form.addEventListener('submit', (event) => event.preventDefault());
    this.enumBindings = [];
    this.signalChoices = {};

    const ribbonRow = createElement('div', 'panel-ribbon-row');
    form.appendChild(ribbonRow);

    const sections = [...(definition.propertySections || [])];
    const valueFields = [];
    const miscFields = [];
    sections.forEach((section) => {
      section.fields?.forEach((field) => {
        if (field.path === 'mapping.message' || field.path === 'mapping.signal' || field.path === 'script') {
          return;
        }
        if ((field.path || '').startsWith('mapping.') || (field.type || '').startsWith('image')) {
          valueFields.push(field);
          return;
        }
        miscFields.push(field);
      });
    });

    const mappingValueCard = this._createRibbonCard('Mapping Value / Image States', 'panel-ribbon-card--stretch');
    valueFields.forEach((field) => mappingValueCard.appendChild(this._createField(field)));
    if (miscFields.length) {
      const miscLabel = createElement('div', 'panel-ribbon-group-title', 'Widget Details');
      mappingValueCard.appendChild(miscLabel);
      miscFields.forEach((field) => mappingValueCard.appendChild(this._createField(field)));
    }
    ribbonRow.appendChild(mappingValueCard);

    const rendererTarget = createElement('div', 'panel-custom-renderer');
    mappingValueCard.appendChild(rendererTarget);

    const renderer = this.customRenderers.get(this.widget.type);
    if (renderer) {
      try {
        renderer({
          form: rendererTarget,
          widget: this.widget,
          definition,
          registerCleanup: (fn) => {
            if (typeof fn === 'function') {
              this.rendererCleanups.push(fn);
            }
          },
        });
      } catch (err) {
        console.warn('Panel properties renderer error', err);
      }
    }

    this.statusEl = createElement('div', 'panel-properties-status');
    form.appendChild(this.statusEl);
    this.container.appendChild(form);
    this._ensureSignalDatalist();
  }

  _ensureSignalDatalist() {
    if (!this.container) return;
    let datalist = document.getElementById(this.signalDatalistId);
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = this.signalDatalistId;
      document.body.appendChild(datalist);
    }
  }

  _createRibbonCard(title, extraClass) {
    const card = createElement('div', 'panel-ribbon-card');
    if (extraClass) {
      card.classList.add(extraClass);
    }
    if (title) {
      card.appendChild(createElement('div', 'panel-ribbon-group-title', title));
    }
    return card;
  }

  _syncMappingInputs() {
    if (!this.messageInput || !this.signalInput) return;
    const mapping = this.widget?.mapping || {};
    this.messageInput.value = mapping.message || '';
    this.signalInput.value = mapping.signal || '';
    const disabled = !this.widget;
    this.messageInput.disabled = disabled;
    this.signalInput.disabled = disabled;
  }

  _syncScriptEditor() {
    if (!this.scriptEditor) return;
    if (this.widget) {
      this.scriptEditor.disabled = false;
      this.scriptEditor.value = this.widget.script || '';
    } else {
      this.scriptEditor.disabled = true;
      this.scriptEditor.value = '';
    }
  }

  _syncLayoutInputs() {
    const defaults = { col: '', row: '', width: '', height: '' };
    const values = this.widget
      ? {
          col: this.widget.pos?.x ?? '',
          row: this.widget.pos?.y ?? '',
          width: this.widget.size?.w ?? '',
          height: this.widget.size?.h ?? '',
        }
      : defaults;
    const disabled = !this.widget;
    Object.entries(this.layoutInputs).forEach(([key, input]) => {
      if (!input) return;
      input.disabled = disabled;
      input.value = values[key] ?? '';
    });
  }

  _renderActions() {
    return null;
  }

  _createField(field) {
    const wrapper = createElement('div', 'panel-field');
    const label = createElement('label', null, field.label || field.path);
    const imageFieldTypes = ['imagepicker', 'imagebutton', 'imagetoggle', 'imageindicator'];
    if (imageFieldTypes.includes((field.type || '').toLowerCase())) {
      const dropdownHost = document.createElement('div');
      const dropdown = createIconDropdown(dropdownHost, {
        value: this._getValue(field.path),
        onChange: (src) => this._handleFieldChange(field, src || ''),
      });
      if (dropdown && typeof dropdown.destroy === 'function') {
        this.rendererCleanups.push(() => dropdown.destroy());
      }
      wrapper.append(label, dropdownHost);
      return wrapper;
    }
    let input;
    const useScript = Boolean(this.widget?.useScript);
    const isScriptField = field.path === 'script';
    const isMappingField = (field.path || '').startsWith('mapping.');
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      if (field.rows) input.rows = field.rows;
      if (field.path === 'images.states') {
        input.value = serializeStatesText(this.widget.images?.states);
      } else if (isScriptField && !useScript) {
        input.value = this._buildBehaviorScript(this.widget);
      } else {
        input.value = this._getValue(field.path) ?? '';
      }
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      const value = this._getValue(field.path);
      input.value = value ?? '';
      if (field.autocomplete === 'signal') {
        input.setAttribute('list', this.signalDatalistId);
      }
      if (field.placeholder) {
        input.placeholder = field.placeholder;
      }
    }
    if (field.enum) {
      const enumWrapper = createElement('div', 'panel-enum-control');
      const select = document.createElement('select');
      select.innerHTML = '';
      const valueInput = input;
      select.addEventListener('change', () => {
        if (select.value === '__raw__') return;
        valueInput.value = select.value;
        valueInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      if (!(isScriptField && !useScript)) {
        valueInput.addEventListener('change', () => this._handleFieldChange(field, valueInput.value));
      }
      this.enumBindings.push({ input: valueInput, select });
      enumWrapper.append(valueInput, select);
      input = enumWrapper;
    } else {
      if (!(isScriptField && !useScript)) {
        input.addEventListener('change', () => {
          this._handleFieldChange(field, input.value);
        });
      }
    }

    if (field.type === 'textarea') {
      if (!(isScriptField && !useScript)) {
        input.addEventListener('change', () => {
          this._handleFieldChange(field, input.value);
        });
      }
    }

    const targetInput = field.enum ? input.querySelector('input') : input;

    if (isScriptField && !useScript && targetInput) {
      targetInput.readOnly = true;
      targetInput.classList.add('is-readonly');
    }

    if (isScriptField && targetInput) {
      targetInput.classList.add('panel-script-input');
      const autosize = () => {
        targetInput.style.height = 'auto';
        targetInput.style.height = `${Math.max(targetInput.scrollHeight, 120)}px`;
      };
      autosize();
      targetInput.addEventListener('input', autosize);
    }

    if (isMappingField && useScript && targetInput) {
      targetInput.disabled = true;
      const selectEl = field.enum ? input.querySelector('select') : null;
      if (selectEl) {
        selectEl.disabled = true;
      }
    }

    if (field.path === 'mapping.message' && targetInput) {
      const blurHandler = () => {
        const messageName = targetInput.value?.trim();
        if (messageName) {
          this._loadMessageInfo(messageName);
        }
      };
      targetInput.addEventListener('blur', blurHandler);
    }

    if (field.path === 'mapping.signal' && targetInput) {
      targetInput.addEventListener('change', () => {
        this._refreshEnumBindings();
        this._handleFieldChange(field, targetInput.value);
      });
    }

    wrapper.append(label, input);
    return wrapper;
  }

  async _loadMessageInfo(messageName) {
    if (!this.fetchMessageInfo || !messageName) return;
    try {
      const info = await this.fetchMessageInfo(messageName);
      if (info?.signals) {
        this._updateSignalOptions(info.signals);
        this._setStatus(`Loaded ${info.signals.length} signals from ${info.name || messageName}.`, 'info');
        this.signalChoices = info.signals.reduce((acc, signal) => {
          acc[signal.name] = signal.choices || {};
          return acc;
        }, {});
        this._refreshEnumBindings();
      }
    } catch (err) {
      this._setStatus(err?.message || 'Unable to load signal metadata.', 'error');
    }
  }

  _updateSignalOptions(signals = []) {
    const datalist = document.getElementById(this.signalDatalistId);
    if (!datalist) return;
    datalist.innerHTML = '';
    signals.forEach((signal) => {
      const option = document.createElement('option');
      option.value = signal.name;
      datalist.appendChild(option);
    });
  }

  _handleFieldChange(field, value) {
    if (field.formatter === 'statePairs') {
      const parsed = parseStatesText(value);
      this._emitChange(field.path, parsed);
      return;
    }
    if (field.type === 'number') {
      const numeric = Number(value);
      this._emitChange(field.path, Number.isFinite(numeric) ? numeric : 0);
      return;
    }
    this._emitChange(field.path, value);
  }

  _getValue(path) {
    if (!path || !this.widget) return '';
    const parts = path.split('.');
    let ref = this.widget;
    for (const part of parts) {
      if (!ref || typeof ref !== 'object') return '';
      ref = ref[part];
    }
    return ref ?? '';
  }

  _buildBehaviorScript(widget) {
    if (!widget) return '';
    const cached = this.behaviorScriptCache.get(widget.id);
    if (cached) return cached;
    const mapping = widget.mapping || {};
    const message = mapping.message || 'MESSAGE';
    const signal = mapping.signal || 'Signal';
    const scriptLines = [];
    const numericOr = (val, fallback) => (Number.isFinite(Number(val)) ? Number(val) : fallback);
    const sendLine = (value) => `  send("${message}", "${signal}", ${value});`;
    switch (widget.type) {
      case 'button':
      case 'image_button':
        scriptLines.push('on press {');
        scriptLines.push(sendLine(numericOr(mapping.pressValue, 1)));
        scriptLines.push('}');
        scriptLines.push('on release {');
        scriptLines.push(sendLine(numericOr(mapping.releaseValue, 0)));
        scriptLines.push('}');
        break;
      case 'toggle':
      case 'image_toggle':
        scriptLines.push('on toggle {');
        scriptLines.push('  // cycles through available states');
        scriptLines.push(sendLine('state.value'));
        scriptLines.push('}');
        break;
      case 'input':
        scriptLines.push('on input {');
        scriptLines.push(sendLine('state.value'));
        scriptLines.push('}');
        break;
      case 'lamp':
        scriptLines.push(`on rx value == ${numericOr(mapping.onValue, 1)} {`);
        scriptLines.push(`  lamp("${widget.label || 'Lamp'}").on();`);
        scriptLines.push('}');
        scriptLines.push(`on rx value != ${numericOr(mapping.onValue, 1)} {`);
        scriptLines.push(`  lamp("${widget.label || 'Lamp'}").off();`);
        scriptLines.push('}');
        break;
      case 'progress':
        scriptLines.push('on rx {');
        scriptLines.push('  // display only – no transmit');
        scriptLines.push('}');
        break;
      case 'label':
        scriptLines.push('on rx {');
        scriptLines.push('  // display incoming value');
        scriptLines.push('}');
        break;
      case 'image_indicator':
      case 'image_switch':
        scriptLines.push('on rx {');
        scriptLines.push('  // updates image based on incoming value');
        scriptLines.push('}');
        break;
      default:
        scriptLines.push('on press {');
        scriptLines.push('  // add custom logic here');
        scriptLines.push('}');
        break;
    }
    const result = scriptLines.join('\n');
    this.behaviorScriptCache.set(widget.id, result);
    return result;
  }

  buildBehaviorScript(widget) {
    return this._buildBehaviorScript(widget);
  }

  _emitChange(path, value) {
    if (typeof this.onChange === 'function' && this.widget) {
      this.onChange(this.widget.id, path, value);
    }
  }

  _setStatus(message, tone) {
    if (!this.statusEl) return;
    this.statusEl.textContent = message || '';
    this.statusEl.dataset.tone = tone || '';
  }

  _refreshEnumBindings() {
    const signalName = this.widget?.mapping?.signal;
    const choices = signalName ? this.signalChoices[signalName] || {} : {};
    const sortedChoices = Object.entries(choices)
      .map(([key, label]) => ({ value: Number(key), label }))
      .filter((entry) => Number.isFinite(entry.value))
      .sort((a, b) => a.value - b.value);
    this.enumBindings.forEach(({ input, select }) => {
      select.innerHTML = '';
      const rawOption = document.createElement('option');
      rawOption.value = '__raw__';
      rawOption.textContent = 'Raw value';
      select.appendChild(rawOption);
      sortedChoices.forEach((entry) => {
        const option = document.createElement('option');
        option.value = String(entry.value);
        option.textContent = `${entry.value} → ${entry.label}`;
        select.appendChild(option);
      });
      const inputValue = Number(input.value);
      if (Number.isFinite(inputValue) && sortedChoices.some((entry) => entry.value === inputValue)) {
        select.value = String(inputValue);
      } else {
        select.value = '__raw__';
      }
    });
  }

  _runRendererCleanups() {
    if (!this.rendererCleanups?.length) return;
    this.rendererCleanups.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.warn('Renderer cleanup error', err);
      }
    });
    this.rendererCleanups = [];
  }
}
