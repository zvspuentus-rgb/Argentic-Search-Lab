    function clearAllHistory() {
      const ok = window.confirm("Delete all saved sessions from local storage?");
      if (!ok) return;
      setBusy(false);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch { }
      state.sessions = [];
      state.currentSessionId = null;
      renderSessions();
      renderConversationTree();
      startNewSession();
      setStatus("History deleted.");
    }

    function fullResetAppData() {
      const ok = window.confirm("Full reset? This will delete sessions and all saved settings.");
      if (!ok) return;
      setBusy(false);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SETTINGS_KEY);
        localStorage.removeItem(UI_STATE_KEY);
      } catch { }
      window.location.reload();
    }

    const addListenerIfPresent = (id, event, handler) => {
      const el = $(id);
      if (el) el.addEventListener(event, handler);
    };

    addListenerIfPresent("testBtn", "click", async () => {
      if (state.busy) return;
      try {
        setBusy(true);
        state.logs = [];
        state.debug = [];
        state.flow = createFlowState();
        renderLogs();
        renderFlow();
        renderDebug();
        setStatus("Testing connections...");
        await testConnections();
        setStatus("Connection test passed.");
      } catch (err) {
        addLog("health", err.message || String(err), "err");
        setStatus(`Connection test failed: ${err.message}`);
      } finally {
        setBusy(false);
      }
    });

    addListenerIfPresent("clearDebugBtn", "click", () => {
      state.debug = [];
      renderDebug();
    });
    addListenerIfPresent("saveSessionBtn", "click", () => {
      saveSession();
      setStatus("Session saved.");
    });
    addListenerIfPresent("newSessionBtn", "click", startNewSession);
    addListenerIfPresent("newConversationBtn", "click", startNewSession);
    addListenerIfPresent("newConversationBtnRail", "click", startNewSession);
    addListenerIfPresent("clearHistoryBtn", "click", clearAllHistory);
    addListenerIfPresent("clearHistoryBtn2", "click", clearAllHistory);
    addListenerIfPresent("clearHistoryBtnRail", "click", clearAllHistory);
    addListenerIfPresent("fullResetBtn", "click", fullResetAppData);
    addListenerIfPresent("fullResetBtnRail", "click", fullResetAppData);
    addListenerIfPresent("convoSearch", "input", renderConversationTree);

    const sessionsListEl = $("sessionsList");
    if (sessionsListEl) {
      sessionsListEl.addEventListener("click", (e) => {
        if (e.target.closest(".session-actions")) return;
        const btn = e.target.closest(".session-item");
        if (!btn) return;
        const id = btn.dataset.sid;
        if (!id) return;
        loadSessionById(id);
      });
    }

    const conversationTreeEl = $("conversationTree");
    if (conversationTreeEl) {
      conversationTreeEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.sid;
        if (!id) return;
        if (action === "open") loadSessionById(id);
        if (action === "rename") renameSessionById(id);
        if (action === "delete") {
          const ok = window.confirm("Delete this conversation?");
          if (!ok) return;
          removeSessionById(id);
        }
      });
    }
    const doRefreshDiscovery = async () => {
      try {
        await loadDiscovery($("searchUrl").value.trim(), state.currentDiscoveryCategory || "tech");
        setStatus("Discovery refreshed.");
      } catch (err) {
        addDebug("discovery", `Refresh failed: ${err.message}`, "warn");
      }
    };
    addListenerIfPresent("refreshDiscoveryBtn", "click", doRefreshDiscovery);
    addListenerIfPresent("refreshDiscoveryBtn2", "click", doRefreshDiscovery);
    addListenerIfPresent("discoveryList", "click", (e) => {
      const link = e.target.closest("a");
      if (link) return;
      const card = e.target.closest(".discover-item");
      if (!card) return;
      const idx = Number(card.dataset.didx);
      if (!Number.isInteger(idx) || idx < 0) return;
      const visible = Math.max(6, Math.min(48, Number(state.discoveryCount) || DISCOVERY_VISIBLE));
      const item = state.discovery.slice(0, visible)[idx];
      if (!item) return;
      explainDiscoveryItem(item);
    });
    addListenerIfPresent("followupsList", "click", (e) => {
      const target = e.target.closest(".followup-item");
      if (!target) return;
      const q = target.dataset.query || target.textContent || "";
      $("userQuery").value = q.trim();
      if ($("fastFollowups")?.checked) {
        runFastFollowupPipeline(q);
      } else {
        runPipeline();
      }
    });

    renderLogs();
    renderFlow();
    renderDebug();
    renderQueries();
    renderSources();
    renderAnswerMedia();
    bindMediaSidecarScrollIsolation();
    renderFollowups();
    renderThinking();
    renderDiscovery();
    bindSettingsPersistence();
    (async () => {
      loadSettingsFromStorage();
      if ($("settingsState")) $("settingsState").textContent = "settings: loaded";
      loadSessionsFromStorage();
      renderSessions();
      renderConversationTree();

      const uiState = loadUiState();
      state.currentDiscoveryCategory = uiState?.currentDiscoveryCategory || "tech";
      if (uiState?.currentFocus) {
        window.currentFocus = uiState.currentFocus;
        const activeBtn = document.querySelector(`.focus-btn[onclick*="'${uiState.currentFocus}'"]`);
        if (activeBtn) setSearchFocus(uiState.currentFocus, activeBtn);
      }

      // Auto-load Discovery content immediately for the landing page
      try {
        await loadDiscovery($("searchUrl").value.trim(), state.currentDiscoveryCategory);
      } catch (err) {
        addDebug("discovery", `Discovery failed: ${err.message}`, "warn");
      }

      if (uiState?.currentSessionId && state.sessions.some((s) => s.id === uiState.currentSessionId)) {
        loadSessionById(uiState.currentSessionId);
      } else if (state.sessions.length) {
        loadSessionById(state.sessions[0].id);
      } else {
        startNewSession();
        if (typeof uiState?.draftQuery === "string" && $("userQuery")) {
          $("userQuery").value = uiState.draftQuery;
        }
      }

      updateAnswerMeta();
      renderAttachmentTray();
      setupVoiceInput();
      refreshModels();
      const searchContainer = $("searchContainer");
      if (searchContainer) {
        if (uiState?.isSearchCompact) searchContainer.classList.add("compact");
        if (uiState?.isSearchDockedRight) searchContainer.classList.add("dock-right");
      }
      if (uiState?.isSearchCollapsed) collapseChat();
      else handleChatVisibility();
      syncSidebarToggles();

      // Global click outside to collapse
      document.addEventListener('click', (e) => {
        const container = document.getElementById("searchContainer");
        const trigger = document.getElementById("chatTrigger");
        if (!container || !trigger) return;
        if (!container.contains(e.target) && !trigger.contains(e.target) && !container.classList.contains('collapsed')) {
          if ($("userQuery").value.trim() === "") {
            // Only collapse if we are in research view. If welcome is visible, keep search prominent.
            const welcome = document.getElementById("welcomeView");
            if (welcome && welcome.style.display === "none") {
              collapseChat();
            }
          }
        }
      });
    })();

    /* UI Navigation & Interaction - Modern Overhaul Overrides */
    function bindMediaSidecarScrollIsolation() {
      const ids = ["mediaVideosSection", "mediaImagesSection"];
      ids.forEach((id) => {
        const section = $(id);
        if (!section || section.dataset.scrollBound === "1") return;
        section.dataset.scrollBound = "1";
        section.addEventListener("wheel", (e) => {
          const scroller = section.querySelector(".media-scroll-container");
          if (!scroller) return;
          const hasOverflow = scroller.scrollHeight > scroller.clientHeight + 1;
          if (hasOverflow) {
            e.preventDefault();
            scroller.scrollTop += e.deltaY;
          }
          const nearBottom = !hasOverflow || (scroller.scrollTop + scroller.clientHeight) >= (scroller.scrollHeight - 120);
          if (nearBottom && typeof loadMoreMediaForPanel === "function") {
            loadMoreMediaForPanel(id === "mediaVideosSection" ? "videos" : "images");
          }
        }, { passive: false });
        section.addEventListener("scroll", () => {
          const scroller = section.querySelector(".media-scroll-container");
          if (!scroller) return;
          const hasOverflow = scroller.scrollHeight > scroller.clientHeight + 1;
          const nearBottom = !hasOverflow || (scroller.scrollTop + scroller.clientHeight) >= (scroller.scrollHeight - 120);
          if (nearBottom && typeof loadMoreMediaForPanel === "function") {
            loadMoreMediaForPanel(id === "mediaVideosSection" ? "videos" : "images");
          }
        }, { passive: true, capture: true });
      });
    }

    function syncSidebarToggles() {
      const sidebar = document.getElementById('sidebar');
      const topBtn = document.getElementById('sidebarToggleBtn');
      const edgeBtn = document.getElementById('sidebarEdgeToggle');
      const isOpen = !!sidebar?.classList.contains('active');
      if (topBtn) topBtn.classList.toggle('is-open', isOpen);
      if (edgeBtn) {
        edgeBtn.classList.toggle('is-open', isOpen);
        edgeBtn.textContent = isOpen ? "❮" : "❯";
        edgeBtn.title = isOpen ? "Close History" : "Open History";
      }
    }

    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      if (!sidebar) return;
      sidebar.classList.toggle('active');
      syncSidebarToggles();
    }

    function toggleSettings() {
      const modal = document.getElementById('settingsModal');
      modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
    }

    function showMiniToast(message = "Saved") {
      const toast = $("miniToast");
      if (!toast) return;
      toast.textContent = String(message || "Saved");
      toast.classList.add("show");
      clearTimeout(showMiniToast._timer);
      showMiniToast._timer = setTimeout(() => {
        toast.classList.remove("show");
      }, 1700);
    }

    function saveSettingsWithToast() {
      saveSettingsToStorage();
      setStatus("Settings saved for next refresh.");
      showMiniToast("Settings saved");
    }

    function toggleChatCompact() {
      const container = document.getElementById("searchContainer");
      if (!container) return;
      container.classList.toggle("compact");
      saveUiState();
    }

    function toggleChatDock() {
      const container = document.getElementById("searchContainer");
      if (!container) return;
      container.classList.toggle("dock-right");
      saveUiState();
    }

    function toggleSourcesLayout() {
      state.sourcesLayout = state.sourcesLayout === "rail" ? "row" : "rail";
      renderSources();
      saveSettingsToStorage();
    }

    function openFilePicker() {
      $("filePicker")?.click();
    }

    function labelForLanguageCode(code) {
      const map = {
        en: "English",
        he: "Hebrew",
        es: "Spanish",
        fr: "French",
        de: "German",
        it: "Italian",
        pt: "Portuguese",
        ru: "Russian",
        uk: "Ukrainian",
        ar: "Arabic",
        tr: "Turkish",
        fa: "Persian (Farsi)",
        hi: "Hindi",
        bn: "Bengali",
        ur: "Urdu",
        zh: "Chinese (Simplified)",
        ja: "Japanese",
        ko: "Korean",
        id: "Indonesian",
        vi: "Vietnamese",
        th: "Thai",
        pl: "Polish",
        nl: "Dutch",
        sv: "Swedish"
      };
      return map[String(code || "").toLowerCase()] || "English";
    }

    async function improvePromptDraft() {
      if (state.busy || state.promptEnhanceLock) return;
      const input = $("userQuery");
      if (!input) return;
      const draft = normalizeQuery(input.value || "");
      if (!draft) {
        setStatus("Write a draft prompt first.");
        return;
      }
      const lmBase = $("lmBase")?.value?.trim() || "";
      const model = $("modelName")?.value?.trim() || "";
      if (!lmBase || !model) {
        setStatus("LM endpoint/model is missing.");
        return;
      }
      const improveBtn = $("improvePromptBtn");
      const runBtn = $("runBtn");
      state.promptEnhanceLock = true;
      if (improveBtn) {
        improveBtn.disabled = true;
        improveBtn.dataset.defaultLabel = improveBtn.dataset.defaultLabel || improveBtn.textContent || "✨ Enhance Prompt";
        improveBtn.textContent = "⏳ Enhancing...";
      }
      if (runBtn) {
        runBtn.disabled = true;
        runBtn.classList.add("is-processing");
      }
      setStatus("Processing request... improving prompt");
      try {
        const targetLang = String($("enhancePromptLanguage")?.value || "en").toLowerCase();
        const langInstruction = targetLang === "auto"
          ? "Detect the draft language and return the improved prompt in that same language."
          : `Return the improved prompt in ${labelForLanguageCode(targetLang)}.`;
        const out = await lmChat({
          lmBase,
          payload: {
            model,
            temperature: 0.2,
            max_tokens: 900,
            messages: [
              {
                role: "system",
                content: `Rewrite the user draft into a concise, high-quality research prompt. Preserve intent, constraints, dates, and key entities. ${langInstruction} Return only the improved prompt text.`
              },
              { role: "user", content: draft }
            ]
          }
        });
        const improved = normalizeQuery(out?.choices?.[0]?.message?.content || "");
        if (!improved) throw new Error("No improved prompt returned.");
        input.value = improved;
        input.style.height = "auto";
        input.style.height = (input.scrollHeight) + "px";
        updateInpState();
        saveUiState();
        setStatus("Prompt improved.");
      } catch (err) {
        setStatus(`Prompt enhancement failed: ${err.message}`);
        addDebug("prompt", `Enhance failed: ${err.message}`, "warn");
      } finally {
        state.promptEnhanceLock = false;
        if (improveBtn) {
          improveBtn.disabled = false;
          improveBtn.textContent = improveBtn.dataset.defaultLabel || "✨ Enhance Prompt";
        }
        if (runBtn) {
          runBtn.classList.remove("is-processing");
        }
        updateInpState();
      }
    }

    function renderAttachmentTray() {
      const tray = $("attachmentTray");
      if (!tray) return;
      const items = Array.isArray(state.attachments) ? state.attachments : [];
      if (!items.length) {
        tray.style.display = "none";
        tray.innerHTML = "";
        updateInpState();
        return;
      }
      tray.style.display = "flex";
      tray.innerHTML = items.map((a, idx) => `
        <span class="attachment-chip">
          <span>${escapeHtml(a.name || "file")} (${escapeHtml(a.kind || "file")})</span>
          <button type="button" data-remove-attachment="${idx}" aria-label="Remove attachment">×</button>
        </span>
      `).join("");
      updateInpState();
    }

    function removeAttachmentAt(idx) {
      if (!Array.isArray(state.attachments)) state.attachments = [];
      if (idx < 0 || idx >= state.attachments.length) return;
      state.attachments.splice(idx, 1);
      renderAttachmentTray();
      saveSession();
    }

    async function normalizeUploadedFile(file) {
      const maxChars = 5000;
      const isImage = String(file.type || "").startsWith("image/");
      const textLike = /^(text\/|application\/(json|xml|javascript))/.test(file.type || "") ||
        /\.(txt|md|markdown|json|csv|tsv|html|xml|js|ts|py|java|c|cpp)$/i.test(file.name || "");
      if (isImage) {
        return {
          name: file.name,
          size: file.size,
          type: file.type,
          kind: "image",
          text: `Image attached: ${file.name}.`
        };
      }
      if (textLike) {
        const raw = await file.text();
        return {
          name: file.name,
          size: file.size,
          type: file.type || "text/plain",
          kind: "text",
          text: String(raw || "").replace(/\s+/g, " ").trim().slice(0, maxChars)
        };
      }
      return {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        kind: "file",
        text: `Binary file attached: ${file.name}.`
      };
    }

    async function handleFilePickerChange(e) {
      const files = [...(e?.target?.files || [])];
      if (!files.length) return;
      if (!Array.isArray(state.attachments)) state.attachments = [];
      const next = [];
      for (const file of files.slice(0, 8)) {
        try {
          next.push(await normalizeUploadedFile(file));
        } catch (err) {
          addDebug("upload", `Failed to read ${file?.name || "file"}: ${err.message}`, "warn");
        }
      }
      state.attachments = [...state.attachments, ...next].slice(0, 8);
      renderAttachmentTray();
      setStatus(`${next.length} attachment(s) added.`);
      saveSession();
      e.target.value = "";
    }

    // Bubble Chat Logic
    function expandChat() {
      const container = document.getElementById("searchContainer");
      const trigger = document.getElementById("chatTrigger");
      if (!container || !trigger) return;
      container.classList.remove("collapsed");
      trigger.style.display = "none";
      const inp = document.getElementById("userQuery");
      if (inp) inp.focus();
      saveUiState();
    }

    function collapseChat() {
      const container = document.getElementById("searchContainer");
      const trigger = document.getElementById("chatTrigger");
      if (!container || !trigger) return;
      container.classList.add("collapsed");
      trigger.style.display = "flex";
      saveUiState();
    }

    function handleChatVisibility() {
      const welcome = document.getElementById("welcomeView");
      const research = document.getElementById("researchFeed");

      // If we are on welcome screen AND no active session is loaded, SHOW search
      if (welcome && welcome.style.display !== "none" && !state.currentSessionId) {
        expandChat();
      } else if (welcome && welcome.style.display !== "none") {
        // Even if we have a session, if welcome is visible, we might want search ready
        expandChat();
      }
    }

    function showResearchView() {
      document.getElementById('welcomeView').style.display = 'none';
      document.getElementById('discoveryView').style.display = 'none';
      document.getElementById('researchFeed').style.display = 'flex';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      saveUiState();
    }

    /* Focus Mode Logic */
    window.currentFocus = 'all';
    function setSearchFocus(focus, btn) {
      window.currentFocus = focus;

      // UI Update
      document.querySelectorAll('.focus-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Logic Mapping to Source Lanes
      const lanes = {
        'all': ['web', 'images', 'videos'],
        'academic': ['academic'],
        'social': ['social'],
        'media': ['images', 'videos'],
        'writing': [] // Writing skips search in many implementations
      };

      const selectedLanes = lanes[focus] || ['web'];
      document.querySelectorAll('.source-lane').forEach(el => {
        el.checked = selectedLanes.includes(el.value);
      });

      // Feedback in status
      setStatus(`Focus set to: ${focus}`);
      saveSettingsToStorage();
      saveUiState();
    }

    function updateInpState() {
      const queryInput = document.getElementById('userQuery');
      const runBtn = document.getElementById('runBtn');
      if (queryInput && runBtn) {
        const hasText = queryInput.value.trim().length > 0;
        const hasAttachments = Array.isArray(state.attachments) && state.attachments.length > 0;
        runBtn.disabled = (!hasText && !hasAttachments) || state.busy || state.promptEnhanceLock;
        runBtn.style.opacity = (hasText || hasAttachments) ? "1" : "0.5";
      }
    }

    // Auto-resize textarea and manage send button state
    const queryInput = document.getElementById('userQuery');
    if (queryInput) {
      queryInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        updateInpState();
        saveUiState();
      });
      updateInpState(); // Initial check
    }

    addListenerIfPresent("filePicker", "change", handleFilePickerChange);
    addListenerIfPresent("attachmentTray", "click", (e) => {
      const btn = e.target.closest("[data-remove-attachment]");
      if (!btn) return;
      const idx = Number(btn.dataset.removeAttachment);
      if (!Number.isInteger(idx)) return;
      removeAttachmentAt(idx);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDeepResearchView();
    });
    addListenerIfPresent("deepViewModal", "click", (e) => {
      if (e.target && e.target.id === "deepViewModal") closeDeepResearchView();
    });

    // Settings Bridge (Removed conflicting loops)
    // Buttons now call actual backend functions directly
  
