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
      pipelineSubmitLock: false,
      promptEnhanceLock: false,
      executionModeResolved: "auto",
      attachments: [],
      discoveryCount: 24,
      sourcesLayout: "row",
      mediaCursor: null,
      runningPreview: false,
      runningPreviewMode: "deep",
      matrixTicker: null,
      centerOverlayVisible: false,
      turns: [],
      mediaObservers: {},
      temporalScope: null,
      demoQuota: {
        enabled: false,
        limit: null,
        used: null,
        remaining: null
      }
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
        if (typeof syncChatModelOptions === "function") {
          syncChatModelOptions({ keepChatSelection: true });
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
      const searchBox = $("searchBox");
      if (searchBox) searchBox.classList.toggle("is-busy", !!on);
      const searchContainer = $("searchContainer");
      if (searchContainer) searchContainer.classList.toggle("processing-shift", !!on);
      if ($("runBtn")) {
        $("runBtn").disabled = on || ($("userQuery")?.value.trim().length === 0);
      }
      if ($("testBtn")) $("testBtn").disabled = on;
      const form = $("searchForm");
      if (form) {
        form.querySelectorAll("button, select, textarea, input").forEach((el) => {
          if (el.id === "runBtn") return;
          if (el.dataset?.allowBusy === "true") return;
          el.disabled = !!on;
        });
      }
      const pill = $("busyPill");
      if (pill) {
        pill.textContent = on ? "running" : "idle";
        pill.classList.remove("text-bg-secondary", "text-bg-success");
        pill.classList.add(on ? "text-bg-success" : "text-bg-secondary");
      }
      toggleAgentStreamMatrix(on);
      renderRunStageIndicator();
      if (!on) hideCenterRequestOverlay();
      if (typeof updateInpState === "function") updateInpState();
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

    async function refreshDemoQuota() {
      try {
        const res = await fetch("/demo/quota", { cache: "no-store" });
        if (!res.ok) return null;
        const data = await res.json();
        state.demoQuota = {
          enabled: !!data.enabled,
          limit: data.limit,
          used: data.used,
          remaining: data.remaining
        };
        if (state.demoQuota.enabled && typeof state.demoQuota.remaining === "number") {
          setStatus(`Live Demo quota: ${state.demoQuota.remaining}/${state.demoQuota.limit} queries remaining`);
        }
        return state.demoQuota;
      } catch {
        return null;
      }
    }

    async function consumeDemoQuota() {
      const quota = state.demoQuota || {};
      if (!quota.enabled) return true;
      try {
        const res = await fetch("/demo/consume", { method: "POST" });
        if (res.status === 429) {
          const err = await res.json().catch(() => ({}));
          setStatus(err.message || "Live Demo quota reached.");
          return false;
        }
        if (!res.ok) {
          setStatus("Live Demo quota check failed.");
          return false;
        }
        const data = await res.json();
        state.demoQuota = {
          enabled: !!data.enabled,
          limit: data.limit,
          used: data.used,
          remaining: data.remaining
        };
        return true;
      } catch {
        setStatus("Live Demo quota check failed.");
        return false;
      }
    }

    function activeFlowLabel() {
      const active = FLOW_STAGES.find((s) => state.flow[s.id] === "active");
      return active?.label || "";
    }

    function renderRunStageIndicator() {
      const root = $("runStageIndicator");
      const text = $("runStageText");
      if (!root || !text) return;
      if (!state.busy) {
        root.classList.remove("active");
        text.textContent = "Idle";
        return;
      }
      const label = activeFlowLabel() || "Collection • Search • Compute • Answer";
      text.textContent = `Running: ${label}`;
      root.classList.add("active");
    }

    function randomMatrixChunk(len = 18) {
      const chars = "01abcdef<>+-=|/\\[]{}";
      let out = "";
      for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
      return out;
    }

    function compactLogLine(entry, fallbackTag = "TRACE") {
      if (!entry) return `[${fallbackTag}] ${randomMatrixChunk(24)}`;
      const tag = String(entry.stage || fallbackTag).toUpperCase().slice(0, 12);
      const msg = String(entry.message || "")
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s:;,.!?()[\]{}<>+\-_/|#@]/gu, "")
        .trim()
        .slice(0, 82);
      if (!msg) return `[${tag}] ${randomMatrixChunk(24)}`;
      return `[${tag}] ${msg}`;
    }

    function renderAgentStreamMatrixTick() {
      const root = $("agentStreamMatrix");
      const lineA = $("agentStreamLineA");
      const lineB = $("agentStreamLineB");
      const active = (activeFlowLabel() || "COLLECT").toUpperCase().slice(0, 10);
      const a = compactLogLine(state.logs[0], active);
      const b = compactLogLine(state.logs[1], "TRACE");
      if (root && lineA && lineB) {
        if (!state.busy) {
          root.classList.remove("active");
        } else {
          lineA.textContent = a;
          lineB.textContent = b;
          root.classList.add("active");
        }
      }
      renderAnalysisLiveFxTick(active, a, b);
    }

    function shouldShowAnalysisLiveFx() {
      if (!state.busy) return false;
      if (!state.runningPreview) return false;
      return state.runningPreviewMode === "deep";
    }

    function renderAnalysisLiveFxTick(activeText, lineAText, lineBText) {
      const root = $("analysisLiveFx");
      const stream = $("analysisLiveStream");
      const stream2 = $("analysisLiveStreamSecondary");
      const label = $("analysisLiveAgent");
      if (!root || !stream || !stream2 || !label) return;
      if (!state.busy) {
        root.classList.remove("active");
        return;
      }
      if (!shouldShowAnalysisLiveFx()) {
        root.classList.remove("active");
        return;
      }
      const active = String(activeText || (activeFlowLabel() || "COLLECT").toUpperCase().slice(0, 10));
      label.textContent = active;
      const liveLines = [
        lineAText || `[${active}] ${randomMatrixChunk(22)}`,
        lineBText || `[TRACE] ${randomMatrixChunk(22)}`,
        ...state.logs.slice(0, 10).map((x) => compactLogLine(x, "TRACE"))
      ].slice(0, 12);
      stream.innerHTML = liveLines.map((line) => `<div class="analysis-live-line">${escapeHtml(line)}</div>`).join("");
      const packetLines = state.logs
        .filter((x) => {
          const s = String(x?.stage || "").toLowerCase();
          return s && s !== "synthesis" && s !== "writing" && s !== "done";
        })
        .slice(0, 12)
        .map((x) => compactLogLine(x, "PACK"));
      stream2.innerHTML = packetLines
        .concat(packetLines.length ? [] : [`[${active}] ${randomMatrixChunk(26)}`])
        .slice(0, 12)
        .map((line) => `<div class="analysis-live-line">${escapeHtml(line)}</div>`)
        .join("");
      root.classList.add("active");
    }

    function toggleAgentStreamMatrix(on) {
      const root = $("agentStreamMatrix");
      const analysisRoot = $("analysisLiveFx");
      if (!on) {
        if (state.matrixTicker) {
          clearInterval(state.matrixTicker);
          state.matrixTicker = null;
        }
        if (root) root.classList.remove("active");
        if (analysisRoot) analysisRoot.classList.remove("active");
        return;
      }
      renderAgentStreamMatrixTick();
      if (!state.matrixTicker) {
        state.matrixTicker = setInterval(renderAgentStreamMatrixTick, 220);
      }
    }

    function setRunningPreview(on, mode = "deep") {
      state.runningPreview = !!on;
      state.runningPreviewMode = mode || "deep";
      if (!state.runningPreview) {
        const analysisRoot = $("analysisLiveFx");
        if (analysisRoot) analysisRoot.classList.remove("active");
      } else {
        renderAgentStreamMatrixTick();
      }
    }

    function showCenterRequestOverlay(message = "Processing request...") {
      const root = $("requestCenterOverlay");
      const text = $("requestCenterText");
      if (!root) return;
      if (text) text.textContent = String(message || "Processing request...");
      root.classList.add("show");
      root.setAttribute("aria-hidden", "false");
      state.centerOverlayVisible = true;
    }

    function hideCenterRequestOverlay() {
      const root = $("requestCenterOverlay");
      if (!root) return;
      root.classList.remove("show");
      root.setAttribute("aria-hidden", "true");
      state.centerOverlayVisible = false;
    }

    function buildRunningMarkdown() {
      const active = activeFlowLabel() || "Collection";
      const modeLabel = state.runningPreviewMode === "quick" ? "Quick" : "Deep";
      const stageCopy = {
        Analyzer: "Analyzing intent and constraints",
        Planner: "Building search plan and query strategy",
        Refiner: "Refining and deduplicating query set",
        Search: "Collecting sources across selected lanes",
        Critic: "Scoring coverage and checking blind spots",
        Writing: "Synthesizing final answer with citations",
        Copilot: "Generating follow-up suggestions"
      };
      const action = stageCopy[active] || "Collection • Search • Compute • Answer";
      const trace = state.logs.slice(0, 4).map((x) => `- [${x.stage}] ${x.message}`).join("\n") || "- Initializing agents...";
      return [
        `### ${modeLabel} Research Running...`,
        "",
        `**Active Agent:** ${active}`,
        `**Action:** ${action}`,
        "",
        "#### Live Trace",
        trace
      ].join("\n");
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
      enhanceCitationLinks();
    }

    function enhanceCitationLinks() {
      const root = $("answer");
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const raw = String(node?.nodeValue || "");
          if (!/\[(\d{1,3})\]/.test(raw)) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("a, pre, code, button")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = String(node.nodeValue || "");
        const parts = text.split(/(\[\d{1,3}\])/g);
        if (parts.length <= 1) continue;
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          const m = part.match(/^\[(\d{1,3})\]$/);
          if (!m) {
            frag.appendChild(document.createTextNode(part));
            continue;
          }
          const idx = Number(m[1]);
          const src = state.sources[idx - 1];
          if (!src?.url) {
            frag.appendChild(document.createTextNode(part));
            continue;
          }
          const a = document.createElement("a");
          a.className = "citation-ref";
          a.href = src.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = part;
          a.title = src.title || src.url;
          frag.appendChild(a);
        }
        node.parentNode?.replaceChild(frag, node);
      }
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
      if (state.mediaObservers[rootId]) {
        try { state.mediaObservers[rootId].disconnect(); } catch {}
        delete state.mediaObservers[rootId];
      }
      root.innerHTML = "";
      if (!items.length) {
        root.innerHTML = `<div class="mono" style="color:#9db0bc">${escapeHtml(emptyText)}</div>`;
        return;
      }

      const container = document.createElement("div");
      container.className = "media-scroll-container";
      const kind = /Videos/i.test(rootId) ? "videos" : /Images/i.test(rootId) ? "images" : "";

      for (const item of items.slice(0, 80)) {
        container.appendChild(createMediaCard(item));
      }
      if (kind) {
        const sentinel = document.createElement("div");
        sentinel.className = "media-load-sentinel";
        container.appendChild(sentinel);
        if (typeof IntersectionObserver === "function" && typeof loadMoreMediaForPanel === "function") {
          const obs = new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) loadMoreMediaForPanel(kind);
            }
          }, { root: container, threshold: 0.2 });
          obs.observe(sentinel);
          state.mediaObservers[rootId] = obs;
        }
      }
      root.appendChild(container);
    }

    function mediaRootIdForKind(kind) {
      return String(kind || "").toLowerCase() === "videos" ? "answerMediaVideosGridLeft" : "answerMediaImagesGridRight";
    }

    function createMediaCard(item) {
      const t = item.mediaType || inferMediaType(item.url);
      const thumb = previewImageForUrl(item);
      const icon = faviconForUrl(item.url);
      const card = document.createElement("article");
      card.className = "media-card";
      const mediaKey = String(item.url || item.title || "").toLowerCase().trim();
      if (mediaKey) card.dataset.mediaKey = mediaKey;
      card.innerHTML = `
        ${thumb ? `<img class="media-thumb" src="${escapeAttr(thumb)}" alt="${escapeAttr(item.title || "media")}" loading="lazy" onerror="this.onerror=null;this.src='${escapeAttr(icon)}';" />` : '<div class="media-thumb"></div>'}
        <div class="media-body">
          <div class="media-label">${escapeHtml(t)}</div>
          <h4 class="media-title">${escapeHtml(item.title || "Untitled")}</h4>
          <a class="media-link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url || "")}</a>
        </div>
      `;
      return card;
    }

    function appendMediaCards(kind, newItems) {
      const root = $(mediaRootIdForKind(kind));
      const list = Array.isArray(newItems) ? newItems : [];
      if (!root || !list.length) return false;
      const container = root.querySelector(".media-scroll-container");
      if (!container) return false;
      const sentinel = container.querySelector(".media-load-sentinel");
      const seen = new Set([...container.querySelectorAll(".media-card")].map((el) => String(el.dataset.mediaKey || "").trim()).filter(Boolean));
      let added = 0;
      for (const item of list) {
        const key = String(item.url || item.title || "").toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const card = createMediaCard(item);
        if (sentinel) container.insertBefore(card, sentinel);
        else container.appendChild(card);
        added += 1;
      }
      return added > 0;
    }

    function renderAnswerMedia() {
      const hasMedia = state.mediaImages.length > 0 || state.mediaVideos.length > 0;
      const videosSection = $("mediaVideosSection");
      const imagesSection = $("mediaImagesSection");
      if (videosSection) videosSection.style.display = state.mediaVideos.length ? "flex" : "none";
      if (imagesSection) imagesSection.style.display = state.mediaImages.length ? "flex" : "none";
      if (!hasMedia) {
        if (videosSection) videosSection.style.display = "none";
        if (imagesSection) imagesSection.style.display = "none";
      }
      renderMediaList("answerMediaImagesGridRight", state.mediaImages, "No images yet.");
      renderMediaList("answerMediaVideosGridLeft", state.mediaVideos, "No videos yet.");
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
      if (state.centerOverlayVisible) hideCenterRequestOverlay();
      state.logs.unshift({ stage, message, level, time: nowTag() });
      updateFlowFromLog(stage, level);
      renderLogs();
      renderFlow();
      if (state.busy && state.runningPreview) {
        renderAnswerMarkdown(buildRunningMarkdown());
      }
      renderRunStageIndicator();
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
        item.className = `flow-badge ${status} ${status === 'active' ? 'active' : ''}`;
        item.innerHTML = `
          <span>${escapeHtml(stage.label)}</span>
        `;
        root.appendChild(item);
      }
      renderRunStageIndicator();
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
      if (!root) return;
      root.classList.toggle("as-rail", state.sourcesLayout === "rail");
      const layoutBtn = $("toggleSourcesLayoutBtn");
      if (layoutBtn) layoutBtn.textContent = state.sourcesLayout === "rail" ? "Sources: Rail" : "Sources: Row";
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

    function getCurrentAnswerText() {
      const raw = String($("answer")?.innerText || "").replace(/\s+/g, " ").trim();
      if (!raw || /^No output yet\.?$/i.test(raw)) return "";
      if (/^Deep Research Running/i.test(raw)) return "";
      return raw;
    }

    function archiveCurrentTurnIfNeeded() {
      const query = normalizeQuery($("userQuery")?.value || state.lastUserQuery || "");
      const answerText = getCurrentAnswerText();
      if (!query || !answerText) return;
      const duplicate = state.turns[0] && state.turns[0].query === query && state.turns[0].answerText === answerText;
      if (duplicate) return;
      const turn = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        query,
        answerText: answerText.slice(0, 12000),
        answerHtml: $("answer")?.innerHTML || "",
        createdAt: new Date().toLocaleString(),
        sources: (state.sources || []).slice(0, 24),
        followups: (state.followups || []).slice(0, 8)
      };
      state.turns.unshift(turn);
      if (state.turns.length > 60) state.turns.length = 60;
      renderTurns();
    }

    function renderTurns() {
      const root = $("threadTurnsList");
      const badge = $("threadCountBadge");
      if (badge) badge.textContent = String((state.turns || []).length);
      if (!root) return;
      root.innerHTML = "";
      if (!state.turns.length) {
        root.innerHTML = '<div class="mono" style="color:#9db0bc">No completed runs yet.</div>';
        return;
      }
      for (const [idx, t] of state.turns.entries()) {
        const rawHtml = String(t.answerHtml || "").trim();
        const rawText = String(t.answerText || "").trim();
        const hasHtmlMarkup = /<[^>]+>/.test(rawHtml);
        const turnRenderedHtml = rawHtml
          ? (hasHtmlMarkup ? rawHtml : markdownToSafeHtml(rawHtml))
          : (rawText ? markdownToSafeHtml(rawText) : `<pre class="turn-answer">${escapeHtml(rawText)}</pre>`);
        const item = document.createElement("article");
        item.className = "turn-item";
        item.innerHTML = `
          <button type="button" class="turn-head" data-turn-toggle="${escapeAttr(t.id)}">
            <span class="turn-title">${escapeHtml(t.query || "Untitled query")}</span>
            <span class="turn-meta">${escapeHtml(t.createdAt || "")}</span>
          </button>
          <div class="turn-body">
            <div class="turn-actions">
              <button type="button" class="btn-action" data-turn-copy="${escapeAttr(t.id)}">Copy</button>
              <button type="button" class="btn-action" data-turn-print="${escapeAttr(t.id)}">Print</button>
            </div>
            <p class="turn-query"><strong>Query:</strong> ${escapeHtml(t.query || "")}</p>
            <div class="turn-answer-html answer-body">${turnRenderedHtml}</div>
          </div>
        `;
        root.appendChild(item);
      }
      root.onclick = async (e) => {
        const toggle = e.target.closest("[data-turn-toggle]");
        if (toggle) {
          const item = toggle.closest(".turn-item");
          if (item) item.classList.toggle("open");
          return;
        }
        const copyBtn = e.target.closest("[data-turn-copy]");
        if (copyBtn) {
          const id = copyBtn.getAttribute("data-turn-copy");
          const turn = state.turns.find((x) => x.id === id);
          if (!turn) return;
          try {
            await navigator.clipboard.writeText(`${turn.query}\n\n${turn.answerText}`);
            setStatus("Turn copied.");
          } catch {
            setStatus("Copy failed.");
          }
          return;
        }
        const printBtn = e.target.closest("[data-turn-print]");
        if (printBtn) {
          const id = printBtn.getAttribute("data-turn-print");
          const turn = state.turns.find((x) => x.id === id);
          if (!turn) return;
          openTurnPrintWindow(turn);
        }
      };
    }

    async function copyAnalysisText() {
      const text = getCurrentAnswerText();
      if (!text) {
        setStatus("No analysis text to copy.");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setStatus("Analysis copied.");
      } catch {
        setStatus("Copy failed.");
      }
    }

    function openTurnPrintWindow(turn) {
      const w = window.open("", "_blank", "noopener,noreferrer,width=980,height=900");
      if (!w) return;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(turn.query || "Research Turn")}</title><style>body{font-family:Arial,sans-serif;margin:26px;color:#0d1217}h1{font-size:20px;margin:0 0 8px}.meta{font-size:12px;color:#5a6b79;margin-bottom:12px}pre{white-space:pre-wrap;line-height:1.5;font-size:13px;border:1px solid #d8e2ea;border-radius:8px;padding:10px;background:#f7fafc}</style></head><body><h1>${escapeHtml(turn.query || "Research Turn")}</h1><div class="meta">${escapeHtml(turn.createdAt || "")}</div><pre>${escapeHtml(turn.answerText || "")}</pre></body></html>`;
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 220);
    }

    function renderDiscovery() {
      const root = $("discoveryGrid");
      if (!root) return;
      const countEl = $("discoveryCount");
      const configured = Number(countEl?.value || state.discoveryCount || DISCOVERY_VISIBLE);
      const visibleCount = Number.isFinite(configured) ? Math.max(6, Math.min(48, configured)) : DISCOVERY_VISIBLE;
      state.discoveryCount = visibleCount;
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
      for (const [idx, item] of state.discovery.slice(0, visibleCount).entries()) {
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
