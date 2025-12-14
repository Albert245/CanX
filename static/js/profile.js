/**
 * Profile import/export helpers for capturing settings, message values, and panel layouts.
 */

import {
  getAllMessagePayloads,
  reapplyStoreToVisibleForms,
  saveMessageSignals,
} from './message-store.js';
import { applyDiagProfileData, getDiagProfileData } from './diag.js';

const $ = (selector, ctx = document) => ctx.querySelector(selector);

const collectSettings = () => ({
  device: $('#device')?.value || null,
  channel: Number($('#channel')?.value || 0),
  padding: $('#padding')?.value || '',
  busMode: document.querySelector('input[name="bus-mode"]:checked')?.value || 'can',
  dbcPath: $('#dbc_path')?.value || '',
  dbcNode: $('#dbc-node')?.value || '',
  receiverActivateAll: $('#receiver-activate-all')?.checked ?? true,
  diag: {
    functionalId: $('#diag-functional-id')?.value || '',
    functionalTimeout: Number($('#diag-functional-timeout')?.value || 0),
    physicalId: $('#diag-physical-id')?.value || '',
    physicalTimeout: Number($('#diag-physical-timeout')?.value || 0),
    testerId: $('#tester-id')?.value || '',
    testerPresentInterval: Number($('#tp-interval')?.value || 0),
    dllPath: $('#diag-dll')?.value || '',
  },
});

const applySettings = (settings = {}) => {
  if (!settings || typeof settings !== 'object') return;
  if (settings.device && $('#device')) $('#device').value = settings.device;
  if (typeof settings.channel === 'number' && $('#channel')) $('#channel').value = settings.channel;
  if (settings.padding !== undefined && $('#padding')) $('#padding').value = settings.padding;
  if (settings.busMode) {
    const radio = document.querySelector(`input[name="bus-mode"][value="${settings.busMode}"]`);
    if (radio) radio.checked = true;
  }
  if (settings.dbcPath !== undefined && $('#dbc_path')) $('#dbc_path').value = settings.dbcPath;
  if (settings.dbcNode !== undefined && $('#dbc-node')) $('#dbc-node').value = settings.dbcNode;
  if ($('#receiver-activate-all') && settings.receiverActivateAll !== undefined) {
    $('#receiver-activate-all').checked = !!settings.receiverActivateAll;
  }
  const diag = settings.diag || {};
  if (diag.functionalId !== undefined && $('#diag-functional-id')) $('#diag-functional-id').value = diag.functionalId;
  if (diag.functionalTimeout !== undefined && $('#diag-functional-timeout')) $('#diag-functional-timeout').value = diag.functionalTimeout;
  if (diag.physicalId !== undefined && $('#diag-physical-id')) $('#diag-physical-id').value = diag.physicalId;
  if (diag.physicalTimeout !== undefined && $('#diag-physical-timeout')) $('#diag-physical-timeout').value = diag.physicalTimeout;
  if (diag.testerId !== undefined && $('#tester-id')) $('#tester-id').value = diag.testerId;
  if (diag.testerPresentInterval !== undefined && $('#tp-interval')) $('#tp-interval').value = diag.testerPresentInterval;
  if (diag.dllPath !== undefined && $('#diag-dll')) $('#diag-dll').value = diag.dllPath;
};

const fetchPanelLayout = async () => {
  if (window.PanelAPI?.getLayout) {
    return window.PanelAPI.getLayout();
  }
  try {
    const response = await fetch('/api/panel/load');
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.layout) {
      return data.layout;
    }
  } catch (err) {
    console.warn('Unable to fetch panel layout for profile', err);
  }
  return null;
};

const applyPanelLayout = async (layout) => {
  if (!layout) return;
  if (window.PanelAPI?.applyLayout) {
    const applied = await window.PanelAPI.applyLayout(layout);
    if (applied) return;
  }
  try {
    await fetch('/api/panel/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(layout),
    });
  } catch (err) {
    console.warn('Unable to persist panel layout from profile', err);
  }
};

const buildProfile = async () => ({
  version: 1,
  generatedAt: new Date().toISOString(),
  settings: collectSettings(),
  diag: getDiagProfileData(),
  messages: getAllMessagePayloads(),
  panel: await fetchPanelLayout(),
});

const downloadJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const applyMessagesFromProfile = (messages = {}) => {
  Object.entries(messages || {}).forEach(([name, signals]) => {
    saveMessageSignals(name, { signals, pending: true });
  });
  reapplyStoreToVisibleForms();
};

export const initProfileManager = () => {
  const exportBtn = $('#profile-export');
  const importBtn = $('#profile-import');
  const importFile = $('#profile-import-file');
  if (!exportBtn || !importBtn || !importFile) return;

  exportBtn.addEventListener('click', async () => {
    const profile = await buildProfile();
    downloadJson(profile, 'canx_profile.json');
  });

  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const profile = JSON.parse(text);
      applySettings(profile.settings || {});
      applyDiagProfileData(profile.diag || {});
      applyMessagesFromProfile(profile.messages || {});
      await applyPanelLayout(profile.panel || null);
    } catch (err) {
      console.error('Failed to import profile', err);
    } finally {
      importFile.value = '';
    }
  });
};
