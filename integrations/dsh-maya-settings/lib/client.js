window.__ModuleLoader__.load({
  id: "@maya/dsh-maya-settings",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client-entry.js
var client_entry_exports = {};
__export(client_entry_exports, {
  apply: () => apply,
  findNamespace: () => findNamespace,
  name: () => name,
  readMayaValues: () => readMayaValues,
  updateCompactionPatch: () => updateCompactionPatch,
  updateProviderPatch: () => updateProviderPatch
});
module.exports = __toCommonJS(client_entry_exports);

// client-src.js
var React = __toESM(require("react"), 1);
var MAYA_PROVIDER = "maya-local";
var MAYA_MODEL = "inkling-2-mini";
var SETTINGS_ROUTE = "/api/maya-live-settings";
function findNamespace(result, ns) {
  if (result?.ok !== true) throw new Error(result?.error?.message || "Could not read DSH settings");
  const view = result.value?.namespaces?.find((entry) => entry.ns === ns);
  if (!view) throw new Error(`DSH settings namespace not found: ${ns}`);
  return view;
}
function readMayaValues(llmView, compactionView) {
  const provider = llmView.value?.providers?.[MAYA_PROVIDER];
  const model = provider?.models?.find((item) => item.id === MAYA_MODEL);
  if (!model) throw new Error("Maya provider/model entry was not found");
  const policy = compactionView?.value?.modelPolicies?.find((item) => item.provider === MAYA_PROVIDER && item.model === MAYA_MODEL);
  return {
    context: Number(model.contextWindow),
    maxTokens: Number(model.maxTokens),
    modelName: model.name ?? model.id,
    reasoningEfforts: {
      low: model.reasoningEfforts?.low ?? "low",
      medium: model.reasoningEfforts?.medium ?? "medium",
      high: model.reasoningEfforts?.high ?? "high"
    },
    reasoning: provider.reasoning ?? "medium",
    timeoutMs: Number(provider.timeoutMs ?? 18e5),
    streamIdleTimeoutMs: Number(provider.streamIdleTimeoutMs ?? 18e5),
    maxRequestImages: Number(provider.maxRequestImages ?? 50),
    maxRequestImageBytes: Number(provider.maxRequestImageBytes ?? 20 * 1024 * 1024),
    requestImageMaxBytes: Number(provider.requestImageMaxBytes ?? 1024 * 1024),
    requestImagePixelBudget: Number(provider.requestImagePixelBudget ?? 2048 * 2048),
    imageOffloadCountQuantum: Number(provider.imageOffloadCountQuantum ?? 10),
    compactPct: policy ? Math.round(Number(policy.thresholdRatio) * 100) : null
  };
}
function readPresetCompactionValues(view) {
  const value = view?.value;
  if (!value || typeof value !== "object") return null;
  return {
    compactPct: Number(value.compactThresholdPct ?? 65),
    images: value.summarize?.images === "keep" ? "keep" : "strip",
    keepTurns: Number(value.summarize?.keepTurns ?? 5),
    toolChars: Number(value.summarize?.toolChars ?? 2e3),
    capRatio: Number(value.summarize?.capRatio ?? 0.75)
  };
}
function updateProviderPatch(view, patch) {
  const providers = structuredClone(view.value.providers);
  const provider = providers[MAYA_PROVIDER];
  const model = provider?.models?.find((item) => item.id === MAYA_MODEL);
  if (!model) throw new Error("Maya provider/model entry was not found");
  const routeFields = /* @__PURE__ */ new Set([
    "reasoning",
    "timeoutMs",
    "streamIdleTimeoutMs",
    "maxRequestImages",
    "maxRequestImageBytes",
    "requestImageMaxBytes",
    "requestImagePixelBudget",
    "imageOffloadCountQuantum"
  ]);
  for (const [key, value] of Object.entries(patch)) {
    Object.assign(routeFields.has(key) ? provider : model, { [key]: value });
  }
  return { providers };
}
function updateCompactionPatch(view, compactPct) {
  const modelPolicies = structuredClone(view.value.modelPolicies);
  const policy = modelPolicies.find((item) => item.provider === MAYA_PROVIDER && item.model === MAYA_MODEL);
  if (!policy) throw new Error("Maya auto-compaction policy was not found");
  policy.thresholdRatio = compactPct / 100;
  return { modelPolicies };
}
function updatePresetCompactionPatch(view, patch) {
  if (!view?.value || typeof view.value !== "object") throw new Error("Qwen38 preset compaction settings were not found");
  return {
    compactThresholdPct: patch.compactPct,
    summarize: {
      ...view.value.summarize,
      images: patch.images,
      keepTurns: patch.keepTurns,
      toolChars: patch.toolChars,
      capRatio: patch.capRatio
    }
  };
}
function NumberField({ label, value, setValue, min, max, step = 1 }) {
  return React.createElement(
    "label",
    { style: { display: "grid", gap: 6, margin: "12px 0" } },
    React.createElement("span", null, label),
    React.createElement("input", {
      type: "number",
      min,
      max,
      step,
      value,
      onChange: (event) => setValue(event.target.value),
      style: { width: "100%", boxSizing: "border-box", padding: "9px 10px", color: "var(--fg)", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8 }
    })
  );
}
var cardStyle = { border: "1px solid var(--border)", borderRadius: 12, padding: 16, margin: "14px 0", background: "var(--bg-soft)" };
var rowStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 16px" };
var controlStyle = { width: "100%", boxSizing: "border-box", padding: "9px 10px", color: "var(--fg)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 };
function Field({ label, hint, children }) {
  return React.createElement(
    "label",
    { style: { display: "grid", gap: 6, margin: "12px 0" } },
    React.createElement("span", null, label),
    children,
    hint ? React.createElement("small", { style: { opacity: 0.72, lineHeight: 1.45 } }, hint) : null
  );
}
function SelectField({ label, value, options, setValue, hint }) {
  return React.createElement(
    Field,
    { label, hint },
    React.createElement(
      "select",
      { value, onChange: (event) => setValue(event.target.value), style: controlStyle },
      options.map(([id, name2]) => React.createElement("option", { key: id, value: id }, name2))
    )
  );
}
function MayaSettings({ load, describe, update, fetchImpl }) {
  const [state, setState] = React.useState({ status: "loading", error: "", message: "", server: null, llm: null, compactionView: null, defaultPreset: null, draft: null, compactDraft: null, busy: "" });
  const setDraft = (key, value) => setState((current) => ({ ...current, draft: { ...current.draft, [key]: value }, message: "", error: "" }));
  const setCompactDraft = (key, value) => setState((current) => ({ ...current, compactDraft: { ...current.compactDraft, [key]: value }, message: "", error: "" }));
  const reload = async (message = "") => {
    const data = await load();
    const values = readMayaValues(data.llm, null);
    if (Number.isSafeInteger(data.server?.context)) values.context = data.server.context;
    setState({
      status: "ready",
      error: "",
      message,
      server: data.server,
      llm: data.llm,
      compactionView: data.qwen,
      defaultPreset: data.defaultPreset,
      draft: values,
      compactDraft: readPresetCompactionValues(data.qwen),
      busy: ""
    });
  };
  React.useEffect(() => {
    let alive = true;
    Promise.resolve().then(reload).catch((error) => {
      if (alive) setState((current) => ({ ...current, status: "error", error: error.message || String(error), busy: "" }));
    });
    return () => {
      alive = false;
    };
  }, []);
  const applyContext = async () => {
    const context = Number(state.draft.context);
    const min = state.server?.min ?? 4096;
    const max = state.server?.max ?? 262144;
    if (!Number.isSafeInteger(context) || context < min || context > max) {
      setState((current) => ({ ...current, error: `Context must be a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.` }));
      return;
    }
    setState((current) => ({ ...current, busy: "context", error: "", message: "" }));
    try {
      const response = await fetchImpl(SETTINGS_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "context_out_of_range" ? `Maya supports ${Number(data.min).toLocaleString()}\u2013${Number(data.max).toLocaleString()} tokens right now.` : data.error || `Maya context request failed (${response.status})`);
      const latest = findNamespace(await describe(), "llm-pi-ai");
      const saved = await update("llm-pi-ai", updateProviderPatch(latest, { contextWindow: context }), latest.revision);
      if (saved.ok !== true) throw new Error(saved.error?.message || "Maya reloaded, but DSH could not update its model capacity");
      await reload(`Maya accepted ${context.toLocaleString()} tokens. It is reloading its context cache.`);
    } catch (error) {
      setState((current) => ({ ...current, busy: "", error: error.message || String(error) }));
    }
  };
  const saveServing = async () => {
    const d2 = state.draft;
    const maxTokens = Number(d2.maxTokens);
    const reasoning = String(d2.reasoning);
    const positiveFields = ["timeoutMs", "streamIdleTimeoutMs", "maxRequestImages", "maxRequestImageBytes", "requestImageMaxBytes", "requestImagePixelBudget", "imageOffloadCountQuantum"];
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 65536) {
      setState((current) => ({ ...current, error: "Output cap must be a whole number from 256 to 65,536." }));
      return;
    }
    if (maxTokens >= Number(d2.context)) {
      setState((current) => ({ ...current, error: "The maximum response must be smaller than the context window." }));
      return;
    }
    if (!["off", "low", "medium", "high"].includes(reasoning)) {
      setState((current) => ({ ...current, error: "Choose a supported reasoning level." }));
      return;
    }
    if (!["low", "medium", "high"].every((effort) => ["low", "medium", "high"].includes(d2.reasoningEfforts[effort]))) {
      setState((current) => ({ ...current, error: "Each reasoning effort must map to low, medium, or high." }));
      return;
    }
    for (const field of positiveFields) {
      const value = Number(d2[field]);
      if (!Number.isSafeInteger(value) || value <= 0) {
        setState((current) => ({ ...current, error: `${field} must be a positive whole number.` }));
        return;
      }
    }
    setState((current) => ({ ...current, busy: "serving", error: "", message: "" }));
    try {
      const fresh = findNamespace(await describe(), "llm-pi-ai");
      const patch = {
        maxTokens,
        reasoning,
        reasoningEfforts: d2.reasoningEfforts,
        timeoutMs: Number(d2.timeoutMs),
        streamIdleTimeoutMs: Number(d2.streamIdleTimeoutMs),
        maxRequestImages: Number(d2.maxRequestImages),
        maxRequestImageBytes: Number(d2.maxRequestImageBytes),
        requestImageMaxBytes: Number(d2.requestImageMaxBytes),
        requestImagePixelBudget: Number(d2.requestImagePixelBudget),
        imageOffloadCountQuantum: Number(d2.imageOffloadCountQuantum)
      };
      const result = await update("llm-pi-ai", updateProviderPatch(fresh, patch), fresh.revision);
      if (result.ok !== true) throw new Error(result.error?.message || "Could not save Maya serving settings");
      await reload("Serving and image-request settings saved for new requests.");
    } catch (error) {
      setState((current) => ({ ...current, busy: "", error: error.message || String(error) }));
    }
  };
  const saveCompaction = async () => {
    const d2 = state.compactDraft;
    if (!d2) return;
    const pct = Number(d2.compactPct);
    const keepTurns = Number(d2.keepTurns);
    const toolChars = Number(d2.toolChars);
    const capRatio = Number(d2.capRatio);
    if (!Number.isInteger(pct) || pct < 50 || pct > 99 || !Number.isInteger(keepTurns) || keepTurns < 0 || !Number.isInteger(toolChars) || toolChars < 0 || !Number.isFinite(capRatio) || capRatio < 0.1 || capRatio > 2 || !["strip", "keep"].includes(d2.images)) {
      setState((current) => ({ ...current, error: "Check compaction values: trigger 50\u201399%, turns and tool characters 0 or greater, summary ratio 0.1\u20132." }));
      return;
    }
    setState((current) => ({ ...current, busy: "compaction", error: "", message: "" }));
    try {
      const fresh = findNamespace(await describe(), "qwen38");
      const patch = updatePresetCompactionPatch(fresh, { compactPct: pct, images: d2.images, keepTurns, toolChars, capRatio });
      const result = await update("qwen38", patch, fresh.revision);
      if (result.ok !== true) throw new Error(result.error?.message || "Could not save the preset compaction settings");
      await reload("Qwen38 preset compaction settings saved. They apply to sessions using that preset, including Maya.");
    } catch (error) {
      setState((current) => ({ ...current, busy: "", error: error.message || String(error) }));
    }
  };
  const button = (label, action, kind) => React.createElement("button", {
    type: "button",
    disabled: state.busy !== "",
    onClick: action,
    style: { padding: "9px 14px", border: 0, borderRadius: 8, color: "var(--fg)", background: "var(--accent, #6b63ff)", cursor: "pointer", opacity: state.busy !== "" ? 0.65 : 1 }
  }, state.busy === kind ? "Saving\u2026" : label);
  if (state.status === "loading") return React.createElement("div", null, "Loading Maya settings\u2026");
  if (state.status === "error") return React.createElement(
    "section",
    { style: { maxWidth: 740, padding: 12, color: "var(--fg)" } },
    React.createElement("h2", null, "Maya local model"),
    React.createElement("p", { role: "alert", style: { color: "var(--danger, #f66)" } }, state.error)
  );
  const d = state.draft;
  const c = state.compactDraft;
  const server = state.server ?? { status: "unreported" };
  const serverOnline = server.status === "ok";
  const serverLabel = serverOnline ? server.unloaded ? "\xB7 model unloaded" : "\xB7 ready" : server.status === "offline" ? "\xB7 offline" : "\xB7 status not reported by this DSH bridge yet";
  const qwenPresetActive = state.defaultPreset === "qwen38";
  const compactWindow = Number(d.context);
  const output = Number(d.maxTokens);
  const wallGuard = Math.max(1024, Math.min(Math.floor(output / 4), Math.floor((compactWindow - output) / 4)));
  const triggerTokens = c && Number.isFinite(compactWindow) && Number.isFinite(output) && compactWindow > output ? Math.floor(Math.min(compactWindow * Number(c.compactPct) / 100, compactWindow - output - wallGuard)) : null;
  const answerRoom = Math.max(0, output - 8192);
  return React.createElement(
    "section",
    { style: { maxWidth: 760, padding: "8px 0 28px", color: "var(--fg)" } },
    React.createElement("h2", null, "Maya local model"),
    React.createElement("p", null, "Serving, context, image handling, reasoning, and long-session compaction controls."),
    React.createElement(
      "section",
      { style: cardStyle },
      React.createElement("h3", null, `Server ${serverLabel}`),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement("p", null, `Model: ${server.model ?? d.modelName}`),
        React.createElement("p", null, `Maya version: ${server.version ?? "unavailable"}`),
        React.createElement("p", null, `Loaded context: ${Number(server.maxContext ?? d.context).toLocaleString()} tokens`),
        React.createElement("p", null, `Input: ${server.images ? "text + images" : "text only"}${server.videos ? " + video" : ""}`)
      ),
      React.createElement("p", { style: { opacity: 0.72 } }, "Endpoint: http://127.0.0.1:18022/v1 \xB7 the backend gate keeps this route on the local Maya server.")
    ),
    React.createElement(
      "section",
      { style: cardStyle },
      React.createElement("h3", null, "Context and responses"),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement(NumberField, { label: "Context window (tokens)", value: d.context, min: server.min ?? 4096, max: server.max ?? 262144, step: 1024, setValue: (v) => setDraft("context", v) }),
        React.createElement(NumberField, { label: "Maximum response tokens", value: d.maxTokens, min: 256, max: 65536, step: 256, setValue: (v) => setDraft("maxTokens", v) })
      ),
      React.createElement("p", { style: { opacity: 0.72 } }, `Geometry: ${Number(d.context).toLocaleString()} context \u2212 ${Number(d.maxTokens).toLocaleString()} output cap. DSH reserves an 8,192-token answer margin for reasoning/compaction work; visible answer room is currently about ${answerRoom.toLocaleString()} tokens.`),
      React.createElement("p", { style: { opacity: 0.72 } }, "Context changes update DSH\u2019s model catalog and reload Maya. The response cap is a DSH request limit and saves without reloading the model."),
      button("Apply context and reload Maya", applyContext, "context")
    ),
    React.createElement(
      "section",
      { style: cardStyle },
      React.createElement("h3", null, "Reasoning and request reliability"),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement(SelectField, { label: "Default reasoning effort", value: d.reasoning, options: [["off", "Off"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]], setValue: (v) => setDraft("reasoning", v), hint: "New requests use this default; a session\u2019s selected effort can override it." }),
        ...["low", "medium", "high"].map((effort) => React.createElement(SelectField, { key: effort, label: `${effort[0].toUpperCase()}${effort.slice(1)} effort mapping`, value: d.reasoningEfforts[effort], options: [["low", "Send low"], ["medium", "Send medium"], ["high", "Send high"]], setValue: (v) => setDraft("reasoningEfforts", { ...d.reasoningEfforts, [effort]: v }), hint: "Maps DSH\u2019s effort selector to the reasoning effort sent to Maya." })),
        React.createElement(NumberField, { label: "Request timeout (ms)", value: d.timeoutMs, min: 1e3, max: 72e5, step: 1e3, setValue: (v) => setDraft("timeoutMs", v) }),
        React.createElement(NumberField, { label: "Stream idle timeout (ms)", value: d.streamIdleTimeoutMs, min: 1e3, max: 72e5, step: 1e3, setValue: (v) => setDraft("streamIdleTimeoutMs", v) })
      ),
      button("Save serving settings", saveServing, "serving")
    ),
    React.createElement(
      "section",
      { style: cardStyle },
      React.createElement("h3", null, "Images and long multimodal sessions"),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement(NumberField, { label: "Maximum images per request", value: d.maxRequestImages, min: 1, max: 1e6, setValue: (v) => setDraft("maxRequestImages", v), hint: "A very high number removes the normal count cap; request byte size still applies." }),
        React.createElement(NumberField, { label: "Request image byte ceiling", value: d.maxRequestImageBytes, min: 1024, max: 2147483647, step: 1024, setValue: (v) => setDraft("maxRequestImageBytes", v) }),
        React.createElement(NumberField, { label: "Per-image target size (bytes)", value: d.requestImageMaxBytes, min: 1024, max: 2147483647, step: 1024, setValue: (v) => setDraft("requestImageMaxBytes", v) }),
        React.createElement(NumberField, { label: "Per-image pixel budget", value: d.requestImagePixelBudget, min: 1024, max: 1e8, step: 1024, setValue: (v) => setDraft("requestImagePixelBudget", v) }),
        React.createElement(NumberField, { label: "Images offloaded per overflow", value: d.imageOffloadCountQuantum, min: 1, max: 1e6, setValue: (v) => setDraft("imageOffloadCountQuantum", v) })
      ),
      React.createElement("p", { style: { opacity: 0.72 } }, "DSH keeps image requests within the byte ceiling by resizing/offloading older images. Large caps can increase RAM use and request latency."),
      button("Save serving settings", saveServing, "serving")
    ),
    React.createElement(
      "section",
      { style: cardStyle },
      React.createElement("h3", null, "Automatic compaction and summary quality"),
      React.createElement("p", null, state.defaultPreset ? `Default agent preset: ${state.defaultPreset}${qwenPresetActive ? " \u2014 Qwen38 compaction is active for new sessions." : " \u2014 Qwen38 compaction is available but not the default."}` : "Could not read the default agent preset; check Agent presets in DSH."),
      c ? React.createElement(
        React.Fragment,
        null,
        React.createElement("p", { style: { opacity: 0.72 } }, "These controls edit the shared Qwen38 compaction backend. They apply to Maya sessions using the Qwen38 preset; other presets keep their own compaction settings."),
        React.createElement(
          Field,
          { label: `Compaction trigger \xB7 ${Number(c.compactPct)}%`, hint: triggerTokens === null ? "Check that the output cap is smaller than the context window." : `Effective trigger is about ${triggerTokens.toLocaleString()} tokens; the engine applies its output/headroom wall guard (${wallGuard.toLocaleString()} tokens).` },
          React.createElement("input", { type: "range", min: 50, max: 99, step: 1, value: c.compactPct, onChange: (event) => setCompactDraft("compactPct", event.target.value), style: { width: "100%", accentColor: "var(--accent, #6b63ff)" } })
        ),
        React.createElement(
          "div",
          { style: rowStyle },
          React.createElement(SelectField, { label: "Images in summary request", value: c.images, options: [["strip", "Replace with text placeholders"], ["keep", "Include images"]], setValue: (v) => setCompactDraft("images", v) }),
          React.createElement(NumberField, { label: "Reasoning turns retained", value: c.keepTurns, min: 0, max: 1e3, setValue: (v) => setCompactDraft("keepTurns", v), hint: "0 removes retained reasoning turns from the summary prefill." }),
          React.createElement(NumberField, { label: "Tool-result character cap", value: c.toolChars, min: 0, max: 1e7, step: 100, setValue: (v) => setCompactDraft("toolChars", v), hint: "0 disables this trim." }),
          React.createElement(NumberField, { label: "Summary output/prefill ratio", value: c.capRatio, min: 0.1, max: 2, step: 0.05, setValue: (v) => setCompactDraft("capRatio", v) })
        ),
        button("Save compaction settings", saveCompaction, "compaction")
      ) : React.createElement("p", { role: "alert", style: { color: "var(--danger, #f66)" } }, "The Qwen38 local settings namespace is unavailable, so its shared compaction controls cannot be edited here.")
    ),
    state.error ? React.createElement("p", { role: "alert", style: { color: "var(--danger, #f66)" } }, state.error) : null,
    state.message ? React.createElement("p", { role: "status" }, state.message) : null
  );
}
function apply(ctx) {
  ctx.inject(["slots", "remote", "remote.settings"], (clientCtx) => {
    const describe = () => clientCtx.remote.settings.describe();
    const update = (ns, patch, revision) => clientCtx.remote.settings.update(ns, patch, revision);
    const load = async () => {
      const [settings, contextResponse] = await Promise.all([
        describe(),
        fetch("/api/maya-live-settings", { cache: "no-store" })
      ]);
      if (!contextResponse.ok) throw new Error(`Could not read Maya server status (${contextResponse.status})`);
      const contextData = await contextResponse.json();
      const llm = findNamespace(settings, "llm-pi-ai");
      const qwen = settings?.ok === true ? settings.value?.namespaces?.find((entry) => entry.ns === "qwen38") ?? null : null;
      let defaultPreset = null;
      try {
        const rosterService = clientCtx.get("remote.agentPresets") ?? clientCtx.get("remote.agent-presets");
        if (rosterService !== void 0) {
          const roster = await rosterService.list();
          if (roster.ok === true) defaultPreset = roster.value.presets.find((row) => row.isDefault === true)?.id ?? null;
        }
      } catch {
      }
      const server = { ...contextData.server, context: contextData.context, min: contextData.min, max: contextData.max };
      return { llm, qwen, server, defaultPreset };
    };
    clientCtx.slots.inject("settings.section", () => clientCtx.slots.register({
      name: "settings.section",
      id: "maya-live-settings",
      order: 91,
      label: () => "Maya Local",
      inject: () => ({ load, describe, update, fetchImpl: fetch })
    }, MayaSettings));
  });
}
var name = "maya-live-settings";

    return module.exports;
  },
});
