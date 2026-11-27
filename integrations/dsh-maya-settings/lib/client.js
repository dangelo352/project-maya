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
    compactPct: policy ? Math.round(Number(policy.thresholdRatio) * 100) : null
  };
}
function updateProviderPatch(view, patch) {
  const providers = structuredClone(view.value.providers);
  const provider = providers[MAYA_PROVIDER];
  const model = provider?.models?.find((item) => item.id === MAYA_MODEL);
  if (!model) throw new Error("Maya provider/model entry was not found");
  Object.assign(model, patch);
  return { providers };
}
function updateCompactionPatch(view, compactPct) {
  const modelPolicies = structuredClone(view.value.modelPolicies);
  const policy = modelPolicies.find((item) => item.provider === MAYA_PROVIDER && item.model === MAYA_MODEL);
  if (!policy) throw new Error("Maya auto-compaction policy was not found");
  policy.thresholdRatio = compactPct / 100;
  return { modelPolicies };
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
function MayaSettings({ load, describe, update, fetchImpl }) {
  const [state, setState] = React.useState({ status: "loading", error: "", message: "", views: null, draft: null, busy: false });
  const setDraft = (key, value) => setState((current) => ({ ...current, draft: { ...current.draft, [key]: value }, message: "", error: "" }));
  const reload = async (message = "") => {
    const [settings, contextResponse] = await Promise.all([
      describe(),
      fetchImpl(SETTINGS_ROUTE, { cache: "no-store" })
    ]);
    if (!contextResponse.ok) throw new Error(`Could not read Maya context (${contextResponse.status})`);
    const context = await contextResponse.json();
    const llm = findNamespace(settings, "llm-pi-ai");
    const compaction = settings?.ok === true ? settings.value?.namespaces?.find((entry) => entry.ns === "compaction-basic") ?? null : null;
    const values = readMayaValues(llm, compaction);
    values.context = Number(context.context);
    setState({ status: "ready", error: "", message, views: { llm, compaction }, draft: values, busy: false });
  };
  React.useEffect(() => {
    let alive = true;
    Promise.resolve().then(reload).catch((error) => {
      if (alive) setState((current) => ({ ...current, status: "error", error: error.message || String(error), busy: false }));
    });
    return () => {
      alive = false;
    };
  }, []);
  const applyContext = async () => {
    const context = Number(state.draft.context);
    if (!Number.isSafeInteger(context) || context < 4096 || context > 262144) {
      setState((current) => ({ ...current, error: "Context must be a whole number from 4,096 to 262,144." }));
      return;
    }
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
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
      if (saved.ok !== true) throw new Error(saved.error?.message || "Could not update the DSH model menu capacity");
      await reload(`Maya accepted ${context.toLocaleString()} tokens. The model is reloading; chats may pause briefly.`);
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message || String(error) }));
    }
  };
  const saveServing = async () => {
    const maxTokens = Number(state.draft.maxTokens);
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 65536) {
      setState((current) => ({ ...current, error: "Output cap must be a whole number from 256 to 65,536." }));
      return;
    }
    const compactPct = state.draft.compactPct === null ? null : Number(state.draft.compactPct);
    if (compactPct !== null && (!Number.isSafeInteger(compactPct) || compactPct < 50 || compactPct > 95)) {
      setState((current) => ({ ...current, error: "Auto-compaction must be from 50% to 95%." }));
      return;
    }
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
    try {
      const fresh = await describe();
      const llm = findNamespace(fresh, "llm-pi-ai");
      const llmResult = await update("llm-pi-ai", updateProviderPatch(llm, { maxTokens }), llm.revision);
      if (llmResult.ok !== true) throw new Error(llmResult.error?.message || "Could not save Maya output cap");
      if (compactPct !== null) {
        const compaction = findNamespace(fresh, "compaction-basic");
        const compactionResult = await update("compaction-basic", updateCompactionPatch(compaction, compactPct), compaction.revision);
        if (compactionResult.ok !== true) {
          const afterFailure = findNamespace(await describe(), "llm-pi-ai");
          await update("llm-pi-ai", updateProviderPatch(afterFailure, { maxTokens: Number(llm.value.providers[MAYA_PROVIDER].models.find((item) => item.id === MAYA_MODEL).maxTokens) }), afterFailure.revision);
          throw new Error(compactionResult.error?.message || "Could not save Maya auto-compaction threshold; output cap was restored");
        }
      }
      await reload(compactPct === null ? "Maya output cap updated. Auto-compaction remains managed by the active DSH preset." : "Maya output cap and auto-compaction updated for new requests.");
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message || String(error) }));
    }
  };
  const button = (label, onClick) => React.createElement("button", {
    type: "button",
    disabled: state.busy || state.status !== "ready",
    onClick,
    style: { padding: "9px 14px", border: 0, borderRadius: 8, color: "var(--fg)", background: "var(--accent, #6b63ff)", cursor: "pointer", opacity: state.busy ? 0.65 : 1 }
  }, state.busy ? "Applying\u2026" : label);
  if (state.status === "loading") return React.createElement("div", null, "Loading Maya settings\u2026");
  return React.createElement(
    "section",
    { style: { maxWidth: 520, padding: "8px 0", color: "var(--fg)" } },
    React.createElement("h2", null, "Maya local model"),
    React.createElement("p", null, "Edit Maya\u2019s context and response cap from DSH."),
    state.draft ? React.createElement(
      React.Fragment,
      null,
      React.createElement(NumberField, { label: "Context window (tokens)", value: state.draft.context, min: 4096, max: 262144, step: 1024, setValue: (v) => setDraft("context", v) }),
      React.createElement("p", null, "Applying a context change reloads Maya. The chat can pause briefly while weights and cache are rebuilt."),
      button("Apply context and reload Maya", applyContext),
      React.createElement("hr", { style: { margin: "22px 0", opacity: 0.25 } }),
      React.createElement(NumberField, { label: "Maximum response tokens", value: state.draft.maxTokens, min: 256, max: 65536, step: 256, setValue: (v) => setDraft("maxTokens", v) }),
      state.draft.compactPct !== null ? React.createElement(NumberField, { label: "Auto-compaction trigger (%)", value: state.draft.compactPct, min: 50, max: 95, setValue: (v) => setDraft("compactPct", v) }) : React.createElement("p", null, "Auto-compaction is controlled by the active DSH preset. This profile does not expose that policy as a live setting."),
      React.createElement("p", null, state.draft.compactPct !== null ? "These settings update the DSH provider and compaction policy without restarting DSH or Maya." : "The response cap updates DSH live. Context changes reload Maya."),
      button("Save Maya settings", saveServing)
    ) : null,
    state.error ? React.createElement("p", { role: "alert", style: { color: "var(--danger, #f66)" } }, state.error) : null,
    state.message ? React.createElement("p", { role: "status" }, state.message) : null
  );
}
function apply(ctx) {
  ctx.inject(["slots", "remote", "remote.settings"], (clientCtx) => {
    const describe = () => clientCtx.remote.settings.describe();
    const update = (ns, patch, revision) => clientCtx.remote.settings.update(ns, patch, revision);
    clientCtx.slots.inject("settings.section", () => clientCtx.slots.register({
      name: "settings.section",
      id: "maya-live-settings",
      order: 91,
      label: () => "Maya Local",
      inject: () => ({ load: describe, describe, update, fetchImpl: fetch })
    }, MayaSettings));
  });
}
var name = "maya-live-settings";

    return module.exports;
  },
});
