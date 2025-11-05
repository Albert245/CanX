(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const parseNumber = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    const str = String(value).trim();
    if (!str) return null;
    if (/^0x/i.test(str)) {
      const parsed = parseInt(str, 16);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (/^0b/i.test(str)) {
      const parsed = parseInt(str.slice(2), 2);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (/^0o/i.test(str)) {
      const parsed = parseInt(str.slice(2), 8);
      return Number.isNaN(parsed) ? null : parsed;
    }
    const num = Number(str);
    return Number.isNaN(num) ? null : num;
  };

  const trimZeros = (str) => {
    if (!str.includes(".")) return str;
    return str.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  };

  const formatPhysical = (value, allowFloat) => {
    if (!Number.isFinite(value)) return "";
    if (!allowFloat && Number.isInteger(value)) return String(value);
    const fixed = value.toFixed(allowFloat ? 6 : 3);
    return trimZeros(fixed);
  };

  const formatRaw = (value, allowFloat) => {
    if (!Number.isFinite(value)) return "";
    if (!allowFloat) return String(Math.round(value));
    const fixed = value.toFixed(6);
    return trimZeros(fixed);
  };

  const stimContainer = $("#stim-nodes-container");
  const nodeSelect = $("#stim-node-select");
  const stimStatus = $("#stim-status");
  const stimNodesAdded = new Set();
  let nodeMap = {};

  const setStimStatus = (text, isError = false) => {
    if (!stimStatus) return;
    stimStatus.textContent = text || "";
    stimStatus.style.color = isError ? "#f88" : "#9aa0a6";
  };

  const populateNodeSelect = () => {
    if (!nodeSelect) return;
    nodeSelect.innerHTML = "";
    const names = Object.keys(nodeMap || {}).sort();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = names.length ? "Select node" : "No nodes available";
    placeholder.disabled = true;
    placeholder.selected = true;
    nodeSelect.appendChild(placeholder);
    names.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      nodeSelect.appendChild(opt);
    });
  };

  const clearStimNodes = () => {
    if (stimContainer) {
      stimContainer.innerHTML = "";
    }
    stimNodesAdded.clear();
  };

  const syncFromRaw = (row, rawInput, physInput) => {
    const value = rawInput.value.trim();
    if (!value) return;
    const raw = parseNumber(value);
    if (raw === null) return;
    const scale = parseNumber(row.dataset.scale) ?? 1;
    const offset = parseNumber(row.dataset.offset) ?? 0;
    const allowFloat = row.dataset.isFloat === "1";
    const physical = scale === 0 ? raw : raw * scale + offset;
    if (Number.isFinite(physical)) {
      physInput.value = formatPhysical(physical, true);
    }
    if (!allowFloat) {
      rawInput.value = formatRaw(raw, false);
    }
  };

  const syncFromPhysical = (row, physInput, rawInput) => {
    const value = physInput.value.trim();
    if (!value) return;
    const physical = parseNumber(value);
    if (physical === null) return;
    const scale = parseNumber(row.dataset.scale) ?? 1;
    const offset = parseNumber(row.dataset.offset) ?? 0;
    const allowFloat = row.dataset.isFloat === "1";
    const raw = scale === 0 ? physical : (physical - offset) / scale;
    if (Number.isFinite(raw)) {
      rawInput.value = formatRaw(raw, allowFloat);
    }
    if (Number.isFinite(physical)) {
      physInput.value = formatPhysical(physical, true);
    }
  };

  const buildSignalRow = (signal) => {
    const row = document.createElement("div");
    row.className = "stim-signal";
    row.dataset.signal = signal.name;
    row.dataset.scale = signal.scale ?? 1;
    row.dataset.offset = signal.offset ?? 0;
    row.dataset.isFloat = signal.is_float ? "1" : "0";

    const name = document.createElement("div");
    name.className = "sig-name";
    name.textContent = signal.unit ? `${signal.name} (${signal.unit})` : signal.name;

    const inputs = document.createElement("div");
    inputs.className = "sig-inputs";

    const rawLabel = document.createElement("label");
    rawLabel.textContent = "Raw";
    const rawInput = document.createElement("input");
    rawInput.type = "text";
    rawInput.className = "sig-raw";
    rawInput.value = signal.raw ?? "";
    rawLabel.appendChild(rawInput);

    const physLabel = document.createElement("label");
    physLabel.textContent = "Physical";
    const physInput = document.createElement("input");
    physInput.type = "text";
    physInput.className = "sig-physical";
    physInput.value = signal.physical ?? "";
    physLabel.appendChild(physInput);

    inputs.appendChild(rawLabel);
    inputs.appendChild(physLabel);

    rawInput.addEventListener("input", () => syncFromRaw(row, rawInput, physInput));
    physInput.addEventListener("input", () => syncFromPhysical(row, physInput, rawInput));

    row.appendChild(name);
    row.appendChild(inputs);

    if (signal.choices && Object.keys(signal.choices).length) {
      const choices = document.createElement("div");
      choices.className = "stim-meta";
      const mapped = Object.entries(signal.choices).map(([k, v]) => `${k}:${v}`);
      choices.textContent = `Choices: ${mapped.join(", ")}`;
      row.appendChild(choices);
    }

    return row;
  };

  const loadMessageSignals = async (wrapper, messageName) => {
    const body = wrapper.querySelector(".stim-signals");
    const status = wrapper.querySelector(".stim-status");
    const meta = wrapper.querySelector(".stim-summary-meta");
    if (body) body.innerHTML = "";
    if (status) status.textContent = "loading";
    try {
      const res = await fetch(`/api/dbc/message_info/${encodeURIComponent(messageName)}`);
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) throw new Error(js.error || "Failed to load message");
      const msg = js.message;
      if (meta) {
        const parts = [`ID: ${msg.id_hex}`];
        if (msg.cycle_time !== undefined && msg.cycle_time !== null) {
          parts.push(`Cycle: ${msg.cycle_time}`);
        }
        meta.textContent = parts.join(" | ");
      }
      if (status) status.textContent = msg.running ? "running" : "stopped";
      if (body) {
        msg.signals.forEach((sig) => {
          body.appendChild(buildSignalRow(sig));
        });
      }
    } catch (err) {
      if (body) {
        const div = document.createElement("div");
        div.className = "stim-meta";
        div.textContent = err.message || "Error";
        body.appendChild(div);
      }
      if (status) status.textContent = "error";
    }
  };

  const collectSignalValues = (wrapper) => {
    const signals = {};
    wrapper.querySelectorAll(".stim-signal").forEach((row) => {
      const name = row.dataset.signal;
      const rawInput = row.querySelector(".sig-raw");
      const physInput = row.querySelector(".sig-physical");
      if (!name || !rawInput || !physInput) return;
      const rawVal = rawInput.value.trim();
      const physVal = physInput.value.trim();
      if (!rawVal && !physVal) return;
      signals[name] = {
        raw: rawVal || null,
        physical: physVal || null,
      };
    });
    return signals;
  };

  const handleStimUpdate = async (wrapper, messageName) => {
    const status = wrapper.querySelector(".stim-status");
    if (status) status.textContent = "updating";
    const signals = collectSignalValues(wrapper);
    const payload = { message_name: messageName, signals };
    try {
      const res = await fetch("/api/stim/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) throw new Error(js.error || "update failed");
      if (status) {
        status.textContent = js.started ? "started" : "updated";
      }
      await loadMessageSignals(wrapper, messageName);
    } catch (err) {
      if (status) status.textContent = `error: ${err.message}`;
    }
  };

  const createMessageBlock = (messageName) => {
    const detail = document.createElement("details");
    detail.className = "stim-message";
    detail.dataset.message = messageName;

    const summary = document.createElement("summary");

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = messageName;

    const meta = document.createElement("span");
    meta.className = "stim-summary-meta";

    const updateBtn = document.createElement("button");
    updateBtn.type = "button";
    updateBtn.textContent = "Update";

    const status = document.createElement("span");
    status.className = "stim-status";

    updateBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      handleStimUpdate(detail, messageName);
    });

    summary.appendChild(title);
    summary.appendChild(meta);
    summary.appendChild(updateBtn);
    summary.appendChild(status);

    const body = document.createElement("div");
    body.className = "stim-signals";

    detail.appendChild(summary);
    detail.appendChild(body);

    detail.addEventListener("toggle", () => {
      if (detail.open) {
        loadMessageSignals(detail, messageName);
      }
    });

    return detail;
  };

  const createNodeCard = (nodeName, messageNames) => {
    const detail = document.createElement("details");
    detail.className = "stim-node";
    detail.dataset.node = nodeName;

    const summary = document.createElement("summary");

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = nodeName;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      stimNodesAdded.delete(nodeName);
      detail.remove();
    });

    summary.appendChild(title);
    summary.appendChild(removeBtn);

    const messageWrap = document.createElement("div");
    messageWrap.className = "stim-messages";
    messageNames.forEach((msgName) => {
      messageWrap.appendChild(createMessageBlock(msgName));
    });

    detail.appendChild(summary);
    detail.appendChild(messageWrap);

    return detail;
  };

  const addNodeToView = (nodeName) => {
    if (!stimContainer) return;
    if (!nodeMap[nodeName]) {
      setStimStatus(`Node ${nodeName} not found`, true);
      return;
    }
    if (stimNodesAdded.has(nodeName)) {
      setStimStatus(`Node ${nodeName} already added`, true);
      return;
    }
    const card = createNodeCard(nodeName, nodeMap[nodeName]);
    stimContainer.appendChild(card);
    stimNodesAdded.add(nodeName);
    setStimStatus("");
  };

  const loadNodes = async () => {
    if (!nodeSelect) return;
    try {
      const res = await fetch("/api/dbc/nodes");
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) throw new Error(js.error || "DBC not loaded");
      nodeMap = js.nodes || {};
      populateNodeSelect();
      setStimStatus(Object.keys(nodeMap).length ? "" : "No nodes available");
    } catch (err) {
      nodeMap = {};
      populateNodeSelect();
      setStimStatus(err.message || "Unable to load nodes", true);
    }
  };

  if (nodeSelect) {
    nodeSelect.addEventListener("change", () => setStimStatus(""));
  }

  const addNodeButton = $("#btn-stim-add");
  if (addNodeButton) {
    addNodeButton.addEventListener("click", () => {
      if (!nodeSelect) return;
      const nodeName = nodeSelect.value;
      if (!nodeName) {
        setStimStatus("Select a node first", true);
        return;
      }
      addNodeToView(nodeName);
    });
  }

  // Tabs
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab").forEach((tab) => tab.classList.remove("active"));
      const target = $(`#tab-${btn.dataset.tab}`);
      if (target) target.classList.add("active");
      if (btn.dataset.tab === "stim" && Object.keys(nodeMap).length === 0) {
        loadNodes();
      }
    });
  });

  // Socket.IO
  const socket = io();
  let filterId = "";
  let decodeEnabled = true;

  socket.on("connected", (msg) => {
    decodeEnabled = !!msg?.decode;
    const toggle = $("#decode-toggle");
    if (toggle) toggle.checked = decodeEnabled;
  });

  socket.on("trace", (msg) => {
    const f = filterId.trim().toLowerCase();
    if (f) {
      const id = String(msg.id || "").toLowerCase().replace(/^0x/, "");
      const f2 = f.replace(/^0x/, "");
      if (!id.includes(f2)) return;
    }
    const tr = document.createElement("tr");
    const timestamp = new Date((msg.ts || Date.now()) * 1000).toLocaleTimeString();
    const decoded = msg.decoded && decodeEnabled ? JSON.stringify(msg.decoded) : "";
    tr.innerHTML = `
      <td>${timestamp}</td>
      <td>${msg.id || ""}</td>
      <td>${msg.dlc ?? ""}</td>
      <td>${msg.data || ""}</td>
      <td>${decoded}</td>
    `;
    const tbody = $("#trace-table tbody");
    if (tbody) {
      tbody.insertBefore(tr, tbody.firstChild);
      const rows = $$("#trace-table tbody tr");
      if (rows.length > 1000) rows.slice(1000).forEach((r) => r.remove());
    }
  });

  const traceStart = $("#btn-trace-start");
  if (traceStart) traceStart.addEventListener("click", () => socket.emit("start_trace"));
  const traceStop = $("#btn-trace-stop");
  if (traceStop) traceStop.addEventListener("click", () => socket.emit("stop_trace"));
  const traceFilter = $("#trace-filter");
  if (traceFilter) traceFilter.addEventListener("input", (e) => { filterId = e.target.value || ""; });
  const decodeToggle = $("#decode-toggle");
  if (decodeToggle) decodeToggle.addEventListener("change", (e) => { decodeEnabled = e.target.checked; });

  // Init CAN
  const initBtn = $("#btn-init");
  if (initBtn) {
    initBtn.addEventListener("click", async () => {
      const payload = {
        device: $("#device").value,
        channel: Number($("#channel").value || 0),
        is_fd: $("#is_fd").checked,
        padding: $("#padding").value || "00",
        dbc_path: $("#dbc_path").value || null,
      };
      const res = await fetch("/api/init", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => ({}));
      const status = $("#init-status");
      if (status) status.textContent = js.ok ? `OK - DBC: ${js.dbc_loaded ? "yes" : "no"}` : (js.error || "ERR");
      if (js.ok) {
        clearStimNodes();
        nodeMap = {};
        populateNodeSelect();
      }
    });
  }

  // Messages tab
  let currentMessage = null;
  let messages = [];

  const renderMessageList = () => {
    const ul = $("#msg-list");
    if (!ul) return;
    ul.innerHTML = "";
    const query = ($("#msg-search").value || "").toLowerCase();
    messages
      .filter((m) => (m.name || "").toLowerCase().includes(query) || String(m.id_hex || "").toLowerCase().includes(query))
      .forEach((m) => {
        const li = document.createElement("li");
        li.textContent = `${m.name} (${m.id_hex})`;
        li.addEventListener("click", () => selectMessage(m));
        if (currentMessage && currentMessage.name === m.name) li.classList.add("active");
        ul.appendChild(li);
      });
  };

  const selectMessage = async (m) => {
    currentMessage = m;
    const title = $("#msg-title");
    if (title) title.textContent = `${m.name} - ${m.id_hex}`;
    const meta = $("#msg-meta");
    if (meta) meta.textContent = `DLC: ${m.dlc} | Cycle: ${m.cycle_time ?? "-"} | Extended: ${m.is_extended ? "yes" : "no"}`;
    const res = await fetch(`/api/dbc/message/${encodeURIComponent(m.name)}`);
    const js = await res.json().catch(() => ({ ok: false }));
    const form = $("#signals-form");
    if (form) {
      form.innerHTML = "";
      if (js.ok) {
        Object.entries(js.signals || {}).forEach(([k, v]) => {
          const wrap = document.createElement("div");
          wrap.className = "sig";
          const label = document.createElement("label");
          label.textContent = k;
          const input = document.createElement("input");
          input.type = "number";
          input.value = v;
          input.name = k;
          wrap.appendChild(label);
          wrap.appendChild(input);
          form.appendChild(wrap);
        });
      }
    }
    renderMessageList();
  };

  const loadDbcMessages = $("#btn-load-dbc");
  if (loadDbcMessages) {
    loadDbcMessages.addEventListener("click", async () => {
      const res = await fetch("/api/dbc/messages");
      const js = await res.json().catch(() => ({ ok: false }));
      if (!js.ok) return;
      messages = js.messages || [];
      renderMessageList();
      clearStimNodes();
      await loadNodes();
    });
  }

  const msgSearch = $("#msg-search");
  if (msgSearch) msgSearch.addEventListener("input", renderMessageList);

  const startPeriodic = $("#btn-start-periodic");
  if (startPeriodic) startPeriodic.addEventListener("click", async () => {
    if (!currentMessage) return;
    const payload = {
      message: currentMessage.name,
      period: Number($("#msg-period").value || 100),
      duration: Number($("#msg-duration").value || 0) || null,
    };
    await fetch("/api/periodic/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  });

  const stopPeriodic = $("#btn-stop-periodic");
  if (stopPeriodic) stopPeriodic.addEventListener("click", async () => {
    if (!currentMessage) return;
    const payload = { message: currentMessage.name };
    await fetch("/api/periodic/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  });

  const updateSignalsBtn = $("#btn-update-signals");
  if (updateSignalsBtn) updateSignalsBtn.addEventListener("click", async () => {
    if (!currentMessage) return;
    const form = $("#signals-form");
    if (!form) return;
    const inputs = Array.from(form.querySelectorAll("input"));
    const entries = inputs.map((i) => [i.name, Number(i.value)]);
    const signals = Object.fromEntries(entries);
    const payload = { message_name: currentMessage.name, signals };
    await fetch("/api/periodic/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  });

  // Diagnostics tab
  const diagLog = $("#diag-log");
  const diagLogScroll = () => {
    if (!diagLog) return;
    diagLog.scrollTop = diagLog.scrollHeight;
  };

  const addDiagLogEntry = ({
    label,
    ecuId,
    request,
    response,
    error,
  }) => {
    if (!diagLog) return;
    const entry = document.createElement("div");
    entry.className = "diag-log-entry";
    if (error) {
      entry.classList.add("error");
    } else {
      entry.classList.add("success");
    }
    const meta = document.createElement("div");
    meta.className = "diag-log-meta";
    const ts = document.createElement("span");
    ts.className = "diag-log-time";
    ts.textContent = new Date().toLocaleTimeString();
    const title = document.createElement("span");
    title.className = "diag-log-title";
    title.textContent = label || "Diagnostics";
    meta.appendChild(ts);
    meta.appendChild(title);
    if (ecuId) {
      const ecu = document.createElement("span");
      ecu.className = "diag-log-ecu";
      ecu.textContent = `ECU ${ecuId}`;
      meta.appendChild(ecu);
    }
    entry.appendChild(meta);

    if (request) {
      const req = document.createElement("pre");
      req.className = "diag-log-req";
      req.textContent = `REQ: ${request}`;
      entry.appendChild(req);
    }

    if (error) {
      const err = document.createElement("pre");
      err.className = "diag-log-resp";
      err.textContent = `ERR: ${error}`;
      entry.appendChild(err);
    } else if (response !== undefined) {
      const resp = document.createElement("pre");
      resp.className = "diag-log-resp";
      const body = Array.isArray(response)
        ? response.join(" ")
        : response || "";
      resp.textContent = body ? `RESP: ${body}` : "RESP: <no data>";
      entry.appendChild(resp);
    }

    diagLog.appendChild(entry);
    diagLogScroll();
  };

  const diagGroups = {
    functional: {
      raw: "#diag-functional-raw",
      ecu: "#diag-functional-id",
      timeout: "#diag-functional-timeout",
      defaultLabel: "Functional",
    },
    physical: {
      raw: "#diag-physical-raw",
      ecu: "#diag-physical-id",
      timeout: "#diag-physical-timeout",
      defaultLabel: "Physical",
    },
  };

  const normalizeDiagRaw = (raw) =>
    (raw || "").replace(/\s+/g, " ").trim().toUpperCase();

  const sendDiagRequest = async ({ group, raw, ecuId, timeout, label }) => {
    const settings = diagGroups[group];
    if (!settings) return;
    const rawInput = $(settings.raw);
    const ecuInput = $(settings.ecu);
    const timeoutInput = $(settings.timeout);
    const payload = {
      data: normalizeDiagRaw(raw ?? (rawInput ? rawInput.value : "")),
      timeout: Number(
        timeout ?? (timeoutInput ? timeoutInput.value || 500 : 500),
      ),
    };
    const target = ecuId ?? (ecuInput ? ecuInput.value : "");
    if (target) payload.ecu_id = target.trim();
    payload.label = label || settings.defaultLabel;
    if (!payload.data) {
      addDiagLogEntry({
        label: `${settings.defaultLabel} Send`,
        error: "Request payload is empty",
        ecuId: target?.toUpperCase?.(),
      });
      return;
    }
    try {
      const res = await fetch("/api/diag/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({ ok: false }));
      if (js.ok) {
        addDiagLogEntry({
          label: payload.label,
          ecuId: js.ecu_id || target?.toUpperCase?.(),
          request: payload.data,
          response: js.response,
        });
      } else {
        addDiagLogEntry({
          label: payload.label,
          ecuId: target?.toUpperCase?.(),
          request: payload.data,
          error: js.error || "ERR",
        });
      }
    } catch (err) {
      addDiagLogEntry({
        label: payload.label,
        ecuId: target?.toUpperCase?.(),
        request: payload.data,
        error: err.message || "ERR",
      });
    }
  };

  const diagCustomCounters = {
    functional: 0,
    physical: 0,
  };

  const createCustomDiagButton = (group) => {
    const settings = diagGroups[group];
    if (!settings) return;
    const rawInput = $(settings.raw);
    const ecuInput = $(settings.ecu);
    const timeoutInput = $(settings.timeout);
    if (!rawInput || !rawInput.value.trim()) {
      addDiagLogEntry({
        label: `${settings.defaultLabel} Add`,
        error: "Cannot add custom sender without payload",
      });
      return;
    }
    const normalized = normalizeDiagRaw(rawInput.value);
    const ecuId = ecuInput ? ecuInput.value.trim() : "";
    const timeout = timeoutInput ? Number(timeoutInput.value || 500) : 500;
    const container = document.querySelector(`#${group}-custom-buttons`);
    if (!container) return;
    const index = ++diagCustomCounters[group];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "diag-custom-btn";
    const label = `${settings.defaultLabel} ${index}`;
    const preview = normalized.split(" ").slice(0, 3).join(" ");
    btn.textContent = preview ? `${label}: ${preview}` : label;
    btn.addEventListener("click", () => {
      sendDiagRequest({
        group,
        raw: normalized,
        ecuId,
        timeout,
        label,
      });
    });
    container.appendChild(btn);
  };

  const diagConfig = $("#btn-diag-config");
  if (diagConfig)
    diagConfig.addEventListener("click", async () => {
      const payload = {
        ecu_id: $("#ecu-id").value.trim(),
        tester_id: $("#tester-id").value.trim(),
      };
      const dllInput = $("#diag-dll");
      if (dllInput && dllInput.value.trim()) payload.dll = dllInput.value.trim();
      const status = $("#diag-unlock-status");
      if (status) {
        status.textContent = "";
        status.style.color = "#9aa0a6";
      }
      try {
        const res = await fetch("/api/diag/configure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const js = await res.json().catch(() => ({ ok: false }));
        if (js.ok) {
          const ecuField = $("#diag-physical-id");
          if (ecuField && js.ecu_id) {
            ecuField.value = js.ecu_id;
          }
          addDiagLogEntry({
            label: "Diagnostics Configured",
            ecuId: `${js.ecu_id || payload.ecu_id}/${js.tester_id || payload.tester_id}`,
            request: js.dll ? `DLL: ${js.dll}` : undefined,
          });
        } else {
          addDiagLogEntry({
            label: "Diagnostics Config",
            error: js.error || "ERR",
          });
        }
      } catch (err) {
        addDiagLogEntry({
          label: "Diagnostics Config",
          error: err.message || "ERR",
        });
      }
    });

  const functionalSend = $("#btn-functional-send");
  if (functionalSend)
    functionalSend.addEventListener("click", () =>
      sendDiagRequest({ group: "functional" }),
    );

  const physicalSend = $("#btn-physical-send");
  if (physicalSend)
    physicalSend.addEventListener("click", () =>
      sendDiagRequest({ group: "physical" }),
    );

  const functionalAdd = $("#btn-functional-add");
  if (functionalAdd)
    functionalAdd.addEventListener("click", () => createCustomDiagButton("functional"));

  const physicalAdd = $("#btn-physical-add");
  if (physicalAdd)
    physicalAdd.addEventListener("click", () => createCustomDiagButton("physical"));

  const diagUnlock = $("#btn-diag-unlock");
  if (diagUnlock) diagUnlock.addEventListener("click", async () => {
    const status = $("#diag-unlock-status");
    if (status) {
      status.textContent = "Unlocking...";
      status.style.color = "#9aa0a6";
    }
    const payload = {};
    const ecuInput = $("#diag-unlock-ecu");
    if (ecuInput && ecuInput.value.trim()) payload.ecu_id = ecuInput.value.trim();
    const dllInput = $("#diag-dll");
    if (dllInput && dllInput.value.trim()) payload.dll = dllInput.value.trim();
    try {
      const res = await fetch("/api/diag/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => ({ ok: false }));
      if (status) {
        if (js.ok) {
          const ecu = js.ecu_id ? ` ${js.ecu_id}` : "";
          status.textContent = `Security unlocked${ecu}`.trim();
          status.style.color = "#4caf50";
          addDiagLogEntry({
            label: "Security Unlock",
            ecuId: js.ecu_id,
            request: payload.dll ? `DLL: ${payload.dll}` : undefined,
            response: "Unlocked",
          });
        } else {
          status.textContent = js.error || "Unlock failed";
          status.style.color = "#f88";
          addDiagLogEntry({
            label: "Security Unlock",
            ecuId: payload.ecu_id,
            error: js.error || "Unlock failed",
          });
        }
      }
    } catch (err) {
      if (status) {
        status.textContent = err.message || "Unlock failed";
        status.style.color = "#f88";
      }
      addDiagLogEntry({
        label: "Security Unlock",
        ecuId: payload.ecu_id,
        error: err.message || "Unlock failed",
      });
    }
  });

  const tpStart = $("#btn-tp-start");
  if (tpStart) tpStart.addEventListener("click", async () => {
    const payload = { action: "start", interval: Number($("#tp-interval").value || 2000) };
    await fetch("/api/diag/tester_present", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  });

  const tpStop = $("#btn-tp-stop");
  if (tpStop) tpStop.addEventListener("click", async () => {
    const payload = { action: "stop" };
    await fetch("/api/diag/tester_present", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  });
})();
