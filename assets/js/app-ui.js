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
      const item = state.discovery.slice(0, DISCOVERY_VISIBLE)[idx];
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
      setupVoiceInput();
      refreshModels();
      if (uiState?.isSearchCollapsed) collapseChat();
      else handleChatVisibility();

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
    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('active');
    }

    function toggleSettings() {
      const modal = document.getElementById('settingsModal');
      modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
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
      if (state.busy) return;
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

    // Auto-resize textarea and manage send button state
    const queryInput = document.getElementById('userQuery');
    const runBtn = document.getElementById('runBtn');

    function updateInpState() {
      if (queryInput && runBtn) {
        const hasText = queryInput.value.trim().length > 0;
        runBtn.disabled = !hasText || state.busy;
        runBtn.style.opacity = hasText ? "1" : "0.5";
      }
    }

    if (queryInput) {
      queryInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        updateInpState();
        saveUiState();
      });
      updateInpState(); // Initial check
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDeepResearchView();
    });
    addListenerIfPresent("deepViewModal", "click", (e) => {
      if (e.target && e.target.id === "deepViewModal") closeDeepResearchView();
    });

    // Settings Bridge (Removed conflicting loops)
    // Buttons now call actual backend functions directly
  
