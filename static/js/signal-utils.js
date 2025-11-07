/**
 * Shared helpers for rendering and interacting with DBC signal rows.
 */

const parseMaybeInt = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  try {
    const parsed = parseInt(String(value), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
};

const parseMaybeFloat = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
};

const trimZeros = (str) => str.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');

const formatPhysicalValue = (value, allowFloat = true) => {
  if (value === null || value === undefined) return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (!allowFloat) return String(Math.round(num));
  const fixed = num.toFixed(6);
  return trimZeros(fixed);
};

const formatHexValue = (value, bitLength = null) => {
  if (value === null || value === undefined) return '';
  let num = Number(value);
  if (!Number.isFinite(num)) return '';
  num = Math.max(0, Math.floor(num));
  if (bitLength && bitLength > 0) {
    const width = Math.ceil(bitLength / 4);
    return `0x${num.toString(16).toUpperCase().padStart(width, '0')}`;
  }
  return `0x${num.toString(16).toUpperCase()}`;
};

const parseHex = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const negative = raw.startsWith('-');
  const token = negative ? raw.slice(1) : raw;
  const prefixed = token.toLowerCase().startsWith('0x') ? token : `0x${token}`;
  const parsed = Number.parseInt(prefixed, 16);
  if (Number.isNaN(parsed)) return null;
  return negative ? -parsed : parsed;
};

const clamp = (value, min, max) => {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  let out = value;
  if (min !== null && min !== undefined && Number.isFinite(min) && out < min) {
    out = min;
  }
  if (max !== null && max !== undefined && Number.isFinite(max) && out > max) {
    out = max;
  }
  return out;
};

const wrapRaw = (value, min, max) => {
  if (min === null || min === undefined || max === null || max === undefined) {
    return clamp(value, min, max);
  }
  const range = max - min + 1;
  if (!Number.isFinite(range) || range <= 0) return clamp(value, min, max);
  let result = value - min;
  result = ((result % range) + range) % range;
  return result + min;
};

const getSignalConfig = (row) => {
  const dataset = row.dataset || {};
  const bitLength = parseMaybeInt(dataset.bitLength);
  const isSigned = dataset.isSigned === '1';
  const scale = parseMaybeFloat(dataset.scale, 1);
  const offset = parseMaybeFloat(dataset.offset, 0);
  const isFloat = dataset.isFloat === '1';
  const allowFloat =
    isFloat ||
    (typeof scale === 'number' && !Number.isNaN(scale) && !Number.isInteger(scale)) ||
    (typeof offset === 'number' && !Number.isNaN(offset) && !Number.isInteger(offset));
  return {
    name: dataset.signal || '',
    scale,
    offset,
    isFloat,
    allowFloat,
    bitLength,
    isSigned,
    rawMin: parseMaybeInt(dataset.rawMin),
    rawMax: parseMaybeInt(dataset.rawMax),
    rawSignedMin: parseMaybeInt(dataset.rawSignedMin),
    rawSignedMax: parseMaybeInt(dataset.rawSignedMax),
    physicalMin: parseMaybeFloat(dataset.physicalMin),
    physicalMax: parseMaybeFloat(dataset.physicalMax),
  };
};

const toUnsigned = (rawSigned, cfg) => {
  if (rawSigned === null || rawSigned === undefined) return null;
  if (cfg.bitLength === null || cfg.bitLength <= 0) return Math.round(rawSigned);
  const modulus = 2 ** cfg.bitLength;
  let value = Math.round(rawSigned);
  value %= modulus;
  if (value < 0) value += modulus;
  return value;
};

const toSigned = (rawUnsigned, cfg) => {
  if (rawUnsigned === null || rawUnsigned === undefined) return null;
  if (cfg.bitLength === null || cfg.bitLength <= 0 || !cfg.isSigned) {
    return Math.round(rawUnsigned);
  }
  const modulus = 2 ** cfg.bitLength;
  const half = modulus / 2;
  let value = Math.round(rawUnsigned) % modulus;
  if (value < 0) value += modulus;
  if (value >= half) {
    return value - modulus;
  }
  return value;
};

const rawToPhysical = (rawUnsigned, cfg) => {
  if (rawUnsigned === null || rawUnsigned === undefined) return null;
  const signed = toSigned(rawUnsigned, cfg);
  return signed * cfg.scale + cfg.offset;
};

const physicalToRaw = (physicalValue, cfg) => {
  if (physicalValue === null || physicalValue === undefined) return null;
  const scale = cfg.scale === 0 ? 0 : cfg.scale;
  let rawSigned;
  if (scale === 0) {
    rawSigned = physicalValue;
  } else {
    rawSigned = (physicalValue - cfg.offset) / scale;
  }
  rawSigned = Math.round(rawSigned);
  if (cfg.rawSignedMin !== null && cfg.rawSignedMin !== undefined) {
    rawSigned = Math.max(cfg.rawSignedMin, rawSigned);
  }
  if (cfg.rawSignedMax !== null && cfg.rawSignedMax !== undefined) {
    rawSigned = Math.min(cfg.rawSignedMax, rawSigned);
  }
  return toUnsigned(rawSigned, cfg);
};

const setRawValue = (row, rawUnsigned) => {
  const cfg = getSignalConfig(row);
  const rawInput = row.querySelector('.sig-raw');
  const physInput = row.querySelector('.sig-physical');
  if (!rawInput || !physInput) return;
  let value = rawUnsigned;
  if (value === null || value === undefined) {
    value = cfg.rawMin ?? 0;
  }
  if (cfg.rawMin !== null && cfg.rawMin !== undefined) {
    value = Math.max(cfg.rawMin, value);
  }
  if (cfg.rawMax !== null && cfg.rawMax !== undefined) {
    value = Math.min(cfg.rawMax, value);
  }
  value = Math.round(value);
  const physical = rawToPhysical(value, cfg);
  rawInput.value = formatHexValue(value, cfg.bitLength);
  physInput.value = formatPhysicalValue(physical, cfg.allowFloat);
};

const setPhysicalValue = (row, physicalValue) => {
  const cfg = getSignalConfig(row);
  const physInput = row.querySelector('.sig-physical');
  const rawInput = row.querySelector('.sig-raw');
  if (!physInput || !rawInput) return;
  let value = physicalValue;
  if (value === null || value === undefined || Number.isNaN(value)) {
    value = cfg.physicalMin ?? cfg.physicalMax ?? 0;
  }
  value = clamp(value, cfg.physicalMin, cfg.physicalMax);
  const rawUnsigned = physicalToRaw(value, cfg);
  if (rawUnsigned === null || rawUnsigned === undefined) {
    physInput.value = formatPhysicalValue(value, cfg.allowFloat);
    rawInput.value = '';
    return;
  }
  const quantizedPhysical = rawToPhysical(rawUnsigned, cfg);
  rawInput.value = formatHexValue(rawUnsigned, cfg.bitLength);
  physInput.value = formatPhysicalValue(quantizedPhysical, cfg.allowFloat);
};

const handleRawChange = (row) => {
  const rawInput = row.querySelector('.sig-raw');
  if (!rawInput) return;
  const cfg = getSignalConfig(row);
  let rawValue = parseHex(rawInput.value);
  if (rawValue === null) {
    rawValue = cfg.rawMin ?? 0;
  }
  if (cfg.rawMin !== null && cfg.rawMin !== undefined) {
    rawValue = Math.max(cfg.rawMin, rawValue);
  }
  if (cfg.rawMax !== null && cfg.rawMax !== undefined) {
    rawValue = Math.min(cfg.rawMax, rawValue);
  }
  setRawValue(row, rawValue);
};

const handlePhysicalChange = (row) => {
  const physInput = row.querySelector('.sig-physical');
  if (!physInput) return;
  const value = parseMaybeFloat(physInput.value);
  if (value === null) {
    setPhysicalValue(row, null);
    return;
  }
  setPhysicalValue(row, value);
};

const handleStepChange = (row) => {
  const stepInput = row.querySelector('.sig-step');
  if (!stepInput) return;
  const cfg = getSignalConfig(row);
  let step = parseHex(stepInput.value);
  if (step === null || step <= 0) {
    step = 1;
  }
  const maxRange = cfg.rawMax !== null && cfg.rawMax !== undefined && cfg.rawMin !== null && cfg.rawMin !== undefined
    ? cfg.rawMax - cfg.rawMin + 1
    : null;
  if (maxRange && step > maxRange) {
    step = maxRange;
  }
  stepInput.value = formatHexValue(step, cfg.bitLength);
};

const adjustByStep = (row, direction) => {
  const rawInput = row.querySelector('.sig-raw');
  const stepInput = row.querySelector('.sig-step');
  if (!rawInput || !stepInput) return;
  const cfg = getSignalConfig(row);
  let current = parseHex(rawInput.value);
  if (current === null) {
    current = cfg.rawMin ?? 0;
  }
  current = clamp(current, cfg.rawMin, cfg.rawMax);
  let step = parseHex(stepInput.value);
  if (step === null || step <= 0) {
    step = 1;
  }
  stepInput.value = formatHexValue(step, cfg.bitLength);
  const min = cfg.rawMin ?? 0;
  const max = cfg.rawMax ?? (min + (cfg.bitLength ? 2 ** cfg.bitLength - 1 : 0));
  const next = wrapRaw(current + direction * step, min, max);
  setRawValue(row, next);
};

export const gatherSignalValues = (container) => {
  const signals = {};
  container.querySelectorAll('.signal-row').forEach((row) => {
    const name = row.dataset.signal;
    if (!name) return;
    const rawInput = row.querySelector('.sig-raw');
    const physInput = row.querySelector('.sig-physical');
    if (!rawInput || !physInput) return;
    const rawVal = rawInput.value.trim();
    const physVal = physInput.value.trim();
    if (!rawVal && !physVal) return;

    if (rawVal) {
      handleRawChange(row);
    } else if (physVal) {
      handlePhysicalChange(row);
    }

    const sanitizedRaw = rawInput.value.trim();
    const sanitizedPhys = physInput.value.trim();
    if (!sanitizedRaw && !sanitizedPhys) return;

    signals[name] = {
      raw: sanitizedRaw || null,
      physical: sanitizedPhys || null,
    };
  });
  return signals;
};

export const applySignalUpdates = (container, applied = {}) => {
  if (!container) return;
  container.querySelectorAll('.signal-row').forEach((row) => {
    const name = row.dataset.signal;
    if (!name || !Object.prototype.hasOwnProperty.call(applied, name)) return;
    const info = applied[name] || {};
    if (info.raw_unsigned !== undefined && info.raw_unsigned !== null) {
      setRawValue(row, parseMaybeInt(info.raw_unsigned, null));
      return;
    }
    if (info.raw !== undefined && info.raw !== null) {
      const parsed = parseMaybeInt(info.raw, null);
      if (parsed !== null && parsed !== undefined) {
        setRawValue(row, parsed);
        return;
      }
      const fromHex = parseHex(info.raw);
      if (fromHex !== null && fromHex !== undefined) {
        setRawValue(row, fromHex);
        return;
      }
    }
    if (info.raw_hex) {
      const parsed = parseHex(info.raw_hex);
      if (parsed !== null && parsed !== undefined) {
        setRawValue(row, parsed);
        return;
      }
    }
    if (info.physical !== undefined && info.physical !== null) {
      setPhysicalValue(row, parseMaybeFloat(info.physical));
    }
  });
};

const createMetaRow = (signal, cfg) => {
  const meta = document.createElement('div');
  meta.className = 'signal-meta';
  const pieces = [];
  if (cfg.rawMin !== null && cfg.rawMin !== undefined && cfg.rawMax !== null && cfg.rawMax !== undefined) {
    pieces.push(`Raw ${formatHexValue(cfg.rawMin, cfg.bitLength)} → ${formatHexValue(cfg.rawMax, cfg.bitLength)}`);
  }
  if (cfg.physicalMin !== null && cfg.physicalMin !== undefined && cfg.physicalMax !== null && cfg.physicalMax !== undefined) {
    pieces.push(`Phys ${formatPhysicalValue(cfg.physicalMin, true)} → ${formatPhysicalValue(cfg.physicalMax, true)}`);
  }
  if (signal.scale !== undefined && signal.scale !== null) {
    pieces.push(`Scale ${signal.scale}`);
  }
  if (signal.offset !== undefined && signal.offset !== null) {
    pieces.push(`Offset ${signal.offset}`);
  }
  meta.textContent = pieces.join(' | ');
  return meta;
};

export const createSignalRow = (signal, { variant } = {}) => {
  const row = document.createElement('div');
  row.classList.add('signal-row');
  if (variant) {
    row.classList.add(`${variant}-signal`);
  }
  row.dataset.signal = signal.name || '';
  row.dataset.scale = signal.scale ?? 1;
  row.dataset.offset = signal.offset ?? 0;
  row.dataset.isFloat = signal.is_float ? '1' : '0';
  row.dataset.bitLength = signal.bit_length ?? '';
  row.dataset.isSigned = signal.is_signed ? '1' : '0';
  row.dataset.rawMin = signal.raw_min ?? '';
  row.dataset.rawMax = signal.raw_max ?? '';
  row.dataset.rawSignedMin = signal.raw_signed_min ?? '';
  row.dataset.rawSignedMax = signal.raw_signed_max ?? '';
  row.dataset.physicalMin = signal.minimum ?? '';
  row.dataset.physicalMax = signal.maximum ?? '';

  const header = document.createElement('div');
  header.className = 'signal-header';
  const name = document.createElement('span');
  name.className = 'signal-name';
  name.textContent = signal.unit ? `${signal.name} (${signal.unit})` : signal.name;
  header.appendChild(name);
  row.appendChild(header);

  const inputs = document.createElement('div');
  inputs.className = 'signal-inputs';

  const rawField = document.createElement('div');
  rawField.className = 'signal-field signal-raw-field';
  const rawLabel = document.createElement('label');
  rawLabel.textContent = 'Raw';
  const rawInput = document.createElement('input');
  rawInput.type = 'text';
  rawInput.className = 'sig-raw';
  rawLabel.appendChild(rawInput);
  rawField.appendChild(rawLabel);

  const stepField = document.createElement('div');
  stepField.className = 'signal-step-group';
  const stepLabel = document.createElement('label');
  stepLabel.textContent = 'Step';
  const stepInput = document.createElement('input');
  stepInput.type = 'text';
  stepInput.className = 'sig-step';
  stepInput.value = formatHexValue(1, parseMaybeInt(signal.bit_length));
  stepLabel.appendChild(stepInput);
  stepField.appendChild(stepLabel);
  const buttons = document.createElement('div');
  buttons.className = 'sig-step-buttons';
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'sig-step-up';
  upBtn.textContent = '▲';
  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'sig-step-down';
  downBtn.textContent = '▼';
  buttons.appendChild(upBtn);
  buttons.appendChild(downBtn);
  stepField.appendChild(buttons);
  rawField.appendChild(stepField);

  const physField = document.createElement('div');
  physField.className = 'signal-field signal-phys-field';
  const physLabel = document.createElement('label');
  physLabel.textContent = signal.unit ? `Physical (${signal.unit})` : 'Physical';
  const physInput = document.createElement('input');
  physInput.type = 'text';
  physInput.className = 'sig-physical';
  physLabel.appendChild(physInput);
  physField.appendChild(physLabel);

  inputs.appendChild(rawField);
  inputs.appendChild(physField);
  row.appendChild(inputs);

  const cfg = getSignalConfig(row);
  row.appendChild(createMetaRow(signal, cfg));

  if (signal.choices && Object.keys(signal.choices).length) {
    const choices = document.createElement('div');
    choices.className = 'signal-meta';
    const mapped = Object.entries(signal.choices).map(([k, v]) => `${k}: ${v}`);
    choices.textContent = `Choices: ${mapped.join(', ')}`;
    row.appendChild(choices);
  }

  const initialRaw = parseMaybeInt(signal.raw_unsigned, null);
  const initialPhysical = parseMaybeFloat(signal.physical, null);
  if (initialRaw !== null) {
    setRawValue(row, initialRaw);
  } else if (initialPhysical !== null) {
    setPhysicalValue(row, initialPhysical);
  } else {
    setRawValue(row, cfg.rawMin ?? 0);
  }

  rawInput.addEventListener('change', () => handleRawChange(row));
  rawInput.addEventListener('blur', () => handleRawChange(row));
  physInput.addEventListener('change', () => handlePhysicalChange(row));
  physInput.addEventListener('blur', () => handlePhysicalChange(row));
  stepInput.addEventListener('change', () => handleStepChange(row));
  stepInput.addEventListener('blur', () => handleStepChange(row));
  upBtn.addEventListener('click', (evt) => {
    evt.preventDefault();
    adjustByStep(row, 1);
  });
  downBtn.addEventListener('click', (evt) => {
    evt.preventDefault();
    adjustByStep(row, -1);
  });

  return row;
};
