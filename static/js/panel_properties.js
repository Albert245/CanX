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
    this.container.innerHTML = '';
    if (!this.widget) {
      this.container.appendChild(createElement('div', 'panel-properties-empty', 'Select a widget to edit.'));
      return;
    }
    const definition = getWidgetDefinition(this.widget.type) || {};
    const title = createElement('h3', null, `${definition.label || this.widget.type} Properties`);
    this.container.appendChild(title);
    const form = document.createElement('form');
    form.addEventListener('submit', (event) => event.preventDefault());
    this.enumBindings = [];
    this.signalChoices = {};

    this._renderLayoutSection(form);
    const sections = [...(definition.propertySections || [])];
    if (definition.supportsScript && !hasScriptField(sections)) {
      sections.push({
        title: 'Script',
        fields: [{ label: 'Script', path: 'script', type: 'textarea', rows: 6 }],
      });
    }
    sections.forEach((section) => this._renderSection(form, section));

    const renderer = this.customRenderers.get(this.widget.type);
    if (renderer) {
      try {
        renderer({ form, widget: this.widget, definition });
      } catch (err) {
        console.warn('Panel properties renderer error', err);
      }
    }

    this._renderActions(form);
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

  _renderLayoutSection(form) {
    const layoutTitle = createElement('div', 'panel-section-title', 'Layout');
    form.appendChild(layoutTitle);
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
      form.appendChild(wrapper);
    });
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

  _renderActions(form) {
    const actionsRow = createElement('div', 'panel-actions');
    if (typeof this.onRemoveWidget === 'function' && this.widget?.id) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'panel-danger-btn';
      removeBtn.textContent = 'Remove Widget';
      removeBtn.addEventListener('click', () => {
        if (!this.widget?.id) return;
        this.onRemoveWidget(this.widget.id);
      });
      actionsRow.appendChild(removeBtn);
    }
    form.appendChild(actionsRow);
  }

  _createField(field) {
    const wrapper = createElement('div', 'panel-field');
    const label = createElement('label', null, field.label || field.path);
    let input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      if (field.rows) input.rows = field.rows;
      if (field.path === 'images.states') {
        input.value = serializeStatesText(this.widget.images?.states);
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
      valueInput.addEventListener('change', () => this._handleFieldChange(field, valueInput.value));
      this.enumBindings.push({ input: valueInput, select });
      enumWrapper.append(valueInput, select);
      input = enumWrapper;
    } else {
      input.addEventListener('change', () => {
        this._handleFieldChange(field, input.value);
      });
    }

    if (field.type === 'textarea') {
      input.addEventListener('change', () => {
        this._handleFieldChange(field, input.value);
      });
    }

    const targetInput = field.enum ? input.querySelector('input') : input;

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
