    function showDiscovery() {
      document.getElementById('welcomeView').style.display = 'block';
      document.getElementById('researchFeed').style.display = 'none';
      document.getElementById('discoveryView').style.display = 'none';
      $("discoveryGrid")?.scrollIntoView({ behavior: 'smooth' });
      const sidebar = document.getElementById('sidebar');
      if (sidebar.classList.contains('active')) toggleSidebar();
      expandChat();
      setStatus("Discovery view ready.");
      saveUiState();
    }

    async function refreshDiscovery() {
      const searchUrl = $("searchUrl").value.trim();
      setStatus("Refreshing discovery...");
      try {
        await loadDiscovery(searchUrl, state.currentDiscoveryCategory || "tech");
        setStatus("Tech discovery refreshed.");
      } catch (err) {
        setStatus(`Discovery failed: ${err.message}`);
      }
    }

    function parseContextUrls(raw) {
      return uniqueStrings(String(raw || "").split("\n").map((x) => x.trim()).filter(Boolean))
        .filter((u) => /^https?:\/\//i.test(u))
        .slice(0, 8);
    }

    function normalizeSearchUrl(raw) {
      const value = String(raw || "").trim();
      if (!value) return "";
      if (/^https?:\/\//i.test(value)) return value;
      if (value.startsWith("/")) {
        if (window.location.protocol === "file:") return "http://localhost:10387/search";
        return `${window.location.origin}${value}`;
      }
      return value;
    }

    function getCurrentSettingsSnapshot() {
      return {
        provider: $("provider")?.value || "lmstudio",
        lmBase: $("lmBase").value.trim(),
        ollamaBase: $("ollamaBase")?.value?.trim() || "",
        openaiBase: $("openaiBase")?.value?.trim() || "",
        openaiKey: $("openaiKey")?.value || "",
        anthropicKey: $("anthropicKey")?.value || "",
        geminiKey: $("geminiKey")?.value || "",
        modelName: $("modelName").value.trim(),
        searchUrl: $("searchUrl").value.trim(),
        searchMode: $("searchMode")?.value || "auto",
        discoveryCount: Number($("discoveryCount")?.value || state.discoveryCount || 24),
        sourcesLayout: state.sourcesLayout || "row",
        mode: $("mode").value,
        researchMode: $("researchMode").value,
        thinkingMode: $("thinkingMode").value,
        language: $("language").value,
        enhancePromptLanguage: $("enhancePromptLanguage")?.value || "en",
        sourceLanes: getSelectedSourceProfiles(),
        copilotMode: $("copilotMode").checked,
        fastFollowups: $("fastFollowups")?.checked ?? true,
        autoRunDiscovery: $("autoRunDiscovery")?.checked ?? false,
        expAgentRelay: $("expAgentRelay")?.checked ?? true,
        expFastContextFetch: $("expFastContextFetch")?.checked ?? false,
        autoTranslatePrompts: $("autoTranslatePrompts")?.checked ?? true,
        llmParallel: Number($("llmParallel").value) || 2,
        searchParallel: Number($("searchParallel").value) || 4,
        maxOutTokens: Number($("maxOutTokens").value) || 1600,
        streamSynthesis: $("streamSynthesis").checked,
        robustJson: $("robustJson").checked,
        criticMinScore: Number($("criticMinScore").value) || 60,
        criticAgents: Number($("criticAgents").value) || 3,
        maxAutoLoops: Number($("maxAutoLoops").value) || 1,
        criticHardGate: $("criticHardGate").checked,
        customSystem: $("customSystem").value,
        contextUrls: $("contextUrls").value
      };
    }

    function applySettingsSnapshot(s) {
      if (!s) return;
      if (s.provider && $("provider")) $("provider").value = s.provider;
      if (s.lmBase) $("lmBase").value = s.lmBase;
      if (typeof s.ollamaBase === "string" && $("ollamaBase")) $("ollamaBase").value = s.ollamaBase;
      if (typeof s.openaiBase === "string" && $("openaiBase")) $("openaiBase").value = s.openaiBase;
      if (typeof s.openaiKey === "string" && $("openaiKey")) $("openaiKey").value = s.openaiKey;
      if (typeof s.anthropicKey === "string" && $("anthropicKey")) $("anthropicKey").value = s.anthropicKey;
      if (typeof s.geminiKey === "string" && $("geminiKey")) $("geminiKey").value = s.geminiKey;
      if (s.modelName) $("modelName").value = s.modelName;
      if (s.searchUrl) $("searchUrl").value = s.searchUrl;
      if (s.searchMode && $("searchMode")) $("searchMode").value = s.searchMode;
      if (s.discoveryCount && $("discoveryCount")) {
        $("discoveryCount").value = String(s.discoveryCount);
        state.discoveryCount = Number(s.discoveryCount) || 24;
      }
      if (typeof s.sourcesLayout === "string") {
        state.sourcesLayout = s.sourcesLayout === "rail" ? "rail" : "row";
      }
      if ($("searchMode")) renderExecutionModeBadge($("searchMode").value || "auto");
      if (s.mode) $("mode").value = s.mode;
      if (s.researchMode) $("researchMode").value = s.researchMode;
      if (s.thinkingMode) $("thinkingMode").value = s.thinkingMode;
      if (s.language) $("language").value = s.language;
      if (s.language && $("languageModal")) $("languageModal").value = s.language;
      if (typeof s.enhancePromptLanguage === "string" && $("enhancePromptLanguage")) {
        $("enhancePromptLanguage").value = s.enhancePromptLanguage || "en";
      } else if ($("enhancePromptLanguage")) {
        $("enhancePromptLanguage").value = "en";
      }
      if (typeof s.copilotMode === "boolean") {
        $("copilotMode").checked = s.copilotMode;
        if ($("copilotBtn")) $("copilotBtn").checked = s.copilotMode;
      }
      if (typeof s.fastFollowups === "boolean" && $("fastFollowups")) $("fastFollowups").checked = s.fastFollowups;
      if ($("copilotBtn") && $("fastFollowups") && !$("copilotBtn").checked) $("fastFollowups").checked = false;
      if (typeof s.autoRunDiscovery === "boolean" && $("autoRunDiscovery")) $("autoRunDiscovery").checked = s.autoRunDiscovery;
      if (typeof s.expAgentRelay === "boolean" && $("expAgentRelay")) $("expAgentRelay").checked = s.expAgentRelay;
      if (typeof s.expFastContextFetch === "boolean" && $("expFastContextFetch")) $("expFastContextFetch").checked = s.expFastContextFetch;
      if (typeof s.autoTranslatePrompts === "boolean" && $("autoTranslatePrompts")) $("autoTranslatePrompts").checked = s.autoTranslatePrompts;
      if (s.llmParallel) $("llmParallel").value = s.llmParallel;
      if (s.searchParallel) $("searchParallel").value = s.searchParallel;
      if (s.maxOutTokens) $("maxOutTokens").value = s.maxOutTokens;
      if (typeof s.streamSynthesis === "boolean") $("streamSynthesis").checked = s.streamSynthesis;
      if (typeof s.robustJson === "boolean") $("robustJson").checked = s.robustJson;
      if (s.criticMinScore != null) $("criticMinScore").value = s.criticMinScore;
      if (s.criticAgents != null) $("criticAgents").value = s.criticAgents;
      if (s.maxAutoLoops != null) $("maxAutoLoops").value = s.maxAutoLoops;
      if (typeof s.criticHardGate === "boolean") $("criticHardGate").checked = s.criticHardGate;
      if (typeof s.customSystem === "string") $("customSystem").value = s.customSystem;
      if (typeof s.contextUrls === "string") $("contextUrls").value = s.contextUrls;
      if (typeof syncChatModelOptions === "function") syncChatModelOptions();
      const lanes = Array.isArray(s.sourceLanes) ? new Set(s.sourceLanes) : new Set(["web"]);
      document.querySelectorAll(".source-lane").forEach((el) => { el.checked = lanes.has(el.value); });
      renderDiscovery();
      renderSources();
      if (typeof enforceHfSpaceRuntimeDefaults === "function") enforceHfSpaceRuntimeDefaults();
    }

    function saveSettingsToStorage() {
      try {
        const snapshot = getCurrentSettingsSnapshot();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
        if ($("settingsState")) $("settingsState").textContent = "settings: saved";
      } catch {
        if ($("settingsState")) $("settingsState").textContent = "settings: failed";
      }
    }

    function syncCopilot() {
      const btn = $("copilotBtn");
      const checker = $("copilotMode");
      if (btn && checker) {
        checker.checked = btn.checked;
        saveSettingsToStorage();
      }
    }

    function syncChatModelOptions(opts = {}) {
      const modelSelect = $("modelName");
      const chatModelSelect = $("chatModel");
      if (!modelSelect || !chatModelSelect) return;
      const keepChatSelection = opts.keepChatSelection === true;
      const preferred = keepChatSelection ? (chatModelSelect.value || modelSelect.value) : modelSelect.value;
      const previous = chatModelSelect.value;

      chatModelSelect.innerHTML = "";
      const options = [...modelSelect.options];
      if (!options.length) {
        chatModelSelect.innerHTML = '<option value="">Model</option>';
        return;
      }

      for (const opt of options) {
        const clone = document.createElement("option");
        clone.value = opt.value;
        clone.textContent = opt.textContent || opt.value;
        chatModelSelect.appendChild(clone);
      }

      const values = options.map((o) => o.value);
      if (values.includes(preferred)) chatModelSelect.value = preferred;
      else if (values.includes(previous)) chatModelSelect.value = previous;
      else chatModelSelect.value = options[0].value;

      if (modelSelect.value !== chatModelSelect.value) {
        modelSelect.value = chatModelSelect.value;
      }
    }

    function loadSettingsFromStorage() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) {
          if ($("autoRunDiscovery")) $("autoRunDiscovery").checked = true;
          return;
        }
        const parsed = JSON.parse(raw);
        applySettingsSnapshot(parsed);
        syncChatModelOptions();
        if (typeof parsed?.autoRunDiscovery !== "boolean" && $("autoRunDiscovery")) {
          $("autoRunDiscovery").checked = true;
        }
        if (typeof enforceHfSpaceRuntimeDefaults === "function") enforceHfSpaceRuntimeDefaults();
      } catch { }
    }

    function bindSettingsPersistence() {
      const ids = [
        "provider", "lmBase", "ollamaBase", "openaiBase", "openaiKey", "anthropicKey", "geminiKey",
        "modelName", "chatModel", "searchUrl", "searchMode", "discoveryCount", "mode", "researchMode", "thinkingMode", "language",
        "enhancePromptLanguage",
        "copilotMode", "fastFollowups", "autoRunDiscovery", "expAgentRelay", "expFastContextFetch", "autoTranslatePrompts", "llmParallel", "searchParallel", "maxOutTokens",
        "streamSynthesis", "robustJson", "criticMinScore", "criticAgents", "maxAutoLoops",
        "criticHardGate", "customSystem", "contextUrls"
      ];
      ids.forEach((id) => {
        const el = $(id);
        if (!el) return;
        const evt = el.tagName === "TEXTAREA" || el.type === "text" || el.type === "number" ? "input" : "change";
        el.addEventListener(evt, saveSettingsToStorage);
      });
      document.querySelectorAll(".source-lane").forEach((el) => {
        el.addEventListener("change", saveSettingsToStorage);
      });
      const languageMain = $("language");
      const languageModal = $("languageModal");
      if (languageMain && languageModal) {
        languageModal.value = languageMain.value;
        languageMain.addEventListener("change", () => {
          languageModal.value = languageMain.value;
        });
        languageModal.addEventListener("change", () => {
          languageMain.value = languageModal.value;
          saveSettingsToStorage();
        });
      }
      const searchModeEl = $("searchMode");
      if (searchModeEl) {
        renderExecutionModeBadge(searchModeEl.value || "auto");
        searchModeEl.addEventListener("change", () => {
          renderExecutionModeBadge(searchModeEl.value || "auto");
          saveSettingsToStorage();
        });
      }
      const copilotBtn = $("copilotBtn");
      const fastFollowupsEl = $("fastFollowups");
      if (copilotBtn && fastFollowupsEl) {
        copilotBtn.addEventListener("change", () => {
          if (!copilotBtn.checked) fastFollowupsEl.checked = false;
          saveSettingsToStorage();
        });
        fastFollowupsEl.addEventListener("change", () => {
          if (fastFollowupsEl.checked && !copilotBtn.checked) copilotBtn.checked = true;
          if ($("copilotMode")) $("copilotMode").checked = copilotBtn.checked;
          saveSettingsToStorage();
        });
      }
      const discoveryCountEl = $("discoveryCount");
      if (discoveryCountEl) {
        discoveryCountEl.addEventListener("change", () => {
          state.discoveryCount = Number(discoveryCountEl.value) || 24;
          renderDiscovery();
          saveSettingsToStorage();
        });
      }

      const modelEl = $("modelName");
      const chatModelEl = $("chatModel");
      if (modelEl && chatModelEl) {
        modelEl.addEventListener("change", () => {
          syncChatModelOptions();
          saveSettingsToStorage();
        });
        chatModelEl.addEventListener("change", () => {
          if (modelEl.value !== chatModelEl.value) modelEl.value = chatModelEl.value;
          saveSettingsToStorage();
        });
        syncChatModelOptions({ keepChatSelection: true });
      }
    }

    function loadSessionsFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = JSON.parse(raw || "[]");
        state.sessions = Array.isArray(parsed) ? parsed : [];
      } catch {
        state.sessions = [];
      }
    }

    function persistSessions() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions.slice(0, 40)));
    }

    function renderSessions() {
      const root = $("sessionsList");
      if (!root) return;
      root.innerHTML = "";
      if (!state.sessions.length) {
        root.innerHTML = '<div class="mono p-3 text-center" style="color:#9db0bc; font-size: 0.8rem;">No history yet.</div>';
        return;
      }
      for (const s of state.sessions) {
        const item = document.createElement("div");
        item.className = `session-item ${s.id === state.currentSessionId ? "active" : ""}`;
        item.dataset.sid = s.id;
        item.onclick = (e) => {
          if (e.target.closest(".session-actions")) return;
          loadSessionById(s.id);
        };

        item.innerHTML = `
          <div class="mono" style="font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(s.title || "Session")}</div>
          <div class="mono text-secondary" style="font-size: 0.7rem;">${escapeHtml(s.time || "")}</div>
          <div class="session-actions">
            <button class="btn-session-action" onclick="duplicateSession('${s.id}')" title="Duplicate">📑</button>
            <button class="btn-session-action" onclick="renameSessionById('${s.id}')" title="Rename">✏️</button>
            <button class="btn-session-action" onclick="removeSessionById('${s.id}')" title="Delete">🗑️</button>
          </div>
        `;
        root.appendChild(item);
      }
    }

    function duplicateSession(id) {
      const s = state.sessions.find((x) => x.id === id);
      if (!s) return;
      const newId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newSession = JSON.parse(JSON.stringify(s));
      newSession.id = newId;
      newSession.title = `Copy of ${s.title}`;
      newSession.time = new Date().toLocaleString();
      state.sessions.unshift(newSession);
      persistSessions();
      renderSessions();
      setStatus("Session duplicated.");
    }

    function renderConversationTree() {
      const root = $("conversationTree");
      if (!root) return;
      const q = String($("convoSearch")?.value || "").trim().toLowerCase();
      const list = q
        ? state.sessions.filter((s) =>
          String(s.title || "").toLowerCase().includes(q) ||
          String(s.data?.userQuery || "").toLowerCase().includes(q)
        )
        : state.sessions;

      root.innerHTML = "";
      if (!list.length) {
        root.innerHTML = '<div class="mono" style="color:#9db0bc">No conversations yet.</div>';
        return;
      }

      for (const s of list) {
        const node = document.createElement("article");
        node.className = `conv-item ${s.id === state.currentSessionId ? "active" : ""}`;
        const preview = String(s.data?.userQuery || "").replace(/\s+/g, " ").slice(0, 160);
        node.innerHTML = `
          <div class="conv-top">
            <h4 class="conv-title">${escapeHtml(s.title || "Session")}</h4>
            <span class="conv-meta">${escapeHtml(s.time || "")}</span>
          </div>
          <p class="conv-preview">${escapeHtml(preview || "No query preview.")}</p>
          <div class="conv-actions">
            <button type="button" class="btn btn-outline-info btn-sm" data-action="open" data-sid="${escapeAttr(s.id)}">Open</button>
            <button type="button" class="btn btn-outline-light btn-sm" data-action="rename" data-sid="${escapeAttr(s.id)}">Rename</button>
            <button type="button" class="btn btn-outline-danger btn-sm" data-action="delete" data-sid="${escapeAttr(s.id)}">Delete</button>
          </div>
        `;
        root.appendChild(node);
      }
    }


    async function ingestContextUrls(urls) {
      const out = [];
      for (const url of urls.slice(0, 8)) {
        try {
          const proxy = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
          const txt = await fetch(proxy).then((r) => r.text());
          out.push({
            title: `Context URL: ${url}`,
            url,
            content: String(txt || "").replace(/\s+/g, " ").trim().slice(0, 1200)
          });
        } catch (err) {
          addLog("context", `Failed URL context: ${url} (${err.message})`, "warn");
        }
      }
      return out.filter((x) => x.content.length > 80);
    }

    function saveUiState() {
      try {
        const welcomeVisible = $("welcomeView") && $("welcomeView").style.display !== "none";
        const researchVisible = $("researchFeed") && $("researchFeed").style.display !== "none";
        const activeView = researchVisible ? "research" : (welcomeVisible ? "welcome" : "discovery");
        const uiSnapshot = {
          currentSessionId: state.currentSessionId || null,
          currentFocus: window.currentFocus || "all",
          currentDiscoveryCategory: state.currentDiscoveryCategory || "tech",
          activeView,
          isSearchCollapsed: $("searchContainer")?.classList.contains("collapsed") || false,
          isSearchCompact: $("searchContainer")?.classList.contains("compact") || false,
          isSearchDockedRight: $("searchContainer")?.classList.contains("dock-right") || false,
          draftQuery: $("userQuery")?.value || ""
        };
        localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiSnapshot));
      } catch { }
    }

    function loadUiState() {
      try {
        const raw = localStorage.getItem(UI_STATE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    function removeSessionById(id) {
      const idx = state.sessions.findIndex((x) => x.id === id);
      if (idx < 0) return;
      state.sessions.splice(idx, 1);
      if (state.currentSessionId === id) {
        state.currentSessionId = null;
        if (state.sessions.length) loadSessionById(state.sessions[0].id);
        else startNewSession();
      }
      persistSessions();
      renderSessions();
      renderConversationTree();
      saveUiState();
    }

    function renameSessionById(id) {
      const s = state.sessions.find((x) => x.id === id);
      if (!s) return;
      const next = window.prompt("Rename conversation:", s.title || "Session");
      if (!next || !next.trim()) return;
      s.title = next.trim().slice(0, 120);
      persistSessions();
      renderSessions();
      renderConversationTree();
      saveUiState();
    }

    function saveSession() {
      const id = state.currentSessionId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      state.currentSessionId = id;
      const session = {
        id,
        title: normalizeQuery($("userQuery").value).slice(0, 90) || "Untitled session",
        time: new Date().toLocaleString(),
        settings: getCurrentSettingsSnapshot(),
        data: {
          userQuery: $("userQuery").value,
          attachments: Array.isArray(state.attachments) ? state.attachments : [],
          answerHtml: $("answer").innerHTML,
          answerNotes: $("answerNotes").textContent || "",
          queries: state.queries,
          sources: state.sources,
          mediaImages: state.mediaImages,
          mediaVideos: state.mediaVideos,
          criticReport: state.criticReport,
          followups: state.followups,
          turns: state.turns || [],
          agentBrief: state.agentBrief || "",
          thinking: state.thinking,
          logs: state.logs.slice(0, 120)
        }
      };
      const idx = state.sessions.findIndex((x) => x.id === id);
      if (idx >= 0) state.sessions[idx] = session;
      else state.sessions.unshift(session);
      persistSessions();
      renderSessions();
      renderConversationTree();
      saveUiState();
    }

    function loadSessionById(id) {
      const s = state.sessions.find((x) => x.id === id);
      if (!s) return;
      state.currentSessionId = s.id;
      applySettingsSnapshot(s.settings);
      $("userQuery").value = s.data?.userQuery || "";
      state.attachments = Array.isArray(s.data?.attachments) ? s.data.attachments : [];
      if (typeof renderAttachmentTray === "function") renderAttachmentTray();
      state.lastUserQuery = s.data?.userQuery || "";
      const savedAnswer = String(s.data?.answerHtml || "").trim();
      const hasHtmlMarkup = /<[^>]+>/.test(savedAnswer);
      if (!savedAnswer) {
        renderAnswerMarkdown("No output yet.");
      } else if (hasHtmlMarkup) {
        $("answer").innerHTML = savedAnswer;
        if (typeof enhanceAnswerCodeBlocks === "function") enhanceAnswerCodeBlocks();
        if (typeof enhanceCitationLinks === "function") enhanceCitationLinks();
      } else {
        // Backward compatibility: older sessions may store markdown/plain text in answerHtml.
        renderAnswerMarkdown(savedAnswer);
      }
      renderAnswerNotes(s.data?.answerNotes || "No notes yet.");
      state.queries = Array.isArray(s.data?.queries) ? s.data.queries : [];
      state.sources = Array.isArray(s.data?.sources) ? s.data.sources : [];
      state.mediaImages = Array.isArray(s.data?.mediaImages) ? s.data.mediaImages : [];
      state.mediaVideos = Array.isArray(s.data?.mediaVideos) ? s.data.mediaVideos : [];
      state.criticReport = s.data?.criticReport || null;
      state.followups = Array.isArray(s.data?.followups) ? s.data.followups : [];
      state.turns = Array.isArray(s.data?.turns) ? s.data.turns : [];
      state.agentBrief = String(s.data?.agentBrief || "");
      state.thinking = Array.isArray(s.data?.thinking) ? s.data.thinking : [];
      state.logs = Array.isArray(s.data?.logs) ? s.data.logs : [];
      renderQueries();
      renderSources();
      renderAnswerMedia();
      renderFollowups();
      renderTurns();
      renderThinking();
      renderLogs();
      renderConversationTree();
      setStatus("Session loaded.");
      showResearchView(); // Toggle to research view on load
      saveUiState();
    }
