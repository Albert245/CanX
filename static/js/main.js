/**
 * @fileoverview Entry point for the CanX web UI. Sets up the shared Socket.IO
 * connection, coordinates tab navigation, and bootstraps feature modules.
 */
import { initLog } from './log.js';
import { initTrace } from './trace.js';
import { initMessages } from './messages.js';
import { initStim } from './stim.js';
import { initDiag } from './diag.js';
import { initGraphic } from './graphic/index.js';
import { initBusloadMonitor } from './busload.js';
import { initProfileManager } from './profile.js';

const $ = (selector, ctx = document) => ctx.querySelector(selector);
const $$ = (selector, ctx = document) => Array.from(ctx.querySelectorAll(selector));

const SOCKET_SOURCES = ['/socket.io/socket.io.js', 'https://cdn.socket.io/4.7.5/socket.io.min.js'];

const setSocketStatus = (message, tone = 'info') => {
  const el = $('#socket-status');
  if (!el) return;
  el.textContent = message || '—';
  if (tone) {
    el.dataset.tone = tone;
  } else {
    el.removeAttribute('data-tone');
  }
};

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    if (!src.startsWith('/')) {
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
    }
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error(`Failed to load script: ${src}`)),
      { once: true },
    );
    (document.head || document.documentElement).appendChild(script);
  });

const ensureSocketIo = async () => {
  if (window.io) return window.io;
  for (const src of SOCKET_SOURCES) {
    try {
      await loadScript(src);
    } catch (err) {
      console.warn(err);
      continue;
    }
    if (window.io) {
      return window.io;
    }
  }
  return null;
};

const equalizeSettingsCardHeights = () => {
  const cards = $$('.settings-card');
  if (!cards.length) return;

  cards.forEach((card) => {
    card.style.minHeight = '';
  });

  const maxHeight = Math.max(
    ...cards.map((card) => Math.ceil(card.getBoundingClientRect().height)),
  );

  cards.forEach((card) => {
    card.style.minHeight = `${maxHeight}px`;
  });
};

const createSocketStub = () => {
  const warned = new Set();
  const warn = (method) => {
    if (warned.has(method)) return;
    console.warn(
      `Socket.IO unavailable: ${method}() calls will be ignored until the client library is available.`,
    );
    warned.add(method);
  };
  return {
    connected: false,
    on() {
      warn('on');
      return this;
    },
    once() {
      warn('once');
      return this;
    },
    off() {
      return this;
    },
    emit(event) {
      warn('emit');
      console.warn(`Socket.IO unavailable: emit('${event || ''}') skipped.`);
      return this;
    },
  };
};

let activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'trace';
const tabListeners = new Map();

const notifyTab = (tabName) => {
  const callbacks = tabListeners.get(tabName);
  if (!callbacks) return;
  callbacks.forEach((cb) => {
    try {
      cb(tabName);
    } catch (err) {
      // Surface errors in the console without interrupting other listeners.
      console.error(err);
    }
  });
};

const updateTabUi = (tabName) => {
  $$('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  $$('.tab').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${tabName}`);
  });
};

const setActiveTab = (tabName) => {
  if (!tabName) return;
  activeTab = tabName;
  updateTabUi(tabName);
  notifyTab(tabName);
};

const onTabChange = (tabName, handler) => {
  if (!tabListeners.has(tabName)) {
    tabListeners.set(tabName, new Set());
  }
  const handlers = tabListeners.get(tabName);
  handlers.add(handler);
  return () => handlers.delete(handler);
};

const initTabs = () => {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      if (tabName) {
        setActiveTab(tabName);
      }
    });
  });
};

initTabs();

const initFilePicker = ({ browseBtnId, fileInputId, pathInputId, uploadUrl }) => {
  const browseBtn = $(browseBtnId);
  const fileInput = $(fileInputId);
  const pathInput = $(pathInputId);
  if (!browseBtn || !fileInput || !pathInput) return;

  const isFakePath = (value) => typeof value === 'string' && value.toLowerCase().includes('fakepath');

  const setPathValue = (value) => {
    if (!value) return;
    pathInput.value = value;
    pathInput.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const uploadFile = async (file) => {
    if (!uploadUrl) return null;
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || !data.path) {
      const err = data?.error || response.statusText || 'Upload failed';
      throw new Error(err);
    }
    return data.path;
  };

  const deriveLocalPath = (file) => {
    if (!file) return null;
    if (file.path && !isFakePath(file.path)) return file.path;
    if (file.webkitRelativePath && !isFakePath(file.webkitRelativePath)) return file.webkitRelativePath;
    if (fileInput.value && !isFakePath(fileInput.value)) return fileInput.value;
    return null;
  };

  const handleSelection = async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    browseBtn.disabled = true;
    pathInput.classList.add('is-uploading');

    try {
      const uploadedPath = await uploadFile(file);
      if (uploadedPath) {
        setPathValue(uploadedPath);
        fileInput.value = '';
        return;
      }
    } catch (err) {
      console.error('Failed to upload file', err);
    } finally {
      browseBtn.disabled = false;
      pathInput.classList.remove('is-uploading');
    }

    const derivedPath = deriveLocalPath(file);
    if (derivedPath) {
      setPathValue(derivedPath);
    }
    fileInput.value = '';
  };

  browseBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    handleSelection();
  });
};

initFilePicker({
  browseBtnId: '#btn-dbc-browse',
  fileInputId: '#dbc-file',
  pathInputId: '#dbc_path',
  uploadUrl: '/api/uploads/dbc',
});

initFilePicker({
  browseBtnId: '#btn-dll-browse',
  fileInputId: '#diag-dll-file',
  pathInputId: '#diag-dll',
  uploadUrl: '/api/uploads/dll',
});

const bootstrap = async () => {
  let socketIo = null;
  try {
    socketIo = await ensureSocketIo();
  } catch (err) {
    console.error('Failed to load Socket.IO client script', err);
  }

  let socket = null;
  let socketReady = false;
  if (socketIo) {
    setSocketStatus('Connecting to Socket.IO…', 'info');
    try {
      socket = socketIo();
      socketReady = true;
    } catch (err) {
      console.error('Failed to initialize Socket.IO client', err);
    }
  }

  if (!socket) {
    socket = createSocketStub();
    setSocketStatus('Real-time connection unavailable. Some live features are disabled.', 'error');
  }

  if (socketReady) {
    socket.on('connect', () => {
      setSocketStatus('Connected', 'success');
    });
    socket.on('disconnect', () => {
      setSocketStatus('Socket disconnected. Live updates paused.', 'warning');
    });
    socket.on('connect_error', (err) => {
      setSocketStatus(`Socket error: ${err?.message || 'connection failed'}`, 'error');
    });
  }

  window.socket = socket;

  const tabContext = {
    getActiveTab: () => activeTab,
    onTabChange,
  };

  const stimApi = initStim({ socket, ...tabContext });
  initLog({ socket, ...tabContext });
  initTrace({ socket, ...tabContext });
  initMessages({ socket, ...tabContext, stimApi });
  initDiag({ socket, ...tabContext });
  initGraphic({ socket, ...tabContext });
  initBusloadMonitor();
  initProfileManager();

  equalizeSettingsCardHeights();
  window.addEventListener('resize', () => {
    requestAnimationFrame(equalizeSettingsCardHeights);
  });

  setActiveTab(activeTab);
};

bootstrap().catch((err) => {
  console.error('Failed to initialize application', err);
  setSocketStatus(err?.message || 'Application initialization failed.', 'error');
});
