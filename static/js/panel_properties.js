import { getWidgetDefinition } from './panel_widgets.js';

const createElement = (tag, className, textContent) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
};

const hasScriptField = (sections = []) =>
  sections.some((section) => section.fields?.some((field) => field.path === 'script'));

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
  constructor(container, { onChange, onRemoveWidget, fetchMessageInfo } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.onRemoveWidget = onRemoveWidget;
    this.fetchMessageInfo = fetchMessageInfo;
    this.widget = null;
    this.enumBindings = [];
    this.signalChoices = {};
    this.statusEl = null;
    this.signalDatalistId = 'panel-signal-options';
    this.customRenderers = new Map();
    this.behaviorScriptCache = new Map();
  }

  registerCustomRenderer(type, renderer) {
    if (!type || typeof renderer !== 'function') return;
    this.customRenderers.set(type, renderer);
  }

  clear() {
    this.widget = null;
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  setWidget(widget) {
    this.widget = widget;
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

    if (definition.supportsScript) {
      const behaviorCard = this._renderBehaviorButtons();
      if (behaviorCard) {
        ribbonRow.appendChild(behaviorCard);
      }
    }

    ribbonRow.appendChild(this._renderLayoutCard());

    const sections = [...(definition.propertySections || [])];
    if (definition.supportsScript && !hasScriptField(sections)) {
      sections.push({
        title: 'Script',
        fields: [{ label: 'Script', path: 'script', type: 'textarea', rows: 6 }],
      });
    }

    const mappingFields = [];
    const valueFields = [];
    const miscFields = [];
    let scriptField = null;

    sections.forEach((section) => {
      section.fields?.forEach((field) => {
        if (field.path === 'script') {
          scriptField = field;
          return;
        }
        if (field.path === 'mapping.message' || field.path === 'mapping.signal') {
          mappingFields.push(field);
          return;
        }
        if ((field.path || '').startsWith('mapping.') || (field.type || '').startsWith('image')) {
          valueFields.push(field);
          return;
        }
        miscFields.push(field);
      });
    });

    const mappingCard = this._createRibbonCard('Mapping MSG / SIGNAL');
    mappingFields.forEach((field) => mappingCard.appendChild(this._createField(field)));
    ribbonRow.appendChild(mappingCard);

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

    const scriptCard = this._renderScriptSection(scriptField);
    if (scriptCard) {
      ribbonRow.appendChild(scriptCard);
    }

    const actionsCard = this._renderActions();
    if (actionsCard) {
      ribbonRow.appendChild(actionsCard);
    }

    const renderer = this.customRenderers.get(this.widget.type);
    if (renderer) {
      try {
        renderer({ form: rendererTarget, widget: this.widget, definition });
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

  _renderLayoutCard() {
    const card = this._createRibbonCard('Layout');
    const fields = [
      { label: 'Column (X)', path: 'pos.x', value: this.widget.pos?.x ?? 1 },
      { label: 'Row (Y)', path: 'pos.y', value: this.widget.pos?.y ?? 1 },
      { label: 'Width (columns)', path: 'size.w', value: this.widget.size?.w ?? 1 },
      { label: 'Height (rows)', path: 'size.h', value: this.widget.size?.h ?? 1 },
    ];
    fields.forEach((field) => {
      const wrapper = createElement('div', 'panel-field');
      const label = createElement('label', null, field.label);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.value = field.value;
      input.addEventListener('change', () => {
        const numeric = Number(input.value);
        this._emitChange(field.path, Number.isFinite(numeric) ? numeric : 1);
      });
      wrapper.append(label, input);
      card.appendChild(wrapper);
    });
    return card;
  }

  _renderSection(form, section) {
    if (!section.fields || !section.fields.length) return;
    const title = createElement('div', 'panel-section-title', section.title || 'Section');
    form.appendChild(title);
    section.fields.forEach((field) => {
      const fieldEl = this._createField(field);
      form.appendChild(fieldEl);
    });
  }

  _renderActions() {
    return null;
  }

  _renderBehaviorButtons() {
    if (!this.widget) return null;
    const card = this._createRibbonCard('Default / Script Mode');
    const row = createElement('div', 'panel-mode-toggle');

    const createModeButton = (label, className, useScript) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `panel-ribbon-button panel-mode-option ${className}`;
      const icon = createElement('span', `panel-ribbon-icon ${useScript ? 'panel-icon-script' : 'panel-icon-default'}`);
      const caption = createElement('span', 'panel-ribbon-label', label);
      const buttonBlock = createElement('div', 'panel-ribbon-button-block');
      btn.append(icon);
      buttonBlock.append(btn, caption);
      btn.addEventListener('click', () => {
        this.widget.useScript = useScript;
        if (useScript && (!this.widget.script || !this.widget.script.trim())) {
          const template = this._buildBehaviorScript(this.widget);
          this.widget.script = template;
          this._emitChange('script', template);
        }
        this._emitChange('useScript', useScript);
        this._render();
      });
      return { block: buttonBlock, button: btn };
    };

    const defaultBtn = createModeButton('Default', 'panel-mode-default', false);
    const scriptBtn = createModeButton('Custom Script', 'panel-mode-custom', true);

    const syncMode = () => {
      const useScript = Boolean(this.widget?.useScript);
      defaultBtn.button.classList.toggle('is-active', !useScript);
      scriptBtn.button.classList.toggle('is-active', useScript);
      scriptBtn.button.disabled = false;
      defaultBtn.button.disabled = false;
    };

    syncMode();
    row.append(defaultBtn.block, scriptBtn.block);
    card.appendChild(row);
    return card;
  }

  _renderScriptSection(field) {
    if (!field) return null;
    const card = this._createRibbonCard('Script Editor', 'panel-ribbon-card--stretch');
    const fieldEl = this._createField({ ...field, rows: Math.max(field.rows || 8, 6) });
    fieldEl.classList.add('panel-script-field');
    card.appendChild(fieldEl);
    return card;
  }

  _createField(field) {
    const wrapper = createElement('div', 'panel-field');
    const label = createElement('label', null, field.label || field.path);
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
}
