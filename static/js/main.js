/**
 * @fileoverview Entry point for the CanX web UI. Sets up the shared Socket.IO
 * connection, coordinates tab navigation, and bootstraps feature modules.
 */
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";
import { initTrace } from './trace.js';
import { initMessages } from './messages.js';
import { initStim } from './stim.js';
import { initDiag } from './diag.js';

const $ = (selector, ctx = document) => ctx.querySelector(selector);
const $$ = (selector, ctx = document) => Array.from(ctx.querySelectorAll(selector));

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

const initDbcPicker = () => {
  const browseBtn = $('#btn-dbc-browse');
  const fileInput = $('#dbc-file');
  const pathInput = $('#dbc_path');
  if (!browseBtn || !fileInput || !pathInput) return;

  browseBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const derivedPath = file.path || file.webkitRelativePath || file.name || '';
    if (derivedPath) {
      pathInput.value = derivedPath;
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
};

initDbcPicker();

const socket = io({ transports: ['websocket'] });
window.socket = socket;

const tabContext = {
  getActiveTab: () => activeTab,
  onTabChange,
};

const stimApi = initStim({ socket, ...tabContext });
initTrace({ socket, ...tabContext });
initMessages({ socket, ...tabContext, stimApi });
initDiag({ socket, ...tabContext });

setActiveTab(activeTab);
