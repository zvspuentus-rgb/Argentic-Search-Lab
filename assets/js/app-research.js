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
      const autoRun = $("autoRunDiscovery")?.checked;
      const input = $("userQuery");
      $("contextUrls").value = item.url || "";

      if (autoRun) {
        // Auto-run should not inject a long editable template and run simultaneously.
        const directQuery = normalizeQuery(`${item.title || ""}\n${item.content || ""}`) || (item.title || "Summarize this source");
        input.value = directQuery;
        input.style.height = "auto";
        input.style.height = (input.scrollHeight) + "px";
        setStatus("Running discovery item...");
        runPipeline();
        return;
      }

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
      input.value = focus;
      input.style.height = 'auto';
      input.style.height = (input.scrollHeight) + 'px';
      expandChat();
      setStatus("Discovery item loaded. Edit the prompt or press send.");
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

    function buildAttachmentContextBlock() {
      const items = Array.isArray(state.attachments) ? state.attachments : [];
      if (!items.length) return "";
      const lines = ["Attached files context:"];
      for (const [idx, a] of items.slice(0, 8).entries()) {
        lines.push(`${idx + 1}. ${a.name} (${a.kind || a.type || "file"}, ${a.size || 0} bytes)`);
        if (a.text) lines.push(`   Content excerpt: ${String(a.text).slice(0, 1800)}`);
      }
      return lines.join("\n");
    }

    async function prepareEnglishQuery(rawQuery, lmBase, model) {
      const enabled = $("autoTranslatePrompts")?.checked ?? true;
      return await maybeTranslatePromptToEnglish({
        text: normalizeQuery(rawQuery),
        lmBase,
        model,
        enabled
      });
    }

    function composeModelQuery(englishQuery) {
      return [normalizeQuery(englishQuery), buildAttachmentContextBlock()].filter(Boolean).join("\n\n");
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
      const englishQuery = await prepareEnglishQuery(cleanQuery, lmBase, model);
      const modelQuery = composeModelQuery(englishQuery);
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
          userQuery: modelQuery,
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
      cleanQuery,
      modelQuery
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
          userQuery: modelQuery || cleanQuery,
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

      const hasAttachments = Array.isArray(state.attachments) && state.attachments.length > 0;
      let cleanQuery = normalizeQuery(rawQuery);
      if (!cleanQuery && !hasAttachments) {
        setStatus("Please enter a query.");
        expandChat();
        return;
      }
      if (!cleanQuery && hasAttachments) cleanQuery = "Analyze attached files";
      state.lastUserQuery = cleanQuery;
      cleanQuery = await prepareEnglishQuery(cleanQuery, lmBase, model);
      const modelQuery = composeModelQuery(cleanQuery);
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
            userQuery: modelQuery,
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
          cleanQuery,
          modelQuery
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
      state.attachments = [];
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
            userQuery: modelQuery,
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
          userQuery: modelQuery,
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
      if (typeof renderAttachmentTray === "function") renderAttachmentTray();
      renderConversationTree();
      updateAnswerMeta();
      setStatus("New session ready.");
      expandChat();
      saveUiState();
    }
