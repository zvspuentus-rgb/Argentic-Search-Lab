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

