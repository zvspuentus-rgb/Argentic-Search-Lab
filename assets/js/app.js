    const $ = (id) => document.getElementById(id);
    const FLOW_STAGES = [
      { id: "analyzer", label: "Analyzer" },
      { id: "planner", label: "Planner" },
      { id: "refiner", label: "Refiner" },
      { id: "search", label: "Search" },
      { id: "critic", label: "Critic" },
      { id: "synthesis", label: "Writing" },
      { id: "copilot", label: "Copilot" }
    ];

    function createFlowState() {
      return Object.fromEntries(FLOW_STAGES.map((s) => [s.id, "idle"]));
    }

    const state = {
      busy: false,
      logs: [],
      sources: [],
      media: [],
      mediaImages: [],
      mediaVideos: [],
      criticReport: null,
      thinking: [],
      queries: [],
      followups: [],
      lastUserQuery: "",
      agentBrief: "",
      discovery: [],
      sessions: [],
      currentSessionId: null,
      debug: [],
      flow: createFlowState(),
      answerAnimToken: 0,
      busySince: 0,
      executionModeResolved: "auto"
    };

    const STORAGE_KEY = "agentic_search_lab_sessions_v1";
    const SETTINGS_KEY = "agentic_search_lab_settings_v1";
    const UI_STATE_KEY = "agentic_search_lab_ui_state_v1";
    const DISCOVERY_VISIBLE = 12;

    const DEPTH_PRESETS = {
      speed: { queryCount: 2, perQueryResults: 3, maxSecondPassQueries: 1, contextSources: 8 },
      balanced: { queryCount: 4, perQueryResults: 4, maxSecondPassQueries: 2, contextSources: 12 },
      analytic: { queryCount: 5, perQueryResults: 6, maxSecondPassQueries: 2, contextSources: 16, temperature: 0.3 },
      systematic: { queryCount: 8, perQueryResults: 5, maxSecondPassQueries: 4, contextSources: 20, temperature: 0.1 },
      deep: { queryCount: 6, perQueryResults: 5, maxSecondPassQueries: 3, contextSources: 20 }
    };

    const DEEP_INTENT_RX = /\b(deep|research|analysis|analyze|systematic|comprehensive)\b/i;

    function resolveExecutionMode(userQuery) {
      const selected = $("searchMode")?.value || "auto";
      if (selected === "quick" || selected === "deep") return selected;
      return DEEP_INTENT_RX.test(String(userQuery || "")) ? "deep" : "quick";
    }

    function renderExecutionModeBadge(mode) {
      state.executionModeResolved = mode;
      const el = $("pipelineModeBadge");
      if (!el) return;
      el.textContent = mode;
      el.classList.remove("text-bg-dark", "text-bg-info", "text-bg-primary");
      if (mode === "quick") el.classList.add("text-bg-info");
      else if (mode === "deep") el.classList.add("text-bg-primary");
      else el.classList.add("text-bg-dark");
    }

    /* Dynamic Model Fetching */
    async function refreshModels() {
      const lmBase = $("lmBase").value.trim();
      try {
        setStatus("Fetching models from LM Studio...");
        const res = await fetch(`${lmBase.replace(/\/$/, "")}/models`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = (data.data || []).map(m => m.id);

        const select = $("modelName");
        const current = select.value;
        select.innerHTML = "";

        if (models.length === 0) {
          select.innerHTML = '<option value="">No models found</option>';
        } else {
          models.forEach(m => {
            const opt = document.createElement("option");
            opt.value = opt.textContent = m;
            if (m === current) opt.selected = true;
            select.appendChild(opt);
          });
        }
        setStatus(`Found ${models.length} models.`);
        addLog("health", `Fetched ${models.length} models from LM Studio.`, "ok");
      } catch (err) {
        setStatus(`Model fetch failed: ${err.message}`);
        addLog("health", `Failed to fetch models: ${err.message}`, "warn");
      }
    }

    const WEAK_DOMAIN_RX = /(medium\.com|reddit\.com|pinterest\.|facebook\.com|instagram\.com|tiktok\.com|udemy\.com|coursera\.org|eventbrite\.|johnbryce\.co\.il)/;
    const STRONG_DOMAIN_RX = /(github\.com|gitlab\.com|docs\.|openai\.com|anthropic\.com|aws\.amazon\.com|cloud\.google\.com|google\.github\.io|microsoft\.com|arxiv\.org|ieee\.org|acm\.org)/;

    function nowTag() {
      return new Date().toLocaleTimeString();
    }

    function setBusy(on) {
      state.busy = on;
      state.busySince = on ? Date.now() : 0;
      if ($("runBtn")) {
        $("runBtn").disabled = on || ($("userQuery")?.value.trim().length === 0);
      }
      if ($("testBtn")) $("testBtn").disabled = on;
      // ... (other disabled states)
      const pill = $("busyPill");
      if (pill) {
        pill.textContent = on ? "running" : "idle";
        pill.classList.remove("text-bg-secondary", "text-bg-success");
        pill.classList.add(on ? "text-bg-success" : "text-bg-secondary");
      }
    }

    function recoverFromStuckBusy() {
      if (!state.busy) return false;
      const elapsed = Date.now() - (state.busySince || 0);
      if (elapsed < 15000) return false;
      addLog("health", "Recovered from stale busy lock.", "warn");
      setBusy(false);
      return true;
    }

    function setStatus(message) {
      $("statusText").textContent = message;
    }

    function markdownToSafeHtml(mdText) {
      const raw = String(mdText || "");
      if (window.marked && typeof window.marked.parse === "function") {
        window.marked.setOptions({ gfm: true, breaks: true, mangle: false, headerIds: false });
        const html = window.marked.parse(raw);
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
          return window.DOMPurify.sanitize(html);
        }
        return html;
      }
      return `<pre>${escapeHtml(raw)}</pre>`;
    }

    function renderAnswerMarkdown(mdText) {
      const el = $("answer");
      if (!el) return;
      el.innerHTML = markdownToSafeHtml(mdText);
      enhanceAnswerCodeBlocks();
    }

    function enhanceAnswerCodeBlocks() {
      const root = $("answer");
      if (!root) return;
      const blocks = root.querySelectorAll("pre");
      for (const pre of blocks) {
        if (pre.querySelector(".copy-code-btn")) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "copy-code-btn";
        btn.textContent = "Copy";
        btn.addEventListener("click", async () => {
          const text = pre.innerText || "";
          try {
            await navigator.clipboard.writeText(text.trim());
            btn.textContent = "Copied";
            setTimeout(() => { btn.textContent = "Copy"; }, 1200);
          } catch {
            btn.textContent = "Failed";
            setTimeout(() => { btn.textContent = "Copy"; }, 1200);
          }
        });
        pre.appendChild(btn);
      }
    }

    function getSelectedSourceProfiles() {
      const lanes = [...document.querySelectorAll(".source-lane:checked")].map((el) => el.value);
      return lanes.length ? lanes : ["web"];
    }

    function renderAnswerNotes(notesText) {
      const el = $("answerNotes");
      if (!el) return;
      el.textContent = String(notesText || "No notes yet.");
    }

    function renderThinking() {
      const el = $("answerThinking");
      if (!el) return;
      if (!state.thinking.length) {
        el.textContent = "No model thinking yet.";
        return;
      }
      el.textContent = state.thinking
        .slice(0, 40)
        .map((x) => `[${x.time}] ${x.stage}\n${x.text}`)
        .join("\n\n");
    }

    function currentThinkingMode() {
      return $("thinkingMode")?.value || "show";
    }

    function addThinking(stage, text) {
      if (currentThinkingMode() === "off") return;
      const cleaned = String(text || "").trim();
      if (!cleaned) return;
      state.thinking.unshift({ stage, text: cleaned.slice(0, 6000), time: nowTag() });
      if (state.thinking.length > 60) state.thinking.length = 60;
      renderThinking();
    }

    function extractThinkTags(text) {
      const raw = String(text || "");
      const matches = [...raw.matchAll(/<think>([\s\S]*?)<\/think>/gi)];
      return matches.map((m) => String(m[1] || "").trim()).filter(Boolean).join("\n");
    }

    function captureModelThinking(stage, out) {
      const msg = out?.choices?.[0]?.message || {};
      const fromField = typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
      const fromReasoning = typeof msg.reasoning === "string" ? msg.reasoning : "";
      const fromTags = extractThinkTags(msg.content || "");
      const merged = [fromField, fromReasoning, fromTags].filter(Boolean).join("\n").trim();
      if (merged) addThinking(stage, merged);
    }

    function stripCodeFences(text) {
      return String(text || "").replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
    }

    function tryJsonParse(text) {
      try { return JSON.parse(text); } catch { return null; }
    }

    function jsonCandidates(text) {
      const src = String(text || "");
      const out = [];
      const fenced = stripCodeFences(src);
      if (fenced && fenced !== src) out.push(fenced);
      out.push(src);

      const addBalanced = (openCh, closeCh) => {
        let depth = 0;
        let start = -1;
        let inStr = false;
        let esc = false;
        for (let i = 0; i < src.length; i++) {
          const ch = src[i];
          if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === "\\") { esc = true; continue; }
            if (ch === "\"") inStr = false;
            continue;
          }
          if (ch === "\"") { inStr = true; continue; }
          if (ch === openCh) {
            if (depth === 0) start = i;
            depth += 1;
          } else if (ch === closeCh && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
              out.push(src.slice(start, i + 1));
              start = -1;
            }
          }
        }
      };
      addBalanced("{", "}");
      addBalanced("[", "]");
      return uniqueStrings(out.filter(Boolean));
    }

    async function parseContentAsJsonSmart({ lmBase, model, content, stage = "json", defaultValue = {} }) {
      const robust = $("robustJson")?.checked ?? true;
      const raw = String(content || "");
      const candidates = jsonCandidates(raw);

      for (const c of candidates) {
        const parsed = tryJsonParse(c);
        if (parsed && typeof parsed === "object") return parsed;
        const cleaned = c
          .replace(/[“”]/g, "\"")
          .replace(/[‘’]/g, "'")
          .replace(/,\s*([}\]])/g, "$1");
        const parsed2 = tryJsonParse(cleaned);
        if (parsed2 && typeof parsed2 === "object") return parsed2;
      }

      if (!robust) {
        addDebug(stage, `JSON parse failed (robust off).`, "err");
        return defaultValue;
      }

      try {
        const repairOut = await lmChat({
          lmBase,
          payload: {
            model,
            temperature: 0,
            max_tokens: 1200,
            messages: [
              {
                role: "system",
                content: "Convert noisy/partial text into valid strict JSON object only. Do not explain."
              },
              {
                role: "user",
                content: raw.slice(0, 12000)
              }
            ]
          }
        });
        captureModelThinking(`${stage}-repair`, repairOut);
        const fixed = repairOut?.choices?.[0]?.message?.content || "";
        const parsed = jsonCandidates(fixed).map(tryJsonParse).find((x) => x && typeof x === "object");
        if (parsed) {
          addDebug(stage, "JSON repaired by fallback parser.", "warn");
          return parsed;
        }
      } catch (err) {
        addDebug(stage, `JSON repair failed: ${err.message}`, "err");
      }

      addDebug(stage, "JSON parse fallback returned defaults.", "warn");
      return defaultValue;
    }

    function updateAnswerMeta() {
      if ($("answerSourcesBadge")) $("answerSourcesBadge").textContent = `sources: ${state.sources.length}`;
      if ($("answerQueriesBadge")) $("answerQueriesBadge").textContent = `queries: ${state.queries.length}`;
      if ($("answerMediaBadge")) $("answerMediaBadge").textContent = `media: ${state.mediaImages.length + state.mediaVideos.length}`;
      if ($("criticScoreBadge")) {
        const score = Number(state.criticReport?.overallScore);
        const badge = $("criticScoreBadge");
        badge.classList.remove("text-bg-dark", "text-bg-success", "text-bg-warning", "text-bg-danger");
        if (!Number.isFinite(score)) {
          badge.textContent = "critic: --";
          badge.classList.add("text-bg-dark");
        } else if (score >= 75) {
          badge.textContent = `critic: ${score}/100`;
          badge.classList.add("text-bg-success");
        } else if (score >= 55) {
          badge.textContent = `critic: ${score}/100`;
          badge.classList.add("text-bg-warning");
        } else {
          badge.textContent = `critic: ${score}/100`;
          badge.classList.add("text-bg-danger");
        }
      }
    }

    function inferMediaType(url) {
      const v = String(url || "").toLowerCase();
      if (/\.(png|jpg|jpeg|gif|webp|avif)(\?|$)/.test(v)) return "image";
      if (/youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com/.test(v)) return "video";
      if (/video/.test(v)) return "video";
      return "link";
    }

    function previewImageForUrl(item) {
      const thumb = String(item?.thumbnail || item?.img_src || "").trim();
      if (thumb) return thumb;
      const raw = String(item?.url || "").trim();
      if (!raw) return "";
      try {
        const normalized = new URL(raw).toString();
        return `https://image.thum.io/get/width/900/noanimate/${encodeURIComponent(normalized)}`;
      } catch {
        return "";
      }
    }

    function faviconForUrl(url) {
      try {
        const host = new URL(String(url || "")).hostname;
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
      } catch {
        return "";
      }
    }

    function renderMediaList(rootId, items, emptyText) {
      const root = $(rootId);
      if (!root) return;
      root.innerHTML = "";
      if (!items.length) {
        root.innerHTML = `<div class="mono" style="color:#9db0bc">${escapeHtml(emptyText)}</div>`;
        return;
      }

      const container = document.createElement("div");
      container.className = "media-scroll-container";

      for (const item of items.slice(0, 12)) {
        const t = item.mediaType || inferMediaType(item.url);
        const thumb = previewImageForUrl(item);
        const icon = faviconForUrl(item.url);
        const card = document.createElement("article");
        card.className = "media-card";
        card.innerHTML = `
          ${thumb ? `<img class="media-thumb" src="${escapeAttr(thumb)}" alt="${escapeAttr(item.title || "media")}" loading="lazy" onerror="this.onerror=null;this.src='${escapeAttr(icon)}';" />` : '<div class="media-thumb"></div>'}
          <div class="media-body">
            <div class="media-label">${escapeHtml(t)}</div>
            <h4 class="media-title">${escapeHtml(item.title || "Untitled")}</h4>
            <a class="media-link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url || "")}</a>
          </div>
        `;
        container.appendChild(card);
      }
      root.appendChild(container);
    }

    function renderAnswerMedia() {
      const hasMedia = state.mediaImages.length > 0 || state.mediaVideos.length > 0;
      const section = $("mediaSection");
      if (section) section.style.display = hasMedia ? "block" : "none";
      renderMediaList("answerMediaImagesGrid", state.mediaImages, "No images yet.");
      renderMediaList("answerMediaVideosGrid", state.mediaVideos, "No videos yet.");
      updateAnswerMeta();
    }

    function stopAnswerAnimation() {
      state.answerAnimToken += 1;
      const el = $("answer");
      if (el) el.classList.remove("answer-typing");
    }

    function animateAnswerMarkdown(mdText) {
      const full = String(mdText || "");
      const el = $("answer");
      if (!el) return Promise.resolve();
      const token = ++state.answerAnimToken;
      el.classList.add("answer-typing");
      const chunk = Math.max(10, Math.ceil(full.length / 150));
      let idx = 0;

      return new Promise((resolve) => {
        const timer = setInterval(() => {
          if (token !== state.answerAnimToken) {
            clearInterval(timer);
            resolve();
            return;
          }
          idx = Math.min(full.length, idx + chunk);
          renderAnswerMarkdown(full.slice(0, idx));
          if (idx >= full.length) {
            clearInterval(timer);
            el.classList.remove("answer-typing");
            resolve();
          }
        }, 18);
      });
    }

    function updateFlowFromLog(stage, level) {
      const normalized = String(stage || "").toLowerCase();
      const map = {
        analyzer: "analyzer",
        planner: "planner",
        refiner: "refiner",
        search: "search",
        "search-2": "search",
        critic: "critic",
        synthesis: "synthesis",
        copilot: "copilot"
      };
      const id = map[normalized];

      if (normalized === "done") {
        for (const k of Object.keys(state.flow)) {
          if (state.flow[k] !== "error") state.flow[k] = "done";
        }
        return;
      }

      if (normalized === "error") {
        const active = Object.keys(state.flow).find((k) => state.flow[k] === "active");
        if (active) state.flow[active] = "error";
        return;
      }

      if (!id) return;
      const idx = FLOW_STAGES.findIndex((s) => s.id === id);
      for (let i = 0; i < idx; i++) {
        const sid = FLOW_STAGES[i].id;
        if (state.flow[sid] !== "error") state.flow[sid] = "done";
      }
      state.flow[id] = level === "err" ? "error" : "active";
    }

    function addLog(stage, message, level = "ok") {
      state.logs.unshift({ stage, message, level, time: nowTag() });
      updateFlowFromLog(stage, level);
      renderLogs();
      renderFlow();
    }

    function addDebug(stage, message, level = "ok") {
      state.debug.unshift({ stage, message, level, time: nowTag() });
      if (state.debug.length > 220) state.debug.length = 220;
      renderDebug();
    }

    function renderLogs() {
      const root = $("logs");
      root.innerHTML = "";
      if (!state.logs.length) {
        root.innerHTML = '<div class="mono" style="color:#9db0bc">No events yet.</div>';
        return;
      }
      for (const item of state.logs.slice(0, 80)) {
        const div = document.createElement("div");
        div.className = `log-item ${item.level}`;
        div.innerHTML = `
          <div class="log-head"><span>${escapeHtml(item.stage)}</span><span>${escapeHtml(item.time)}</span></div>
          <div class="mono">${escapeHtml(item.message)}</div>
        `;
        root.appendChild(div);
      }
    }

    function renderFlow() {
      const root = $("agentFlow");
      if (!root) return;
      root.innerHTML = "";
      for (const stage of FLOW_STAGES) {
        const status = state.flow[stage.id] || "idle";
        const item = document.createElement("div");
        item.className = `flow-badge ${status} ${status === 'running' ? 'active' : ''}`;
        item.innerHTML = `
          <span>${escapeHtml(stage.label)}</span>
        `;
        root.appendChild(item);
      }
    }

    function renderDebug() {
      const root = $("debugConsole");
      if (!root) return;
      root.innerHTML = "";
      if (!state.debug.length) {
        root.innerHTML = '<div class="mono" style="color:#9db0bc">No debug events yet.</div>';
        return;
      }
      for (const item of state.debug.slice(0, 120)) {
        const div = document.createElement("div");
        div.className = `debug-item ${item.level}`;
        div.innerHTML = `
          <div class="log-head"><span>${escapeHtml(item.stage)}</span><span>${escapeHtml(item.time)}</span></div>
          <pre class="debug-body">${escapeHtml(item.message)}</pre>
        `;
        root.appendChild(div);
      }
    }

    function renderQueries() {
      const list = $("queriesList");
      list.innerHTML = "";
      if (!state.queries.length) {
        const li = document.createElement("li");
        li.textContent = "No generated queries yet.";
        list.appendChild(li);
        return;
      }
      for (const q of state.queries) {
        const li = document.createElement("li");
        li.textContent = q;
        list.appendChild(li);
      }
      updateAnswerMeta();
    }

    function renderSources() {
      const root = $("sources");
      root.innerHTML = "";
      if (!state.sources.length) {
        root.innerHTML = '<div class="mono" style="color:#9db0bc">No sources collected yet.</div>';
        updateAnswerMeta();
        return;
      }
      for (const [i, src] of state.sources.entries()) {
        const card = document.createElement("article");
        card.className = "source-item";
        card.innerHTML = `
          <h4>[${i + 1}] ${escapeHtml(src.title || "Untitled")}</h4>
          <a href="${escapeAttr(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.url || "")}</a>
          <p>${escapeHtml(src.content || "")}</p>
        `;
        root.appendChild(card);
      }
      updateAnswerMeta();
    }

    function renderFollowups() {
      const root = $("followupsList");
      if (!root) return;
      root.innerHTML = "";
      if (!state.followups.length) {
        root.innerHTML = '<div class="mono" style="color:#9db0bc">No follow-up questions yet.</div>';
        return;
      }
      for (const q of state.followups.slice(0, 8)) {
        const btn = document.createElement("button");
        btn.className = "followup-item text-start";
        btn.type = "button";
        btn.textContent = q;
        btn.dataset.query = q;
        root.appendChild(btn);
      }
    }

    function renderDiscovery() {
      const root = $("discoveryGrid");
      if (!root) return;
      root.innerHTML = "";
      if (state.discoveryLoading) {
        root.innerHTML = `
          <div class="col-12 text-center p-5">
            <div class="spinner-border text-info" role="status"></div>
            <div class="mt-3 text-muted mono" style="font-size: 0.8rem;">Analyzing global tech trends...</div>
          </div>
        `;
        return;
      }
      if (!state.discovery.length) {
        root.innerHTML = '<div class="mono p-5 text-center" style="color:#9db0bc; width: 100%;">Finding trending tech stories...</div>';
        return;
      }
      for (const [idx, item] of state.discovery.slice(0, DISCOVERY_VISIBLE).entries()) {
        const mediaType = item.mediaType || inferMediaType(item.url);
        const thumb = previewImageForUrl(item);
        const icon = faviconForUrl(item.url);
        const col = document.createElement("div");
        col.className = "col-md-4 col-sm-6";
        col.innerHTML = `
          <article class="discover-item" data-didx="${idx}" onclick="explainDiscoveryItem(state.discovery[${idx}])">
            ${thumb ? `<img class="discover-thumb" src="${escapeAttr(thumb)}" alt="thumb" loading="lazy" onerror="this.onerror=null;this.src='${escapeAttr(icon)}';" />` : `<div class="discover-thumb d-flex align-items-center justify-content-center" style="background: rgba(255,255,255,0.03);"> ✨ </div>`}
            <div class="d-flex flex-column gap-1 flex-grow-1">
              <div class="badge rounded-pill align-self-start" style="background: rgba(120, 184, 255, 0.1); color: var(--accent-secondary); font-size: 0.6rem; text-transform: uppercase;">${escapeHtml(mediaType)}</div>
              <h4>${escapeHtml(item.title || "Untitled")}</h4>
              <p>${escapeHtml(item.content || "No description available.")}</p>
            </div>
          </article>
        `;
        root.appendChild(col);
      }
    }

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
        mode: $("mode").value,
        researchMode: $("researchMode").value,
        thinkingMode: $("thinkingMode").value,
        language: $("language").value,
        sourceLanes: getSelectedSourceProfiles(),
        copilotMode: $("copilotMode").checked,
        fastFollowups: $("fastFollowups")?.checked ?? true,
        autoRunDiscovery: $("autoRunDiscovery")?.checked ?? false,
        expAgentRelay: $("expAgentRelay")?.checked ?? true,
        expFastContextFetch: $("expFastContextFetch")?.checked ?? false,
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
      if ($("searchMode")) renderExecutionModeBadge($("searchMode").value || "auto");
      if (s.mode) $("mode").value = s.mode;
      if (s.researchMode) $("researchMode").value = s.researchMode;
      if (s.thinkingMode) $("thinkingMode").value = s.thinkingMode;
      if (s.language) $("language").value = s.language;
      if (s.language && $("languageModal")) $("languageModal").value = s.language;
      if (typeof s.copilotMode === "boolean") {
        $("copilotMode").checked = s.copilotMode;
        if ($("copilotBtn")) $("copilotBtn").checked = s.copilotMode;
      }
      if (typeof s.fastFollowups === "boolean" && $("fastFollowups")) $("fastFollowups").checked = s.fastFollowups;
      if (typeof s.autoRunDiscovery === "boolean" && $("autoRunDiscovery")) $("autoRunDiscovery").checked = s.autoRunDiscovery;
      if (typeof s.expAgentRelay === "boolean" && $("expAgentRelay")) $("expAgentRelay").checked = s.expAgentRelay;
      if (typeof s.expFastContextFetch === "boolean" && $("expFastContextFetch")) $("expFastContextFetch").checked = s.expFastContextFetch;
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
      const lanes = Array.isArray(s.sourceLanes) ? new Set(s.sourceLanes) : new Set(["web"]);
      document.querySelectorAll(".source-lane").forEach((el) => { el.checked = lanes.has(el.value); });
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

    function loadSettingsFromStorage() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        applySettingsSnapshot(parsed);
      } catch { }
    }

    function bindSettingsPersistence() {
      const ids = [
        "provider", "lmBase", "ollamaBase", "openaiBase", "openaiKey", "anthropicKey", "geminiKey",
        "modelName", "searchUrl", "searchMode", "mode", "researchMode", "thinkingMode", "language",
        "copilotMode", "fastFollowups", "autoRunDiscovery", "expAgentRelay", "expFastContextFetch", "llmParallel", "searchParallel", "maxOutTokens",
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
          answerHtml: $("answer").innerHTML,
          answerNotes: $("answerNotes").textContent || "",
          queries: state.queries,
          sources: state.sources,
          mediaImages: state.mediaImages,
          mediaVideos: state.mediaVideos,
          criticReport: state.criticReport,
          followups: state.followups,
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
      state.lastUserQuery = s.data?.userQuery || "";
      $("answer").innerHTML = s.data?.answerHtml || "No output yet.";
      renderAnswerNotes(s.data?.answerNotes || "No notes yet.");
      state.queries = Array.isArray(s.data?.queries) ? s.data.queries : [];
      state.sources = Array.isArray(s.data?.sources) ? s.data.sources : [];
      state.mediaImages = Array.isArray(s.data?.mediaImages) ? s.data.mediaImages : [];
      state.mediaVideos = Array.isArray(s.data?.mediaVideos) ? s.data.mediaVideos : [];
      state.criticReport = s.data?.criticReport || null;
      state.followups = Array.isArray(s.data?.followups) ? s.data.followups : [];
      state.agentBrief = String(s.data?.agentBrief || "");
      state.thinking = Array.isArray(s.data?.thinking) ? s.data.thinking : [];
      state.logs = Array.isArray(s.data?.logs) ? s.data.logs : [];
      renderQueries();
      renderSources();
      renderAnswerMedia();
      renderFollowups();
      renderThinking();
      renderLogs();
      renderConversationTree();
      setStatus("Session loaded.");
      showResearchView(); // Toggle to research view on load
      saveUiState();
    }

    function escapeHtml(text) {
      return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function escapeAttr(text) {
      return String(text ?? "").replaceAll('"', "%22");
    }

    function normalizeQuery(input) {
      return String(input || "")
        .replace(/[<>]{4,}/g, " ")
        .replace(/[_=-]{4,}/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function uniqueStrings(items) {
      const out = [];
      const seen = new Set();
      for (const item of items) {
        const key = String(item || "").trim();
        if (!key || seen.has(key.toLowerCase())) continue;
        seen.add(key.toLowerCase());
        out.push(key);
      }
      return out;
    }

    function domainFromUrl(url) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return host.replace(/^www\./, "");
      } catch {
        return "";
      }
    }

    function scoreSource(source, analyzer) {
      const domain = domainFromUrl(source.url);
      const text = `${source.title} ${source.content}`.toLowerCase();
      let score = 0;

      if (STRONG_DOMAIN_RX.test(domain)) score += 6;
      if (/(wikipedia\.org|ibm\.com|huggingface\.co|langchain\.com|python\.org)/.test(domain)) score += 2;
      if (WEAK_DOMAIN_RX.test(domain)) score -= 3;
      if (/(course|catalog|academy|marketing|sponsored|event|bootcamp)/i.test(source.title)) score -= 3;

      const len = String(source.content || "").trim().length;
      if (len > 260) score += 1.2;
      if (len < 90) score -= 1.8;

      const title = String(source.title || "");
      if (/20(2[4-9]|3[0-9])/.test(title + " " + source.content)) score += 0.8;

      const must = Array.isArray(analyzer?.mustInclude) ? analyzer.mustInclude : [];
      for (const kw of must) {
        const needle = String(kw || "").toLowerCase().trim();
        if (!needle) continue;
        if (text.includes(needle)) score += 1.35;
      }

      return score;
    }

    function isWeakSource(source) {
      const domain = domainFromUrl(source.url);
      const text = `${source.title || ""} ${source.content || ""}`.toLowerCase();
      if (!source.url || !/^https?:\/\//.test(source.url)) return true;
      if (WEAK_DOMAIN_RX.test(domain) && !/official|documentation|sdk|github|repository/.test(text)) return true;
      if (text.length < 75) return true;
      return false;
    }

    function pickDiverseSources(sources, limit) {
      const picked = [];
      const perDomain = new Map();
      for (const s of sources) {
        if (picked.length >= limit) break;
        const d = domainFromUrl(s.url) || "unknown";
        const count = perDomain.get(d) || 0;
        if (count >= 2) continue;
        picked.push(s);
        perDomain.set(d, count + 1);
      }
      if (picked.length >= limit) return picked.slice(0, limit);
      for (const s of sources) {
        if (picked.length >= limit) break;
        if (!picked.includes(s)) picked.push(s);
      }
      return picked.slice(0, limit);
    }

    function rankSources(sources, analyzer) {
      return [...sources]
        .map((s) => ({ ...s, _score: scoreSource(s, analyzer) }))
        .sort((a, b) => b._score - a._score)
        .map(({ _score, ...rest }) => rest);
    }

    async function mapWithConcurrency(items, limit, worker) {
      const cap = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
      const output = new Array(items.length);
      let cursor = 0;

      async function runWorker() {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) break;
          output[idx] = await worker(items[idx], idx);
        }
      }

      await Promise.all(Array.from({ length: cap }, runWorker));
      return output;
    }

    async function fetchJson(url, options = {}, meta = {}) {
      const scope = meta.scope || "http";
      const method = String(options.method || "GET").toUpperCase();
      const reqBody = typeof options.body === "string" ? options.body.slice(0, 600) : "";
      addDebug(scope, `REQ ${method} ${url}${reqBody ? `\nbody: ${reqBody}` : ""}`, "ok");

      let res;
      let raw;
      try {
        res = await fetch(url, options);
        raw = await res.text();
      } catch (err) {
        addDebug(scope, `NET ERR ${url}\n${err.message || String(err)}`, "err");
        throw new Error(`Network error at ${meta.label || url}: ${err.message || String(err)}`);
      }

      const clipped = String(raw || "").slice(0, 900);
      addDebug(scope, `RES ${res.status} ${url}\n${clipped || "(empty)"}`, res.ok ? "ok" : "err");
      if (!res.ok) throw new Error(`${meta.label || url} -> ${res.status}: ${clipped.slice(0, 260)}`);
      try {
        return JSON.parse(raw);
      } catch {
        addDebug(scope, `PARSE ERR ${url}\nResponse is not JSON`, "err");
        throw new Error(`Invalid JSON response from ${meta.label || url}`);
      }
    }

    function getProviderRuntime() {
      const provider = ($("provider")?.value || "lmstudio").toLowerCase();
      const model = $("modelName")?.value?.trim() || "";
      const map = {
        lmstudio: { provider, model, base: $("lmBase")?.value?.trim() || "/lmstudio/v1", apiKey: "" },
        ollama: { provider, model, base: $("ollamaBase")?.value?.trim() || "/ollama/v1", apiKey: "" },
        openai: { provider, model, base: $("openaiBase")?.value?.trim() || "https://api.openai.com/v1", apiKey: $("openaiKey")?.value || "" },
        anthropic: { provider, model, base: "https://api.anthropic.com/v1", apiKey: $("anthropicKey")?.value || "" },
        gemini: { provider, model, base: "https://generativelanguage.googleapis.com/v1beta", apiKey: $("geminiKey")?.value || "" }
      };
      return map[provider] || map.lmstudio;
    }

    function normalizeLlmParallelForProvider(rawParallel) {
      const provider = getProviderRuntime().provider;
      if (provider === "ollama") return 1;
      return Math.max(1, Math.min(4, Number(rawParallel) || 1));
    }

    function validateProviderConfig() {
      const runtime = getProviderRuntime();
      if (runtime.provider === "openai" && !runtime.apiKey) return "OpenAI key is missing.";
      if (runtime.provider === "anthropic" && !runtime.apiKey) return "Anthropic key is missing.";
      if (runtime.provider === "gemini" && !runtime.apiKey) return "Gemini key is missing.";
      return "";
    }

    async function lmChat({ lmBase, payload }) {
      const runtime = getProviderRuntime();
      const base = runtime.base || lmBase;
      const scope = runtime.provider;

      if (runtime.provider === "anthropic") {
        if (!runtime.apiKey) throw new Error("Anthropic key is missing.");
        const firstUser = (payload?.messages || []).find((m) => m.role === "user")?.content || "";
        const raw = await fetchJson(`${base.replace(/\/$/, "")}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": runtime.apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: runtime.model || "claude-3-5-sonnet-latest",
            max_tokens: payload.max_tokens || 1200,
            messages: [{ role: "user", content: String(firstUser || "") }]
          })
        }, { scope, label: "Anthropic messages" });
        const parsed = extractChatContent(raw, runtime.provider);
        return { choices: [{ message: { content: parsed.content, reasoning_content: parsed.reasoning } }] };
      }

      if (runtime.provider === "gemini") {
        if (!runtime.apiKey) throw new Error("Gemini key is missing.");
        const firstUser = (payload?.messages || []).find((m) => m.role === "user")?.content || "";
        const url = `${base.replace(/\/$/, "")}/models/${encodeURIComponent(runtime.model || "gemini-1.5-pro")}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`;
        const raw = await fetchJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: String(firstUser || "") }] }]
          })
        }, { scope, label: "Gemini generateContent" });
        const parsed = extractChatContent(raw, runtime.provider);
        return { choices: [{ message: { content: parsed.content, reasoning_content: parsed.reasoning } }] };
      }

      const headers = { "Content-Type": "application/json" };
      if (runtime.provider === "openai" && runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;
      const url = `${base.replace(/\/$/, "")}/chat/completions`;
      return fetchJson(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      }, { scope, label: `${runtime.provider} chat/completions` });
    }

    async function lmChatStream({ lmBase, payload, onText }) {
      const runtime = getProviderRuntime();
      if (runtime.provider === "anthropic" || runtime.provider === "gemini") {
        const oneShot = await lmChat({ lmBase, payload });
        const content = String(oneShot?.choices?.[0]?.message?.content || "");
        if (typeof onText === "function") onText(content);
        return { content, reasoning: "" };
      }

      const base = runtime.base || lmBase;
      const headers = { "Content-Type": "application/json" };
      if (runtime.provider === "openai" && runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;
      const url = `${base.replace(/\/$/, "")}/chat/completions`;
      const finalPayload = { ...payload, stream: true };
      addDebug(runtime.provider, `REQ POST ${url}\nbody: ${JSON.stringify(finalPayload).slice(0, 650)}`, "ok");
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(finalPayload)
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        addDebug(runtime.provider, `RES ${res.status} ${url}\n${String(body).slice(0, 700)}`, "err");
        throw new Error(`${runtime.provider} streaming failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let full = "";
      let reasoning = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const event of chunks) {
          for (const line of event.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content || "";
              const deltaReasoning = json?.choices?.[0]?.delta?.reasoning_content || "";
              if (delta) {
                full += delta;
                if (typeof onText === "function") onText(full);
              }
              if (deltaReasoning) reasoning += String(deltaReasoning);
            } catch { }
          }
        }
      }
      addDebug(runtime.provider, `STREAM DONE ${url}\nchars=${full.length}`, "ok");
      return { content: full, reasoning };
    }

    function extractChatContent(raw, provider = "lmstudio") {
      if (provider === "anthropic") {
        const text = Array.isArray(raw?.content)
          ? raw.content.filter((x) => x?.type === "text").map((x) => x.text || "").join("\n")
          : "";
        return { content: text || "", reasoning: "" };
      }
      if (provider === "gemini") {
        const text = raw?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("\n") || "";
        return { content: text || "", reasoning: "" };
      }
      return {
        content: String(raw?.choices?.[0]?.message?.content || ""),
        reasoning: String(raw?.choices?.[0]?.message?.reasoning_content || "")
      };
    }

    async function plannerAgent({ lmBase, model, query, maxQueries, stylePrompt = "" }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["task", "queries"],
        properties: {
          task: { type: "string", minLength: 5 },
          queries: {
            type: "array",
            minItems: 1,
            maxItems: maxQueries,
            items: { type: "string", minLength: 3 }
          }
        }
      };

      const payload = {
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "You are Planner Agent.",
              "Convert user query into focused web search queries.",
              "Ignore noisy separators like <<<<<<.",
              "Prefer official documentation, GitHub repositories, release notes, and engineering blogs.",
              "Avoid generic listicles and low-signal sources.",
              "Return strict JSON only.",
              stylePrompt || ""
            ].filter(Boolean).join(" ")
          },
          { role: "user", content: query }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "planner_output", strict: true, schema }
        }
      };

      const out = await lmChat({ lmBase, payload });
      captureModelThinking("planner", out);
      const content = out?.choices?.[0]?.message?.content || "";
      const parsed = await parseContentAsJsonSmart({
        lmBase,
        model,
        content,
        stage: "planner-json",
        defaultValue: { task: query, queries: [query] }
      });
      const queries = uniqueStrings(Array.isArray(parsed?.queries) ? parsed.queries : [query]).slice(0, maxQueries);
      return { task: String(parsed?.task || query), queries };
    }

    async function analyzerAgent({ lmBase, model, query }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["intent", "goal", "mustInclude"],
        properties: {
          intent: { type: "string", enum: ["pointed", "broad"] },
          goal: { type: "string", minLength: 8 },
          mustInclude: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: { type: "string", minLength: 2 }
          }
        }
      };
      const payload = {
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "You are Query Analyzer. Detect if user asks a broad exploration or a pointed factual ask. Return strict JSON only."
          },
          { role: "user", content: query }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "query_profile", strict: true, schema }
        }
      };
      const out = await lmChat({ lmBase, payload });
      captureModelThinking("analyzer", out);
      const content = out?.choices?.[0]?.message?.content || "";
      const parsed = await parseContentAsJsonSmart({
        lmBase,
        model,
        content,
        stage: "analyzer-json",
        defaultValue: { intent: "broad", goal: query, mustInclude: [] }
      });
      return {
        intent: parsed?.intent === "pointed" ? "pointed" : "broad",
        goal: String(parsed?.goal || query).slice(0, 220),
        mustInclude: uniqueStrings(Array.isArray(parsed?.mustInclude) ? parsed.mustInclude : []).slice(0, 6)
      };
    }

    async function refinerAgent({ lmBase, model, userQuery, initialQueries, maxQueries }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["queries", "notes"],
        properties: {
          notes: { type: "string", minLength: 5 },
          queries: {
            type: "array",
            minItems: 1,
            maxItems: maxQueries,
            items: { type: "string", minLength: 3 }
          }
        }
      };

      const payload = {
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "You are Refiner Agent. Improve query quality, remove duplicates, maximize coverage. Favor high-authority technical sources. Return strict JSON only."
          },
          {
            role: "user",
            content: `User query: ${userQuery}\nInitial queries: ${JSON.stringify(initialQueries)}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "refiner_output", strict: true, schema }
        }
      };

      const out = await lmChat({ lmBase, payload });
      captureModelThinking("refiner", out);
      const content = out?.choices?.[0]?.message?.content || "";
      const parsed = await parseContentAsJsonSmart({
        lmBase,
        model,
        content,
        stage: "refiner-json",
        defaultValue: { notes: "fallback", queries: initialQueries.slice(0, maxQueries) }
      });
      return {
        notes: String(parsed?.notes || "fallback"),
        queries: uniqueStrings(Array.isArray(parsed?.queries) ? parsed.queries : initialQueries).slice(0, maxQueries)
      };
    }

    async function criticAgent({ lmBase, model, userQuery, currentQueries, sources, maxFollowUpQueries, stylePrompt = "" }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: [
          "needMoreSearch",
          "reason",
          "followUpQueries",
          "sourceQualityScore",
          "coverageScore",
          "freshnessScore",
          "overallScore",
          "missingAngles",
          "contradictions"
        ],
        properties: {
          needMoreSearch: { type: "boolean" },
          reason: { type: "string", minLength: 5 },
          sourceQualityScore: { type: "integer", minimum: 0, maximum: 100 },
          coverageScore: { type: "integer", minimum: 0, maximum: 100 },
          freshnessScore: { type: "integer", minimum: 0, maximum: 100 },
          overallScore: { type: "integer", minimum: 0, maximum: 100 },
          missingAngles: {
            type: "array",
            minItems: 0,
            maxItems: 6,
            items: { type: "string", minLength: 3 }
          },
          contradictions: {
            type: "array",
            minItems: 0,
            maxItems: 5,
            items: { type: "string", minLength: 3 }
          },
          followUpQueries: {
            type: "array",
            minItems: 0,
            maxItems: maxFollowUpQueries,
            items: { type: "string", minLength: 3 }
          }
        }
      };
      const compactSources = sources.slice(0, 10).map((s, i) =>
        `[${i + 1}] ${s.title} | ${s.url} | ${s.content.slice(0, 220)}`
      ).join("\n");

      const payload = {
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "You are Research Critic.",
              "Audit evidence quality and decide if we can safely synthesize now.",
              "Score source quality, coverage, and freshness from 0-100.",
              "Detect contradictions and missing angles.",
              "If confidence is not strong, demand more retrieval with high-value follow-up queries.",
              "Be strict, not optimistic.",
              stylePrompt || "",
              "Return strict JSON only."
            ].filter(Boolean).join(" ")
          },
          {
            role: "user",
            content: `Question: ${userQuery}\nCurrent queries: ${JSON.stringify(currentQueries)}\nSources:\n${compactSources}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "critic_output", strict: true, schema }
        }
      };

      const out = await lmChat({ lmBase, payload });
      captureModelThinking("critic", out);
      const content = out?.choices?.[0]?.message?.content || "";
      const parsed = await parseContentAsJsonSmart({
        lmBase,
        model,
        content,
        stage: "critic-json",
        defaultValue: {
          needMoreSearch: true,
          reason: "fallback",
          followUpQueries: [],
          sourceQualityScore: 40,
          coverageScore: 40,
          freshnessScore: 40,
          overallScore: 40,
          missingAngles: [],
          contradictions: []
        }
      });
      return {
        needMoreSearch: !!parsed?.needMoreSearch,
        reason: String(parsed?.reason || "fallback"),
        followUpQueries: uniqueStrings(Array.isArray(parsed?.followUpQueries) ? parsed.followUpQueries : []).slice(0, maxFollowUpQueries),
        sourceQualityScore: Math.max(0, Math.min(100, Number(parsed?.sourceQualityScore) || 40)),
        coverageScore: Math.max(0, Math.min(100, Number(parsed?.coverageScore) || 40)),
        freshnessScore: Math.max(0, Math.min(100, Number(parsed?.freshnessScore) || 40)),
        overallScore: Math.max(0, Math.min(100, Number(parsed?.overallScore) || 40)),
        missingAngles: uniqueStrings(Array.isArray(parsed?.missingAngles) ? parsed.missingAngles : []).slice(0, 6),
        contradictions: uniqueStrings(Array.isArray(parsed?.contradictions) ? parsed.contradictions : []).slice(0, 5)
      };
    }

    function mergeCriticOutputs(outputs = [], maxFollowUpQueries = 2) {
      const valid = outputs.filter(Boolean);
      if (!valid.length) {
        return {
          needMoreSearch: true,
          reason: "No critic outputs.",
          followUpQueries: [],
          sourceQualityScore: 0,
          coverageScore: 0,
          freshnessScore: 0,
          overallScore: 0,
          missingAngles: ["no-critic-signal"],
          contradictions: []
        };
      }
      const avg = (k) => Math.round(valid.reduce((a, x) => a + (Number(x?.[k]) || 0), 0) / valid.length);
      const votesNeedMore = valid.filter((x) => !!x.needMoreSearch).length;
      const needMoreSearch = votesNeedMore >= Math.ceil(valid.length / 2);
      const follow = uniqueStrings(valid.flatMap((x) => x.followUpQueries || [])).slice(0, maxFollowUpQueries);
      const missing = uniqueStrings(valid.flatMap((x) => x.missingAngles || [])).slice(0, 8);
      const contradictions = uniqueStrings(valid.flatMap((x) => x.contradictions || [])).slice(0, 6);
      const reason = uniqueStrings(valid.map((x) => x.reason || "")).slice(0, 2).join(" | ");
      return {
        needMoreSearch,
        reason,
        followUpQueries: follow,
        sourceQualityScore: avg("sourceQualityScore"),
        coverageScore: avg("coverageScore"),
        freshnessScore: avg("freshnessScore"),
        overallScore: avg("overallScore"),
        missingAngles: missing,
        contradictions
      };
    }

    async function criticEnsemble({ lmBase, model, userQuery, currentQueries, sources, maxFollowUpQueries, critics = 2 }) {
      const styles = [
        "Perspective: Evidence quality and source reliability first.",
        "Perspective: Coverage gaps and missing user intent constraints first.",
        "Perspective: Freshness, contradiction detection, and claim risk first."
      ].slice(0, Math.max(1, Math.min(3, Number(critics) || 2)));

      const outs = await Promise.all(styles.map((style) =>
        criticAgent({
          lmBase,
          model,
          userQuery,
          currentQueries,
          sources,
          maxFollowUpQueries,
          stylePrompt: style
        }).catch((err) => ({
          needMoreSearch: true,
          reason: `critic-failed: ${err.message}`,
          followUpQueries: [],
          sourceQualityScore: 0,
          coverageScore: 0,
          freshnessScore: 0,
          overallScore: 0,
          missingAngles: [],
          contradictions: []
        }))
      ));

      return {
        merged: mergeCriticOutputs(outs, maxFollowUpQueries),
        raw: outs
      };
    }

    async function sourceSelectorAgent({ lmBase, model, userQuery, analyzer, sources, maxSources }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["selectedIndices", "rationale"],
        properties: {
          selectedIndices: {
            type: "array",
            minItems: 1,
            maxItems: maxSources,
            items: { type: "integer", minimum: 1, maximum: sources.length }
          },
          rationale: { type: "string", minLength: 8 }
        }
      };

      const compact = sources.map((s, i) =>
        `[${i + 1}] ${s.title}\n${s.url}\n${(s.content || "").slice(0, 260)}`
      ).join("\n\n");

      const payload = {
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "You are Source Selector.",
              "Pick the best evidence set for final synthesis.",
              "Prioritize official docs/repos, technical depth, freshness, and coverage diversity.",
              "Avoid redundant or low-credibility sources.",
              "Return strict JSON only."
            ].join(" ")
          },
          {
            role: "user",
            content: `Question: ${userQuery}\nQuery profile: ${JSON.stringify(analyzer || {})}\nNeed at most ${maxSources} sources.\n\nCandidates:\n${compact}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "source_selector_output", strict: true, schema }
        }
      };

      const out = await lmChat({ lmBase, payload });
      captureModelThinking("source-selector", out);
      const content = out?.choices?.[0]?.message?.content || "";
      const parsed = await parseContentAsJsonSmart({
        lmBase,
        model,
        content,
        stage: "source-selector-json",
        defaultValue: { selectedIndices: [1], rationale: "fallback" }
      });
      return {
        selectedIndices: Array.isArray(parsed?.selectedIndices) ? parsed.selectedIndices : [1],
        rationale: String(parsed?.rationale || "fallback")
      };
    }

    async function followupQuestionsAgent({ lmBase, model, userQuery, answer, language }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["questions"],
        properties: {
          questions: {
            type: "array",
            minItems: 4,
            maxItems: 6,
            items: { type: "string", minLength: 8 }
          }
        }
      };

      const payload = {
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              "You are Follow-up Generator.",
              "Generate 4-6 sharp next questions that branch the topic in useful directions.",
              language === "he" ? "Write in Hebrew." : language === "en" ? "Write in English." : "Write in the user's language.",
              "Return strict JSON only."
            ].join(" ")
          },
          {
            role: "user",
            content: `Original question: ${userQuery}\nCurrent answer:\n${String(answer || "").slice(0, 2000)}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "followup_output", strict: true, schema }
        }
      };
      const out = await lmChat({ lmBase, payload });
      captureModelThinking("followup", out);
      const content = out?.choices?.[0]?.message?.content || "";
      const parsed = await parseContentAsJsonSmart({
        lmBase,
        model,
        content,
        stage: "followup-json",
        defaultValue: { questions: [] }
      });
      return {
        questions: uniqueStrings(Array.isArray(parsed?.questions) ? parsed.questions : []).slice(0, 6)
      };
    }

    const DISCOVERY_CATEGORIES = {
      tech: [
        "latest agentic ai open source launches",
        "local llm multi-agent framework 2026",
        "coding agents cli release notes"
      ],
      security: [
        "recent major zero-day vulnerabilities 2026",
        "ai-driven cyber defense breakthroughs",
        "state-sponsored cyber attack trends",
        "new encryption standards audit"
      ],
      business: [
        "major business strategy shifts driven by ai 2026",
        "enterprise automation platforms quarterly updates",
        "global startup funding trends in ai tooling",
        "top market-moving tech earnings insights"
      ],
      science: [
        "major peer reviewed breakthroughs 2026",
        "quantum computing progress practical milestones",
        "materials science discovery machine learning",
        "space exploration mission updates scientific impact"
      ],
      health: [
        "clinical trials ai diagnostics latest results",
        "digital health regulation updates 2026",
        "precision medicine and genomics breakthroughs",
        "public health early-warning systems with ai"
      ],
      productivity: [
        "best local-first productivity tools 2026",
        "workflow automation playbooks for small teams",
        "agent-based coding and research productivity tips",
        "knowledge management tools privacy-first comparison"
      ],
      beauty: [
        "science of personalized skin care 2026",
        "ai beauty devices breakthroughs",
        "sustainable cosmetic ingredient research",
        "biotech hair growth clinical results"
      ],
      fashion: [
        "smart textile innovation 2026",
        "digital fashion and virtual couture trends",
        "sustainable luxury fashion tech",
        "3d printed footwear manufacturing"
      ],
      history: [
        "lidar discovery lost civilizations 2026",
        "ancient dna sequencing neolithic sites",
        "deep sea archaeology autonomous drones",
        "unexplained archaeological structures detection"
      ]
    };

    async function switchDiscoveryCategory(cat, btn) {
      document.querySelectorAll('.discovery-tab').forEach(t => t.classList.remove('active'));
      if (btn) btn.classList.add('active');
      state.currentDiscoveryCategory = cat;
      const searchUrl = $("searchUrl").value.trim();
      state.discovery = []; // Clear immediately for instant feedback
      await loadDiscovery(searchUrl, cat);
    }

    async function loadDiscovery(searchUrl, category = "tech") {
      if (!searchUrl) return;
      state.discoveryLoading = true;
      renderDiscovery();
      const picks = DISCOVERY_CATEGORIES[category] || DISCOVERY_CATEGORIES.tech;
      const q = picks[Math.floor(Math.random() * picks.length)];
      try {
        const [web, images, videos] = await Promise.all([
          searchQuery({ searchUrl, query: q, limit: 8, sourceProfile: "web" }),
          searchQuery({ searchUrl, query: q, limit: 3, sourceProfile: "images" }),
          searchQuery({ searchUrl, query: q, limit: 3, sourceProfile: "videos" })
        ]);
        state.discovery = [...web, ...images, ...videos];
      } catch (err) {
        addDebug("discovery", `Auto-load failed: ${err.message}`, "warn");
      } finally {
        state.discoveryLoading = false;
        renderDiscovery();
      }
    }

    function explainDiscoveryItem(item) {
      if (!item || state.busy) return;
      const focus = [
        "Explain this article in a practical way:",
        `Title: ${item.title || "-"}`,
        `Link: ${item.url || "-"}`,
        `Summary: ${item.content || "-"}`,
        "",
        "I want:",
        "1) A short summary",
        "2) Key takeaways",
        "3) Is it reliable and why",
        "4) Smart follow-up questions"
      ].join("\n");
      const input = $("userQuery");
      input.value = focus;
      input.style.height = 'auto';
      input.style.height = (input.scrollHeight) + 'px';
      $("contextUrls").value = item.url || "";
      const autoRun = $("autoRunDiscovery")?.checked;
      if (autoRun) {
        runPipeline();
      } else {
        expandChat();
        setStatus("Discovery item loaded. Edit the prompt or press send.");
      }
    }

    function exportResearchPdf() {
      showResearchView();
      window.print();
    }

    function exportCurrentSessionJson() {
      const payload = {
        exportedAt: new Date().toISOString(),
        settings: getCurrentSettingsSnapshot(),
        session: {
          id: state.currentSessionId,
          title: normalizeQuery($("userQuery")?.value || "").slice(0, 90) || "Untitled session",
          query: $("userQuery")?.value || "",
          answerHtml: $("answer")?.innerHTML || "",
          sources: state.sources || [],
          followups: state.followups || [],
          logs: state.logs || []
        }
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replaceAll(":", "-");
      a.href = url;
      a.download = `agentic-session-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Session exported as JSON.");
    }

    async function shareResearchSummary() {
      const title = normalizeQuery($("userQuery")?.value || "").slice(0, 90) || "AppAgent Research";
      const answer = String($("answer")?.textContent || "").replace(/\s+/g, " ").trim();
      const topSources = (state.sources || []).slice(0, 5).map((s, i) => `${i + 1}. ${s.title || s.url || "-"}`).join("\n");
      const text = [
        `Query: ${title}`,
        "",
        "Summary:",
        (answer.slice(0, 1200) || "No summary yet."),
        "",
        "Top Sources:",
        (topSources || "No sources yet.")
      ].join("\n");

      if (navigator.share) {
        try {
          await navigator.share({ title: "AppAgent Research", text });
          setStatus("Shared successfully.");
          return;
        } catch (err) {
          if (String(err?.name || "") === "AbortError") return;
        }
      }

      try {
        await navigator.clipboard.writeText(text);
        setStatus("Share not available. Summary copied to clipboard.");
      } catch {
        setStatus("Share is not available on this device/browser.");
      }
    }

    function composeSystemPrompt(basePrompt = "") {
      const relayOn = $("expAgentRelay")?.checked;
      if (!relayOn || !state.agentBrief) return basePrompt;
      return [basePrompt, `\n[AGENT RELAY BRIEF]\n${state.agentBrief}`].filter(Boolean).join("\n\n");
    }

    function openDeepResearchView() {
      const modal = $("deepViewModal");
      const body = $("deepViewBody");
      if (!modal || !body) return;

      const topSources = (state.sources || []).slice(0, 8);
      const timeline = (state.logs || []).slice(-18);
      const followups = (state.followups || []).slice(0, 8);
      const answerText = String($("answer")?.textContent || "").trim();
      const summary = answerText.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 5).join(" ");

      body.innerHTML = `
        <div class="deep-grid">
          <section class="card">
            <div class="section-title">Executive Summary</div>
            <p style="margin:0; line-height:1.6;">${escapeHtml(summary || "No summary available yet.")}</p>
            <hr style="border-color: rgba(255,255,255,0.08)" />
            <div class="section-title">Current Query</div>
            <pre class="mono" style="white-space:pre-wrap; margin:0; color:#d5e2eb;">${escapeHtml($("userQuery")?.value || "-")}</pre>
          </section>
          <section class="card">
            <div class="section-title">Agent Relay Brief</div>
            <pre class="mono" style="white-space:pre-wrap; margin:0; color:#d5e2eb;">${escapeHtml(state.agentBrief || "No relay brief yet. Run a research cycle first.")}</pre>
          </section>
        </div>
        <div class="deep-grid mt-3">
          <section class="card">
            <div class="section-title">Top Sources (${topSources.length})</div>
            ${topSources.length ? topSources.map((s, i) => `
              <div style="margin-bottom:.65rem;">
                <div class="mono" style="font-size:.72rem; color:#9db0bc;">[${i + 1}]</div>
                <a href="${escapeAttr(s.url || "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url || "Untitled")}</a>
                <div class="mono" style="font-size:.72rem; color:#9db0bc;">${escapeHtml((s.content || "").slice(0, 180))}</div>
              </div>
            `).join("") : '<div class="mono" style="color:#9db0bc;">No sources yet.</div>'}
          </section>
          <section class="card">
            <div class="section-title">Timeline (${timeline.length})</div>
            ${timeline.length ? timeline.map((l) => `
              <div class="mono" style="font-size:.72rem; margin-bottom:.32rem; color:${l.level === "err" ? "#ff8e8e" : l.level === "warn" ? "#ffd28f" : "#b8cad6"};">
                [${escapeHtml(l.stage || "-")}] ${escapeHtml(l.message || "")}
              </div>
            `).join("") : '<div class="mono" style="color:#9db0bc;">No timeline entries.</div>'}
          </section>
        </div>
        <section class="card mt-3">
          <div class="section-title">Fast Follow-up Queue</div>
          <div class="d-flex flex-wrap gap-2">
            ${followups.length ? followups.map((q) => `<button type="button" class="followup-item">${escapeHtml(q)}</button>`).join("") : '<div class="mono" style="color:#9db0bc;">No follow-up suggestions yet.</div>'}
          </div>
        </section>
      `;

      // Rebind queue buttons safely with dataset instead of inline execution.
      body.querySelectorAll(".followup-item").forEach((btn, idx) => {
        const q = followups[idx];
        btn.onclick = () => {
          closeDeepResearchView();
          if ($("userQuery")) $("userQuery").value = q;
          if ($("fastFollowups")?.checked) runFastFollowupPipeline(q);
          else runPipeline();
        };
      });

      modal.style.display = "block";
      modal.setAttribute("aria-hidden", "false");
    }

    function closeDeepResearchView() {
      const modal = $("deepViewModal");
      if (!modal) return;
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }

    async function runFastFollowupPipeline(rawQuery) {
      if (state.busy) return;
      const providerIssue = validateProviderConfig();
      if (providerIssue) {
        setStatus(providerIssue);
        addLog("health", providerIssue, "warn");
        return;
      }
      const cleanQuery = normalizeQuery(rawQuery);
      if (!cleanQuery) {
        setStatus("Please enter a query.");
        return;
      }

      const cachedSources = Array.isArray(state.sources) ? state.sources.slice(0, 16) : [];
      if (!cachedSources.length) {
        setStatus("No cached context yet. Running full pipeline.");
        await runPipeline();
        return;
      }

      const lmBase = $("lmBase").value.trim();
      const model = $("modelName").value.trim();
      const language = $("language").value;
      const thinkingMode = $("thinkingMode").value;
      const streamSynthesis = $("streamSynthesis").checked;
      const maxOutTokens = Math.max(256, Math.min(4096, Number($("maxOutTokens").value) || 1600));
      const customSystem = $("customSystem").value.trim();
      const fastContextFetch = $("expFastContextFetch")?.checked;

      setBusy(true);
      showResearchView();
      state.logs = [];
      state.debug = [];
      state.flow = createFlowState();
      renderLogs();
      renderFlow();
      renderDebug();
      addLog("copilot", "Fast follow-up mode: reusing existing context (no deep re-search).", "ok");
      setStatus("Fast copilot response...");

      try {
        let fastSources = cachedSources;
        if (fastContextFetch) {
          const urls = uniqueStrings(cachedSources.map((s) => s?.url).filter((u) => /^https?:\/\//i.test(String(u || "")))).slice(0, 3);
          if (urls.length) {
            addLog("copilot", `Fast context fetch from ${urls.length} URLs`, "ok");
            const extra = await ingestContextUrls(urls);
            fastSources = pickDiverseSources(rankSources(dedupeSources([...cachedSources, ...extra]), { intent: "followup", goal: "fast context", mustInclude: [] }), 20);
          }
        }
        addLog("copilot", `Fast context sources: ${fastSources.length}`, "ok");
        const answer = await synthesisAgent({
          lmBase,
          model,
          userQuery: cleanQuery,
          language,
          customSystem: composeSystemPrompt(customSystem),
          sources: fastSources,
          analyzer: {
            intent: "followup",
            goal: `Respond quickly using prior context from: ${state.lastUserQuery || "latest research session"}`,
            mustInclude: []
          },
          copilotMode: false,
          maxTokens: maxOutTokens,
          streamOutput: streamSynthesis,
          thinkingMode,
          onStreamText: (partial) => { renderAnswerMarkdown(partial); }
        });

        if (streamSynthesis) {
          stopAnswerAnimation();
          renderAnswerMarkdown(answer || "No answer generated.");
        } else {
          await animateAnswerMarkdown(answer || "No answer generated.");
        }

        state.lastUserQuery = cleanQuery;
        setStatus("Done (fast follow-up).");
        addLog("done", "Fast follow-up completed.", "ok");
        saveSession();
      } catch (err) {
        stopAnswerAnimation();
        setStatus(`Error: ${err.message}`);
        addLog("error", err.message || String(err), "err");
      } finally {
        setBusy(false);
      }
    }

    async function loadAnswerMedia(searchUrl, query) {
      const [images, videos, web] = await Promise.all([
        searchQuery({ searchUrl, query, limit: 8, sourceProfile: "images" }),
        searchQuery({ searchUrl, query, limit: 8, sourceProfile: "videos" }),
        searchQuery({ searchUrl, query, limit: 10, sourceProfile: "web" })
      ]);
      const webAsImages = web
        .filter((m) => !!(m.thumbnail || m.img_src))
        .map((m) => ({ ...m, mediaType: "image" }));
      const webAsVideos = web
        .filter((m) => inferMediaType(m.url) === "video")
        .map((m) => ({ ...m, mediaType: "video" }));
      const merged = [...images, ...videos, ...webAsImages, ...webAsVideos];
      const seen = new Set();
      const out = [];
      for (const m of merged) {
        const key = String(m.url || m.title || "").toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          title: String(m.title || "Untitled"),
          url: String(m.url || ""),
          content: String(m.content || ""),
          thumbnail: String(m.thumbnail || ""),
          img_src: String(m.img_src || ""),
          mediaType: String(m.mediaType || inferMediaType(m.url))
        });
      }
      state.mediaImages = out.filter((m) => (m.mediaType || inferMediaType(m.url)) === "image").slice(0, 9);
      state.mediaVideos = out.filter((m) => (m.mediaType || inferMediaType(m.url)) === "video").slice(0, 9);
      state.media = [...state.mediaImages, ...state.mediaVideos];
      addLog("media", `images=${state.mediaImages.length}, videos=${state.mediaVideos.length}`, (state.mediaImages.length + state.mediaVideos.length) ? "ok" : "warn");
      renderAnswerMedia();
    }

    async function loadWeather() {
      const fallback = "weather: unavailable";
      try {
        const data = await fetchJson("https://wttr.in/?format=j1", {}, { scope: "weather", label: "wttr.in" });
        const cc = data?.current_condition?.[0];
        if (!cc) {
          $("weatherBadge").textContent = fallback;
          return;
        }
        const c = cc.temp_C;
        const desc = cc.weatherDesc?.[0]?.value || "";
        $("weatherBadge").textContent = `weather: ${c}C ${desc}`.slice(0, 46);
      } catch {
        $("weatherBadge").textContent = fallback;
      }
    }

    async function searchQuery({ searchUrl, query, limit = 4, sourceProfile = "web" }) {
      const u = new URL(normalizeSearchUrl(searchUrl));
      u.searchParams.set("q", query);
      u.searchParams.set("format", "json");
      if (sourceProfile === "academic") u.searchParams.set("categories", "science");
      if (sourceProfile === "social") u.searchParams.set("categories", "social media");
      if (sourceProfile === "web") u.searchParams.set("categories", "general");
      if (sourceProfile === "images") u.searchParams.set("categories", "images");
      if (sourceProfile === "videos") u.searchParams.set("categories", "videos");
      let directOut;
      try {
        directOut = await fetchJson(u.toString(), {}, { scope: "search", label: "SearXNG direct" });
      } catch (err) {
        addLog("search", `SearXNG unavailable (${sourceProfile}): ${err.message}`, "warn");
        return [];
      }
      const results = Array.isArray(directOut?.results) ? directOut.results : [];
      return results.slice(0, limit).map(r => ({
        title: r?.title || r?.url || "Untitled",
        url: r?.url || "",
        content: r?.content || r?.snippet || "",
        thumbnail: r?.thumbnail || "",
        img_src: r?.img_src || "",
        mediaType: sourceProfile === "images" ? "image" : sourceProfile === "videos" ? "video" : inferMediaType(r?.url || "")
      }));
    }

    function dedupeSources(all) {
      const out = [];
      const seen = new Set();
      for (const src of all) {
        const key = (src.url || src.title || "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          title: String(src.title || "Untitled"),
          url: String(src.url || ""),
          content: String(src.content || "").replace(/\s+/g, " ").trim().slice(0, 850)
        });
      }
      return out;
    }

    function citationsToTag(citations, max) {
      const uniq = [...new Set((Array.isArray(citations) ? citations : []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= max))];
      return uniq.length ? ` [${uniq.join("] [")}]` : "";
    }

    function formatSynthesisJson(data, sourceCount) {
      const summary = String(data?.summary || "").trim();
      const points = Array.isArray(data?.keyPoints) ? data.keyPoints : [];
      const deepDive = Array.isArray(data?.deepDive) ? data.deepDive : [];
      const picks = Array.isArray(data?.recommendedStack) ? data.recommendedStack : [];
      const gaps = Array.isArray(data?.gaps) ? data.gaps : [];
      const confidence = String(data?.confidence || "medium");

      const lines = [];
      lines.push("## Answer");
      if (summary) lines.push(summary);

      if (points.length) {
        lines.push("", "## Key Points");
        for (const p of points.slice(0, 12)) {
          const txt = String(p?.point || "").trim();
          if (!txt) continue;
          lines.push(`- ${txt}${citationsToTag(p?.citations, sourceCount)}`);
        }
      }

      if (deepDive.length) {
        lines.push("", "## Deep Dive");
        for (const para of deepDive.slice(0, 8)) {
          const txt = String(para || "").trim();
          if (!txt) continue;
          lines.push(`- ${txt}`);
        }
      }

      if (picks.length) {
        lines.push("", "## Practical Recommendation");
        for (const p of picks.slice(0, 6)) {
          lines.push(`- ${String(p || "").trim()}`);
        }
      }

      if (gaps.length) {
        lines.push("", "## Information Gaps");
        for (const g of gaps.slice(0, 5)) {
          lines.push(`- ${String(g || "").trim()}`);
        }
      }

      lines.push("", `Confidence: \`${confidence}\``);
      return lines.join("\n");
    }

    function buildResearchNotes({ query, analyzer, queries, sources, lanes, critic }) {
      const lines = [];
      lines.push(`Query: ${query}`);
      lines.push(`Intent: ${analyzer?.intent || "unknown"}`);
      lines.push(`Goal: ${analyzer?.goal || "-"}`);
      lines.push(`Lanes: ${(lanes || []).join(", ") || "web"}`);
      if (critic) {
        lines.push(`Critic score: ${Number(critic?.overallScore || 0)}/100`);
        lines.push(`Coverage/Quality/Freshness: ${Number(critic?.coverageScore || 0)}/${Number(critic?.sourceQualityScore || 0)}/${Number(critic?.freshnessScore || 0)}`);
        lines.push(`Need more search: ${critic?.needMoreSearch ? "yes" : "no"}`);
      }
      lines.push("");
      if (critic?.missingAngles?.length) {
        lines.push("Missing Angles:");
        for (const x of critic.missingAngles.slice(0, 8)) lines.push(`- ${x}`);
        lines.push("");
      }
      if (critic?.contradictions?.length) {
        lines.push("Potential Contradictions:");
        for (const x of critic.contradictions.slice(0, 6)) lines.push(`- ${x}`);
        lines.push("");
      }
      lines.push("Planned Queries:");
      for (const q of (queries || []).slice(0, 12)) lines.push(`- ${q}`);
      lines.push("");
      lines.push("Selected Sources:");
      (sources || []).slice(0, 16).forEach((s, i) => {
        lines.push(`[${i + 1}] ${s.title}`);
        lines.push(`    ${s.url}`);
      });
      return lines.join("\n");
    }

    async function synthesisAgent({ lmBase, model, userQuery, language, customSystem, sources, analyzer, copilotMode, maxTokens, streamOutput, onStreamText, thinkingMode, temperature }) {
      const numbered = sources.map((s, idx) =>
        `[${idx + 1}] title: ${s.title}\nurl: ${s.url}\nsnippet: ${s.content}`
      ).join("\n\n");

      const langRule =
        language === "he"
          ? "Answer in Hebrew."
          : language === "en"
            ? "Answer in English."
            : `Auto-Detect: Detect the language of the user query "${userQuery.slice(0, 50)}" and respond accordingly (likely Hebrew or English).`;

      const system = [
        "You are Synthesis Agent.",
        "Create a high-signal answer from provided sources.",
        "Write a comprehensive answer, not short notes.",
        "Prefer extensive depth with practical details and concrete comparisons.",
        "Do not repeat content.",
        "Be specific and evidence-first.",
        "Citations are mandatory for factual claims.",
        "Prefer direct, practical recommendations over generic text.",
        copilotMode ? "Include practical execution guidance and concrete next steps." : "",
        thinkingMode === "use" && state.thinking.length
          ? `You may use these internal reasoning hints:\n${state.thinking.slice(0, 4).map((x) => `${x.stage}: ${x.text.slice(0, 700)}`).join("\n\n")}`
          : "",
        "Do not invent URLs.",
        langRule,
        customSystem ? `Extra constraints: ${customSystem}` : ""
      ].filter(Boolean).join(" ");

      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["summary", "keyPoints", "deepDive", "recommendedStack", "gaps", "confidence"],
        properties: {
          summary: { type: "string", minLength: 200 },
          keyPoints: {
            type: "array",
            minItems: 6,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["point", "citations"],
              properties: {
                point: { type: "string", minLength: 12 },
                citations: {
                  type: "array",
                  minItems: 1,
                  maxItems: 4,
                  items: { type: "integer", minimum: 1, maximum: Math.max(1, sources.length) }
                }
              }
            }
          },
          deepDive: {
            type: "array",
            minItems: 3,
            maxItems: 8,
            items: { type: "string", minLength: 70 }
          },
          recommendedStack: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: { type: "string", minLength: 4 }
          },
          gaps: {
            type: "array",
            minItems: 0,
            maxItems: 5,
            items: { type: "string", minLength: 4 }
          },
          confidence: { type: "string", enum: ["low", "medium", "high"] }
        }
      };

      const safeMaxTokens = Math.max(256, Math.min(4096, Number(maxTokens) || 1600));

      if (streamOutput) {
        const payloadStream = {
          model,
          temperature: temperature ?? 0.3,
          max_tokens: safeMaxTokens,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                `Question: ${userQuery}`,
                `Query profile: ${JSON.stringify(analyzer || {})}`,
                "",
                "Sources:",
                numbered,
                "",
                "Return a long, structured markdown answer with citations [n]."
              ].join("\n")
            }
          ]
        };
        const streamed = await lmChatStream({
          lmBase,
          payload: payloadStream,
          onText: (txt) => {
            if (typeof onStreamText === "function") onStreamText(txt);
          }
        });
        if (streamed?.reasoning) addThinking("synthesis-stream", streamed.reasoning);
        return streamed?.content || "";
      }

      const payload = {
        model,
        temperature: temperature ?? 0.15,
        max_tokens: safeMaxTokens,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Question: ${userQuery}\nQuery profile: ${JSON.stringify(analyzer || {})}\n\nSources:\n${numbered}\n\nReturn strict JSON only.`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "synthesis_output", strict: true, schema }
        }
      };

      const out = await lmChat({ lmBase, payload });
      captureModelThinking("synthesis", out);
      const content = out?.choices?.[0]?.message?.content || "";
      const parsed = await parseContentAsJsonSmart({
        lmBase,
        model,
        content,
        stage: "synthesis-json",
        defaultValue: null
      });
      if (!parsed || typeof parsed !== "object") return String(content || "").trim();
      if (!parsed.summary && !parsed.keyPoints) return String(content || "").trim();
      return formatSynthesisJson(parsed, sources.length);
    }

    function setupVoiceInput() {
      const btn = $("micBtn");
      const indicator = $("voiceState");
      if (!btn || !indicator) return;
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        btn.disabled = true;
        indicator.textContent = "speech api unavailable";
        return;
      }
      const rec = new SR();
      rec.lang = "he-IL";
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => { indicator.textContent = "listening..."; };
      rec.onend = () => { indicator.textContent = "mic off"; };
      rec.onerror = () => { indicator.textContent = "voice error"; };
      rec.onresult = (e) => {
        const spoken = e?.results?.[0]?.[0]?.transcript || "";
        if (!spoken.trim()) return;
        const current = $("userQuery").value.trim();
        $("userQuery").value = current ? `${current}\n${spoken}` : spoken;
      };

      btn.addEventListener("click", () => {
        try { rec.start(); } catch { }
      });
    }

    async function testConnections() {
      const lmBase = $("lmBase").value.trim();
      const searchUrl = normalizeSearchUrl($("searchUrl").value.trim());

      addLog("health", "Testing LM Studio...", "ok");
      await fetchJson(`${lmBase.replace(/\/$/, "")}/models`, {}, { scope: "health", label: "LM Studio models" });
      addLog("health", "LM Studio OK", "ok");

      addLog("health", "Testing SearXNG...", "ok");
      const u = new URL(searchUrl);
      u.searchParams.set("q", "test");
      u.searchParams.set("format", "json");
      await fetchJson(u.toString(), {}, { scope: "health", label: "SearXNG direct" });
      addLog("health", "SearXNG OK", "ok");
    }

    async function runQuickPipeline({
      lmBase,
      model,
      searchUrl,
      thinkingMode,
      language,
      sourceProfiles,
      streamSynthesis,
      maxOutTokens,
      customSystem,
      cleanQuery
    }) {
      setBusy(true);
      state.logs = [];
      state.debug = [];
      state.flow = createFlowState();
      state.queries = [cleanQuery];
      state.followups = [];
      state.criticReport = null;
      state.agentBrief = "";
      renderLogs();
      renderFlow();
      renderDebug();
      renderQueries();
      renderFollowups();
      stopAnswerAnimation();
      renderAnswerMarkdown("### Quick Search\nLooking for a fast answer...");
      addLog("analyzer", "Quick mode: minimal pipeline", "ok");

      try {
        const tasks = sourceProfiles.map((lane) => ({ q: cleanQuery, lane }));
        const grouped = await mapWithConcurrency(tasks, Math.min(3, tasks.length || 1), async (task) => {
          addLog("search", `Quick search [${task.lane}]`, "ok");
          return searchQuery({
            searchUrl,
            query: task.q,
            limit: 3,
            sourceProfile: task.lane
          });
        });
        const quickSources = dedupeSources(grouped.flat()).slice(0, 10);
        state.sources = quickSources;
        renderSources();
        updateAnswerMeta();

        if (!quickSources.length) {
          renderAnswerMarkdown("### Search temporarily unavailable\nSearXNG is currently unavailable. Please try again shortly.");
          addLog("search", "Quick mode finished without sources", "warn");
          setStatus("Quick mode: no sources.");
          saveSession();
          return;
        }

        const answer = await synthesisAgent({
          lmBase,
          model,
          userQuery: cleanQuery,
          language,
          customSystem: composeSystemPrompt(customSystem),
          sources: quickSources,
          analyzer: { intent: "quick", goal: "fast answer", mustInclude: [] },
          copilotMode: false,
          maxTokens: maxOutTokens,
          streamOutput: streamSynthesis,
          thinkingMode,
          onStreamText: (partial) => { renderAnswerMarkdown(partial); }
        });
        if (streamSynthesis) {
          stopAnswerAnimation();
          renderAnswerMarkdown(answer || "No answer generated.");
        } else {
          await animateAnswerMarkdown(answer || "No answer generated.");
        }
        setStatus("Done (quick).");
        addLog("done", "Quick pipeline completed", "ok");
        saveSession();
      } catch (err) {
        stopAnswerAnimation();
        setStatus(`Error: ${err.message}`);
        addLog("error", err.message || String(err), "err");
      } finally {
        setBusy(false);
      }
    }

    async function runPipeline() {
      if (state.busy) {
        const recovered = recoverFromStuckBusy();
        if (!recovered) {
          addLog("health", "Forcing unlock before new run.", "warn");
          setBusy(false);
        }
      }

      const lmBase = $("lmBase").value.trim();
      const model = $("modelName").value.trim();
      const searchUrl = normalizeSearchUrl($("searchUrl").value.trim());
      const mode = $("mode").value;
      const researchMode = $("researchMode").value;
      const thinkingMode = $("thinkingMode").value;
      const language = $("language").value;
      const sourceProfiles = getSelectedSourceProfiles();
      const copilotMode = $("copilotMode").checked;
      const streamSynthesis = $("streamSynthesis").checked;
      const maxOutTokens = Math.max(256, Math.min(4096, Number($("maxOutTokens").value) || 1600));
      const criticMinScore = Math.max(0, Math.min(100, Number($("criticMinScore").value) || 60));
      const criticAgents = Math.max(1, Math.min(3, Number($("criticAgents").value) || 3));
      const maxAutoLoops = Math.max(0, Math.min(3, Number($("maxAutoLoops").value) || 1));
      const criticHardGate = $("criticHardGate").checked;
      const llmParallel = normalizeLlmParallelForProvider(Number($("llmParallel").value) || 1);
      const searchParallel = Math.max(1, Math.min(8, Number($("searchParallel").value) || 1));
      const customSystem = $("customSystem").value.trim();
      const rawQuery = $("userQuery").value;
      const previousSourcesSnapshot = Array.isArray(state.sources) ? state.sources.slice() : [];
      const providerIssue = validateProviderConfig();
      if (providerIssue) {
        setStatus(providerIssue);
        addLog("health", providerIssue, "warn");
        return;
      }

      const cleanQuery = normalizeQuery(rawQuery);
      if (!cleanQuery) {
        setStatus("Please enter a query.");
        expandChat();
        return;
      }
      state.lastUserQuery = cleanQuery;
      const resolvedMode = resolveExecutionMode(cleanQuery);
      renderExecutionModeBadge(resolvedMode);
      showResearchView();
      expandChat();
      saveUiState();

      // WRITING MODE: Skip search agents and go straight to synthesis
      if (window.currentFocus === 'writing') {
        setBusy(true);
        setStatus("Drafting synthesized response...");
        addLog("analyzer", "Writing mode detected: Skipping search phase.", "ok");
        try {
          const answer = await synthesisAgent({
            lmBase,
            model,
            userQuery: cleanQuery,
            language,
            customSystem: composeSystemPrompt(customSystem),
            sources: [],
            analyzer: { intent: "pointed", goal: "drafting", mustInclude: [] },
            copilotMode: false,
            maxTokens: maxOutTokens,
            streamOutput: streamSynthesis,
            thinkingMode,
            temperature: DEPTH_PRESETS[mode]?.temperature,
            onStreamText: (partial) => { renderAnswerMarkdown(partial); }
          });
          if (streamSynthesis) stopAnswerAnimation();
          else await animateAnswerMarkdown(answer || "Done.");
          addLog("done", "Drafting completed.", "ok");
          saveSession();
        } catch (err) {
          addLog("error", err.message, "err");
        } finally {
          setBusy(false);
        }
        return;
      }

      if (resolvedMode === "quick") {
        await runQuickPipeline({
          lmBase,
          model,
          searchUrl,
          thinkingMode,
          language,
          sourceProfiles,
          streamSynthesis,
          maxOutTokens,
          customSystem,
          cleanQuery
        });
        return;
      }

      setBusy(true);
      state.logs = [];
      state.sources = [];
      state.media = [];
      state.mediaImages = [];
      state.mediaVideos = [];
      state.criticReport = null;
      state.thinking = [];
      state.queries = [];
      state.followups = [];
      state.agentBrief = "";
      state.debug = [];
      state.flow = createFlowState();
      renderLogs();
      renderFlow();
      renderDebug();
      renderSources();
      renderAnswerMedia();
      renderQueries();
      renderFollowups();
      renderThinking();
      renderAnswerNotes("No notes yet.");
      updateAnswerMeta();
      stopAnswerAnimation();
      renderAnswerMarkdown("### Running...\nCollecting sources and composing an answer.");

      try {
        const preset = DEPTH_PRESETS[mode] || DEPTH_PRESETS.balanced;
        if (researchMode === "focus" && previousSourcesSnapshot.length) {
          setStatus("Focus mode: reusing current conversation context...");
          addLog("focus", `Using ${previousSourcesSnapshot.length} existing sources`, "ok");
          state.sources = previousSourcesSnapshot.slice(0, 28);
          state.queries = [cleanQuery];
          renderSources();
          renderQueries();

          const focusSearchLimit = Math.max(2, Math.floor(preset.perQueryResults / 2));
          const focusTasks = sourceProfiles.map((lane) => ({ q: cleanQuery, lane }));
          const focusGrouped = await mapWithConcurrency(focusTasks, Math.min(searchParallel, sourceProfiles.length), async (task) => {
            addLog("search", `Focus searching [${task.lane}]`, "ok");
            const results = await searchQuery({
              searchUrl,
              query: task.q,
              limit: focusSearchLimit,
              sourceProfile: task.lane
            });
            addLog("search", `Focus found ${results.length} [${task.lane}]`, results.length ? "ok" : "warn");
            return results;
          });
          const focusCollected = focusGrouped.flat();
          const focusAnalyzer = { intent: "pointed", goal: "focus follow-up", mustInclude: [] };
          state.sources = pickDiverseSources(
            rankSources(dedupeSources([...state.sources, ...focusCollected]).filter((s) => !isWeakSource(s)), focusAnalyzer),
            Math.max(14, preset.contextSources)
          );
          renderSources();

          const contextUrls = parseContextUrls($("contextUrls").value);
          if (contextUrls.length) {
            addLog("context", `Loading ${contextUrls.length} context URLs`, "ok");
            const contextSources = await ingestContextUrls(contextUrls);
            if (contextSources.length) {
              state.sources = pickDiverseSources(
                rankSources(dedupeSources([...state.sources, ...contextSources]), focusAnalyzer),
                Math.max(16, preset.contextSources + 2)
              );
            }
            renderSources();
          }

          const criticPack = await criticEnsemble({
            lmBase,
            model,
            userQuery: cleanQuery,
            currentQueries: state.queries,
            sources: state.sources,
            maxFollowUpQueries: preset.maxSecondPassQueries,
            critics: criticAgents
          });
          state.criticReport = criticPack.merged;
          updateAnswerMeta();
          addLog("critic", `focus score=${state.criticReport.overallScore}/100`, state.criticReport.overallScore < criticMinScore ? "warn" : "ok");
          if (criticHardGate && state.criticReport.overallScore < criticMinScore) {
            throw new Error(`Focus gate blocked synthesis: score ${state.criticReport.overallScore}/100 < ${criticMinScore}`);
          }

          const focusNotes = buildResearchNotes({
            query: cleanQuery,
            analyzer: focusAnalyzer,
            queries: state.queries,
            sources: state.sources,
            lanes: sourceProfiles,
            critic: state.criticReport
          });
          state.agentBrief = focusNotes;
          renderAnswerNotes(focusNotes);

          setStatus("Synthesis agent is writing final answer...");
          const answer = await synthesisAgent({
            lmBase,
            model,
            userQuery: cleanQuery,
            language: document.getElementById("language").value,
            customSystem: composeSystemPrompt(customSystem),
            sources: state.sources,
            analyzer: focusAnalyzer,
            copilotMode,
            maxTokens: maxOutTokens,
            streamOutput: streamSynthesis,
            thinkingMode,
            temperature: DEPTH_PRESETS[mode]?.temperature,
            onStreamText: (partial) => {
              renderAnswerMarkdown(partial);
            }
          });

          if (streamSynthesis) {
            stopAnswerAnimation();
            renderAnswerMarkdown(answer || "No answer generated.");
          } else {
            await animateAnswerMarkdown(answer || "No answer generated.");
          }
          await loadAnswerMedia(searchUrl, cleanQuery).catch((err) => addLog("media", err.message, "warn"));
          if (copilotMode) {
            try {
              addLog("copilot", "Copilot is reviewing and generating interactive follow-ups...", "ok");
              const follow = await followupQuestionsAgent({
                lmBase,
                model,
                userQuery: cleanQuery,
                answer,
                language
              });
              state.followups = uniqueStrings(follow.questions || []).slice(0, 6);
              renderFollowups();
              addLog("copilot", "Interactive session ready.", "ok");
            } catch (err) {
              addLog("copilot", `Follow-up generation failed: ${err.message}`, "warn");
            }
          }
          setStatus("Done (focus mode).");
          addLog("done", "Focus pipeline completed successfully", "ok");
          saveSession();
          return;
        }
        addLog("analyzer", `Mode=${mode}; sources=${sourceProfiles.join("+")}; copilot=${copilotMode ? "on" : "off"}`, "ok");
        setStatus("Analyzing query intent...");
        addLog("analyzer", "Classifying query (pointed vs broad)", "ok");
        const analyzer = await analyzerAgent({
          lmBase,
          model,
          query: cleanQuery
        });
        addLog("analyzer", `Intent=${analyzer.intent}; goal=${analyzer.goal}`, "ok");

        const effectivePreset = { ...preset };
        if (analyzer.intent === "pointed") {
          effectivePreset.queryCount = Math.max(2, Math.min(3, preset.queryCount));
          effectivePreset.perQueryResults = Math.max(3, preset.perQueryResults);
        }

        const plannerStyles = [
          `User goal: ${analyzer.goal}. Must include: ${(analyzer.mustInclude || []).join(", ")}.`,
          "Bias toward fresh projects, launches, and active implementations.",
          "Bias toward practical tools/frameworks/repos and production-readiness.",
          "Bias toward architectural patterns, multi-agent orchestration, and parallel workflows."
        ].slice(0, llmParallel);

        setStatus(`Running ${plannerStyles.length} planner agents in parallel...`);
        addLog("planner", `Launching ${plannerStyles.length} parallel planner agents`, "ok");
        const plannerOutputs = await Promise.all(
          plannerStyles.map((style, idx) =>
            plannerAgent({
              lmBase,
              model,
              query: cleanQuery,
              maxQueries: effectivePreset.queryCount,
              stylePrompt: style
            }).then((out) => {
              addLog("planner", `Planner #${idx + 1} done (${(out.queries || []).length} queries)`, "ok");
              return out;
            })
          )
        );

        const initialQueries = uniqueStrings(plannerOutputs.flatMap((p) => p.queries || []))
          .slice(0, Math.max(effectivePreset.queryCount * 2, effectivePreset.queryCount + 2));
        addLog("planner", `Merged initial queries: ${initialQueries.length}`, "ok");
        addLog("planner", `Produced ${initialQueries.length} queries`, "ok");

        setStatus("Refiner agent is improving query coverage...");
        addLog("refiner", "Optimizing query set", "ok");
        const refined = await refinerAgent({
          lmBase,
          model,
          userQuery: cleanQuery,
          initialQueries,
          maxQueries: effectivePreset.queryCount
        });

        const finalQueries = uniqueStrings([...(refined.queries || []), ...initialQueries]).slice(0, effectivePreset.queryCount);
        state.queries = finalQueries;
        renderQueries();
        addLog("refiner", `Final query count: ${finalQueries.length}`, "ok");

        if (!finalQueries.length) {
          throw new Error("No queries were generated.");
        }

        setStatus(`Collecting sources from SearXNG with ${searchParallel} parallel workers...`);
        addLog("search", `Parallel search workers: ${searchParallel}; lanes=${sourceProfiles.join(",")}`, "ok");
        const tasks = finalQueries.flatMap((q) => sourceProfiles.map((lane) => ({ q, lane })));
        const grouped = await mapWithConcurrency(tasks, searchParallel, async (task) => {
          addLog("search", `Searching [${task.lane}]: ${task.q}`, "ok");
          const results = await searchQuery({
            searchUrl,
            query: task.q,
            limit: effectivePreset.perQueryResults,
            sourceProfile: task.lane
          });
          addLog("search", `Found ${results.length} results [${task.lane}]`, results.length ? "ok" : "warn");
          return results;
        });
        const collected = grouped.flat();

        let ranked = rankSources(
          dedupeSources(collected).filter((s) => !isWeakSource(s)),
          analyzer
        );
        ranked = pickDiverseSources(ranked, Math.max(18, effectivePreset.contextSources + 8));
        state.sources = ranked;
        renderSources();
        addLog("search", `Unique sources kept: ${state.sources.length}`, "ok");

        if (!state.sources.length) {
          throw new Error("No sources returned from SearXNG.");
        }

        let critic = null;
        for (let loop = 0; loop <= maxAutoLoops; loop++) {
          setStatus("Critic is validating source coverage...");
          addLog("critic", `Running multi-critic quality audit (loop ${loop + 1}/${maxAutoLoops + 1})`, "ok");
          const criticPack = await criticEnsemble({
            lmBase,
            model,
            userQuery: cleanQuery,
            currentQueries: finalQueries,
            sources: state.sources,
            maxFollowUpQueries: effectivePreset.maxSecondPassQueries,
            critics: criticAgents
          });
          critic = criticPack.merged;
          state.criticReport = critic;
          updateAnswerMeta();
          addLog(
            "critic",
            `score=${critic.overallScore}/100 quality=${critic.sourceQualityScore} coverage=${critic.coverageScore} fresh=${critic.freshnessScore}`,
            critic.overallScore < criticMinScore ? "warn" : "ok"
          );
          addLog("critic", `needMoreSearch=${critic.needMoreSearch}; reason=${critic.reason}`, critic.needMoreSearch ? "warn" : "ok");

          const belowGate = critic.overallScore < criticMinScore;
          const needMore = critic.needMoreSearch || belowGate;
          if (!needMore) break;

          const followUps = uniqueStrings(critic.followUpQueries || []).slice(0, effectivePreset.maxSecondPassQueries);
          if (!followUps.length || loop >= maxAutoLoops) {
            if (criticHardGate && belowGate) {
              throw new Error(`Critic gate blocked synthesis: score ${critic.overallScore}/100 < ${criticMinScore}`);
            }
            addLog("critic", "Proceeding despite low critic confidence (no more loops/followups).", "warn");
            break;
          }

          addLog("critic", `Running improvement pass with ${followUps.length} follow-up queries`, "ok");
          const second = await mapWithConcurrency(followUps, searchParallel, async (q) => {
            const secondTasks = sourceProfiles.map((lane) => ({ q, lane }));
            const byLane = await mapWithConcurrency(secondTasks, Math.min(searchParallel, sourceProfiles.length), async (task) => {
              addLog("search-2", `Searching [${task.lane}]: ${task.q}`, "ok");
              const results = await searchQuery({
                searchUrl,
                query: task.q,
                limit: effectivePreset.perQueryResults,
                sourceProfile: task.lane
              });
              addLog("search-2", `Found ${results.length} results [${task.lane}]`, results.length ? "ok" : "warn");
              return results;
            });
            return byLane.flat();
          });
          ranked = rankSources(
            dedupeSources([...ranked, ...second.flat()]).filter((s) => !isWeakSource(s)),
            analyzer
          );
          ranked = pickDiverseSources(ranked, Math.max(20, effectivePreset.contextSources + 10));
          state.sources = ranked;
          renderSources();
          addLog("search-2", `After improvement pass, kept ${state.sources.length} ranked sources`, "ok");
        }

        setStatus("Selecting strongest evidence for synthesis...");
        addLog("critic", `Selecting final context set (target ${effectivePreset.contextSources})`, "ok");
        let selected = [];
        try {
          const selection = await sourceSelectorAgent({
            lmBase,
            model,
            userQuery: cleanQuery,
            analyzer,
            sources: state.sources.slice(0, 24),
            maxSources: effectivePreset.contextSources
          });
          const chosen = uniqueStrings((selection.selectedIndices || []).map((n) => Number(n)))
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= Math.min(24, state.sources.length))
            .slice(0, effectivePreset.contextSources);
          selected = chosen.map((i) => state.sources[i - 1]).filter(Boolean);
          addLog("critic", `Source selector chose ${selected.length} sources`, "ok");
        } catch (err) {
          addLog("critic", `Source selector fallback: ${err.message}`, "warn");
        }

        const fallbackSelected = pickDiverseSources(state.sources, effectivePreset.contextSources);
        state.sources = (selected.length ? selected : fallbackSelected).slice(0, effectivePreset.contextSources);
        const contextUrls = parseContextUrls($("contextUrls").value);
        if (contextUrls.length) {
          addLog("context", `Loading ${contextUrls.length} context URLs`, "ok");
          const contextSources = await ingestContextUrls(contextUrls);
          if (contextSources.length) {
            state.sources = pickDiverseSources(
              rankSources(dedupeSources([...state.sources, ...contextSources]), analyzer),
              effectivePreset.contextSources + Math.min(4, contextSources.length)
            );
            addLog("context", `Merged ${contextSources.length} URL contexts`, "ok");
          }
        }
        renderSources();
        addLog("critic", `Context ready: ${state.sources.length} high-signal sources`, "ok");
        const notes = buildResearchNotes({
          query: cleanQuery,
          analyzer,
          queries: state.queries,
          sources: state.sources,
          lanes: sourceProfiles,
          critic: state.criticReport
        });
        state.agentBrief = notes;
        renderAnswerNotes(notes);

        setStatus("Synthesis agent is writing final answer...");
        addLog("synthesis", `Generating cited answer (max_tokens=${maxOutTokens}; stream=${streamSynthesis})`, "ok");

        const answer = await synthesisAgent({
          lmBase,
          model,
          userQuery: cleanQuery,
          language: $("language").value,
          customSystem: composeSystemPrompt(customSystem),
          sources: state.sources,
          analyzer,
          copilotMode,
          maxTokens: maxOutTokens,
          streamOutput: streamSynthesis,
          thinkingMode,
          temperature: DEPTH_PRESETS[mode]?.temperature,
          onStreamText: (partial) => {
            renderAnswerMarkdown(partial);
          }
        });

        if (streamSynthesis) {
          stopAnswerAnimation();
          renderAnswerMarkdown(answer || "No answer generated.");
        } else {
          await animateAnswerMarkdown(answer || "No answer generated.");
        }
        try {
          addLog("synthesis", "Collecting media (images/videos)", "ok");
          await loadAnswerMedia(searchUrl, cleanQuery);
        } catch (err) {
          addLog("synthesis", `Media fetch failed: ${err.message}`, "warn");
        }
        if (copilotMode) {
          try {
            addLog("copilot", "Copilot is reviewing and generating interactive follow-ups...", "ok");
            const follow = await followupQuestionsAgent({
              lmBase,
              model,
              userQuery: cleanQuery,
              answer,
              language
            });
            state.followups = uniqueStrings(follow.questions || []).slice(0, 6);
            renderFollowups();
            addLog("copilot", "Interactive session ready.", "ok");
          } catch (err) {
            addLog("copilot", `Follow-up generation failed: ${err.message}`, "warn");
          }
        }
        addLog("done", "Pipeline completed successfully", "ok");
        saveSession();
        setStatus("Done.");
      } catch (err) {
        console.error(err);
        stopAnswerAnimation();
        renderAnswerMarkdown(`### Pipeline failed\n\nCheck **Agent Timeline** and **Debug Console**.\n\n\`${String(err.message || err)}\``);
        setStatus(`Error: ${err.message}`);
        addLog("error", err.message || String(err), "err");
      } finally {
        setBusy(false);
      }
    }

    function startNewSession() {
      setBusy(false);
      state.currentSessionId = null;
      document.getElementById('welcomeView').style.display = 'block';
      document.getElementById('researchFeed').style.display = 'none';
      document.getElementById('discoveryView').style.display = 'none';
      $("userQuery").value = "";
      $("answer").innerHTML = "No output yet.";
      renderAnswerNotes("No notes yet.");
      state.logs = [];
      state.sources = [];
      state.media = [];
      state.mediaImages = [];
      state.mediaVideos = [];
      state.criticReport = null;
      state.thinking = [];
      state.queries = [];
      state.followups = [];
      state.agentBrief = "";
      state.debug = [];
      state.flow = createFlowState();
      renderLogs();
      renderFlow();
      renderDebug();
      renderQueries();
      renderSources();
      renderAnswerMedia();
      renderFollowups();
      renderThinking();
      renderConversationTree();
      updateAnswerMeta();
      setStatus("New session ready.");
      expandChat();
      saveUiState();
    }

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
  
