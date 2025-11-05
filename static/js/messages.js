/**
 * @fileoverview Handles the Messages tab: DBC loading, message selection, and
 * periodic signal updates.
 */

const $ = (selector, ctx = document) => ctx.querySelector(selector);

export function initMessages({ stimApi } = {}) {
  let currentMessage = null;
  let messages = [];

  const renderMessageList = () => {
    const list = $('#msg-list');
    if (!list) return;
    list.innerHTML = '';
    const query = String($('#msg-search')?.value || '').toLowerCase();
    messages
      .filter((m) => {
        const name = String(m.name || '').toLowerCase();
        const id = String(m.id_hex || '').toLowerCase();
        return name.includes(query) || id.includes(query);
      })
      .forEach((m) => {
        const item = document.createElement('li');
        item.textContent = `${m.name} (${m.id_hex})`;
        item.addEventListener('click', () => selectMessage(m));
        if (currentMessage && currentMessage.name === m.name) {
          item.classList.add('active');
        }
        list.appendChild(item);
      });
  };

  async function selectMessage(message) {
    currentMessage = message;
    const title = $('#msg-title');
    if (title) {
      title.textContent = `${message.name} - ${message.id_hex}`;
    }
    const meta = $('#msg-meta');
    if (meta) {
      meta.textContent = `DLC: ${message.dlc} | Cycle: ${
        message.cycle_time ?? '-'
      } | Extended: ${message.is_extended ? 'yes' : 'no'}`;
    }
    const response = await fetch(`/api/dbc/message/${encodeURIComponent(message.name)}`);
    const json = await response.json().catch(() => ({ ok: false }));
    const form = $('#signals-form');
    if (form) {
      form.innerHTML = '';
      if (json.ok) {
        Object.entries(json.signals || {}).forEach(([signalName, value]) => {
          const wrapper = document.createElement('div');
          wrapper.className = 'sig';
          const label = document.createElement('label');
          label.textContent = signalName;
          const input = document.createElement('input');
          input.type = 'number';
          input.name = signalName;
          input.value = value;
          wrapper.appendChild(label);
          wrapper.appendChild(input);
          form.appendChild(wrapper);
        });
      }
    }
    renderMessageList();
  }

  const initButton = $('#btn-init');
  initButton?.addEventListener('click', async () => {
    const payload = {
      device: $('#device')?.value,
      channel: Number($('#channel')?.value || 0),
      is_fd: !!$('#is_fd')?.checked,
      padding: $('#padding')?.value || '00',
      dbc_path: $('#dbc_path')?.value || null,
    };
    const response = await fetch('/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await response.json().catch(() => ({}));
    const status = $('#init-status');
    if (status) {
      status.textContent = json.ok
        ? `OK - DBC: ${json.dbc_loaded ? 'yes' : 'no'}`
        : json.error || 'ERR';
    }
    if (json.ok && stimApi) {
      stimApi.resetNodes?.();
    }
  });

  const loadDbcButton = $('#btn-load-dbc');
  loadDbcButton?.addEventListener('click', async () => {
    const response = await fetch('/api/dbc/messages');
    const json = await response.json().catch(() => ({ ok: false }));
    if (!json.ok) return;
    messages = json.messages || [];
    renderMessageList();
    if (stimApi) {
      stimApi.resetNodes?.();
      await stimApi.loadNodes?.();
    }
  });

  $('#msg-search')?.addEventListener('input', renderMessageList);

  const startPeriodic = $('#btn-start-periodic');
  startPeriodic?.addEventListener('click', async () => {
    if (!currentMessage) return;
    const payload = {
      message: currentMessage.name,
      period: Number($('#msg-period')?.value || 100),
      duration: Number($('#msg-duration')?.value || 0) || null,
    };
    await fetch('/api/periodic/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  const stopPeriodic = $('#btn-stop-periodic');
  stopPeriodic?.addEventListener('click', async () => {
    if (!currentMessage) return;
    const payload = { message: currentMessage.name };
    await fetch('/api/periodic/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  const updateSignals = $('#btn-update-signals');
  updateSignals?.addEventListener('click', async () => {
    if (!currentMessage) return;
    const form = $('#signals-form');
    if (!form) return;
    const inputs = Array.from(form.querySelectorAll('input'));
    const signals = Object.fromEntries(inputs.map((input) => [input.name, Number(input.value)]));
    const payload = {
      message_name: currentMessage.name,
      signals,
    };
    await fetch('/api/periodic/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  return {};
}
