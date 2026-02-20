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

    function needsEnglishTranslation(text) {
      return /[\u0590-\u05FF\u0600-\u06FF\u0400-\u04FF]/.test(String(text || ""));
    }

    async function maybeTranslatePromptToEnglish({ text, lmBase, model, enabled = true }) {
      const raw = normalizeQuery(text);
      if (!enabled || !raw) return raw;
      if (!needsEnglishTranslation(raw)) return raw;
      try {
        const out = await lmChat({
          lmBase,
          payload: {
            model,
            temperature: 0,
            max_tokens: 1400,
            messages: [
              {
                role: "system",
                content: "Translate the user request into clear natural English. Preserve URLs, numbers, names, and technical terms. Return translated text only."
              },
              { role: "user", content: raw }
            ]
          }
        });
        const translated = normalizeQuery(out?.choices?.[0]?.message?.content || "");
        return translated || raw;
      } catch (err) {
        addDebug("translate", `Translation fallback: ${err.message}`, "warn");
        return raw;
      }
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
      if (/(forecast|prediction|price target|opinion)/i.test(source.title) && !/\b(data|dataset|methodology|table|report)\b/i.test(source.content || "")) score -= 1.4;

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

    function isQuantitativeQuery(text) {
      const q = String(text || "").toLowerCase();
      if (!q) return false;
      return /\b(volatility|correlation|sharpe|sortino|drawdown|cagr|irr|roi|alpha|beta|risk[- ]adjusted|allocation|portfolio|backtest|stress test|scenario|valuation|forecast|investment|liquidity)\b/.test(q);
    }

    function hasNumericEvidenceInSources(sources = []) {
      const joined = sources
        .slice(0, 12)
        .map((s) => `${s?.title || ""} ${s?.content || ""}`)
        .join(" ")
        .toLowerCase();
      const hasNumber = /\b\d+([.,]\d+)?%?\b/.test(joined);
      const hasMetricWord = /\b(volatility|correlation|drawdown|cagr|yield|inflation|rate|return|std|standard deviation|sharpe|risk)\b/.test(joined);
      return hasNumber && hasMetricWord;
    }

    function buildQuantFollowups(userQuery, maxFollowUpQueries = 2) {
      const base = normalizeQuery(userQuery);
      const templates = [
        `${base} historical volatility and max drawdown with explicit numbers by period`,
        `${base} correlation matrix and rolling correlation with numeric values`,
        `${base} risk-adjusted returns (Sharpe/Sortino) and assumptions`,
        `${base} scenario analysis (bull/base/bear) with quantified ranges`
      ];
      return uniqueStrings(templates).slice(0, Math.max(1, maxFollowUpQueries));
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

    function runtimeDateContextLine() {
      const now = new Date();
      const localDate = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
      const localTime = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
      return `Temporal context: Today is ${localDate}. Local time is ${localTime}. Use this as the current date reference and avoid outdated year assumptions.`;
    }

    function withRuntimeDateContext(payload = {}) {
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const injected = {
        role: "system",
        content: runtimeDateContextLine()
      };
      return { ...payload, messages: [injected, ...messages] };
    }

    async function lmChat({ lmBase, payload }) {
      const runtime = getProviderRuntime();
      const base = runtime.base || lmBase;
      const scope = runtime.provider;
      const payloadWithCtx = withRuntimeDateContext(payload);

      if (runtime.provider === "anthropic") {
        if (!runtime.apiKey) throw new Error("Anthropic key is missing.");
        const firstUser = (payloadWithCtx?.messages || []).find((m) => m.role === "user")?.content || "";
        const systemText = (payloadWithCtx?.messages || [])
          .filter((m) => m.role === "system")
          .map((m) => String(m.content || ""))
          .join("\n\n")
          .trim();
        const mergedUser = [systemText, String(firstUser || "")].filter(Boolean).join("\n\n");
        const raw = await fetchJson(`${base.replace(/\/$/, "")}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": runtime.apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: runtime.model || "claude-3-5-sonnet-latest",
            max_tokens: payloadWithCtx.max_tokens || 1200,
            messages: [{ role: "user", content: mergedUser }]
          })
        }, { scope, label: "Anthropic messages" });
        const parsed = extractChatContent(raw, runtime.provider);
        return { choices: [{ message: { content: parsed.content, reasoning_content: parsed.reasoning } }] };
      }

      if (runtime.provider === "gemini") {
        if (!runtime.apiKey) throw new Error("Gemini key is missing.");
        const firstUser = (payloadWithCtx?.messages || []).find((m) => m.role === "user")?.content || "";
        const systemText = (payloadWithCtx?.messages || [])
          .filter((m) => m.role === "system")
          .map((m) => String(m.content || ""))
          .join("\n\n")
          .trim();
        const mergedUser = [systemText, String(firstUser || "")].filter(Boolean).join("\n\n");
        const url = `${base.replace(/\/$/, "")}/models/${encodeURIComponent(runtime.model || "gemini-1.5-pro")}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`;
        const raw = await fetchJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: mergedUser }] }]
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
        body: JSON.stringify(payloadWithCtx)
      }, { scope, label: `${runtime.provider} chat/completions` });
    }

    async function lmChatStream({ lmBase, payload, onText }) {
      const runtime = getProviderRuntime();
      const payloadWithCtx = withRuntimeDateContext(payload);
      if (runtime.provider === "anthropic" || runtime.provider === "gemini") {
        const oneShot = await lmChat({ lmBase, payload: payloadWithCtx });
        const content = String(oneShot?.choices?.[0]?.message?.content || "");
        if (typeof onText === "function") onText(content);
        return { content, reasoning: "" };
      }

      const base = runtime.base || lmBase;
      const headers = { "Content-Type": "application/json" };
      if (runtime.provider === "openai" && runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;
      const url = `${base.replace(/\/$/, "")}/chat/completions`;
      const finalPayload = { ...payloadWithCtx, stream: true };
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
      const quantMode = isQuantitativeQuery(query);
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
              quantMode
                ? "Query is quantitative: include queries that target numeric datasets, historical time-series, and methodology pages (not only narrative articles)."
                : "",
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
      const quantMode = isQuantitativeQuery(userQuery);
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
            content: [
              "You are Refiner Agent. Improve query quality, remove duplicates, maximize coverage.",
              "Favor high-authority technical sources.",
              quantMode ? "User asks quantitative analysis: ensure at least one query explicitly asks for numeric metrics and historical data." : "",
              "Return strict JSON only."
            ].filter(Boolean).join(" ")
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
        queries: (() => {
          const base = uniqueStrings(Array.isArray(parsed?.queries) ? parsed.queries : initialQueries).slice(0, maxQueries);
          if (!quantMode) return base;
          const hasMetricQuery = base.some((q) => /\b(volatility|correlation|drawdown|cagr|sharpe|scenario|risk[- ]adjusted)\b/i.test(q));
          if (hasMetricQuery) return base;
          const extra = `${normalizeQuery(userQuery)} quantitative metrics volatility correlation drawdown`;
          return uniqueStrings([...base, extra]).slice(0, maxQueries);
        })()
      };
    }

    async function criticAgent({ lmBase, model, userQuery, currentQueries, sources, maxFollowUpQueries, stylePrompt = "" }) {
      const quantMode = isQuantitativeQuery(userQuery);
      const hasNumericEvidence = hasNumericEvidenceInSources(sources);
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
              quantMode
                ? "For quantitative asks, require explicit numeric evidence. If metrics are missing, force needMoreSearch=true."
                : "",
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
      let needMoreSearch = !!parsed?.needMoreSearch;
      let reason = String(parsed?.reason || "fallback");
      let followUpQueries = uniqueStrings(Array.isArray(parsed?.followUpQueries) ? parsed.followUpQueries : []).slice(0, maxFollowUpQueries);
      let sourceQualityScore = Math.max(0, Math.min(100, Number(parsed?.sourceQualityScore) || 40));
      let coverageScore = Math.max(0, Math.min(100, Number(parsed?.coverageScore) || 40));
      let freshnessScore = Math.max(0, Math.min(100, Number(parsed?.freshnessScore) || 40));
      let overallScore = Math.max(0, Math.min(100, Number(parsed?.overallScore) || 40));
      const missingAngles = uniqueStrings(Array.isArray(parsed?.missingAngles) ? parsed.missingAngles : []).slice(0, 6);
      const contradictions = uniqueStrings(Array.isArray(parsed?.contradictions) ? parsed.contradictions : []).slice(0, 5);

      if (quantMode && !hasNumericEvidence) {
        needMoreSearch = true;
        reason = `Missing numeric evidence for quantitative request. ${reason}`.trim();
        followUpQueries = uniqueStrings([...followUpQueries, ...buildQuantFollowups(userQuery, maxFollowUpQueries)]).slice(0, maxFollowUpQueries);
        sourceQualityScore = Math.min(sourceQualityScore, 55);
        coverageScore = Math.min(coverageScore, 50);
        overallScore = Math.min(overallScore, 50);
      }
      return {
        needMoreSearch,
        reason,
        followUpQueries,
        sourceQualityScore,
        coverageScore,
        freshnessScore,
        overallScore,
        missingAngles,
        contradictions
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
