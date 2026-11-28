window.__ModuleLoader__.load({
  id: "@maya/dsh-backend-gate",
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
  default: () => client_entry_default,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_entry_exports);
var import_react = __toESM(require("react"), 1);

// client-src.js
var POLL_MS = 1100;
var ROUTE = "/api/dsh-model-switch-status";
var phaseLabels = {
  waiting: "Preparing model switch",
  "waiting-for-active-request": "Waiting for active DSH work",
  "checking-existing-models": "Checking GPU model state",
  "checking-selected-backend": "Checking selected model",
  unloading: "Releasing current model from GPU",
  loading: "Loading selected model",
  ready: "Model is ready",
  error: "Model switch failed",
  serving: "Model ready - waiting for generation",
  "status-unavailable": "Waiting for backend status - no engine reading available"
};
function elapsedLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1e3));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function statusUrl(sessionId) {
  return `${ROUTE}?sessionId=${encodeURIComponent(sessionId)}`;
}
function observedSnapshot(data, sessionId, measured, now = Date.now()) {
  if (data?.sessionId === sessionId) return data;
  const state = data?.backendStatus?.state;
  const phase = state === "loading" ? "loading" : state === "ready" ? "serving" : !state && measured && measured.state !== "unavailable" ? "serving" : "status-unavailable";
  return {
    sessionId,
    backend: data?.backend || "local",
    model: data?.model || "Local inference engine",
    backendStatus: data?.backendStatus,
    phase,
    observed: true,
    startedAt: now,
    updatedAt: now
  };
}
function prefillView(snapshot) {
  const activity = snapshot?.backendStatus?.activity;
  if (snapshot?.statusUnavailable || activity?.state !== "reading") return null;
  const processed = activity.prompt_read;
  const total = activity.prompt_total;
  const valid = Number.isFinite(processed) && Number.isFinite(total) && processed >= 0 && total > 0 && processed <= total;
  const rate = activity.prefill_tok_s_mean;
  const eta = valid && Number.isFinite(rate) && rate > 0 ? (total - processed) / rate : null;
  const etaSeconds = Number.isFinite(eta) ? Math.ceil(eta) : null;
  const compactCount = (value) => value >= 1e3 ? `${Math.round(value / 1e3)}K` : String(value);
  return {
    processed: valid ? processed : null,
    total: valid ? total : null,
    percent: valid ? processed / total * 100 : null,
    etaSeconds,
    label: `Prefill ${valid ? `${compactCount(processed)} / ${compactCount(total)}` : "- progress unavailable"}${etaSeconds === null ? "" : ` - ETA ${elapsedLabel(etaSeconds * 1e3)}`}`,
    title: `${valid ? `Prefill ${processed} / ${total} tokens. ` : ""}Engine activity is shared across sessions.`
  };
}
function compactionLifecycle(entries) {
  const open = /* @__PURE__ */ new Map();
  let finished = null;
  for (const entry of entries || []) {
    const event = entry.event || entry;
    if (event.type === "turn/start" || event.type === "turn/end" && event.data?.reason?.kind === "aborted") open.clear();
    const id = event.data?.compactionId;
    if (event.type === "compaction/start" && id) {
      open.set(id, { id, phase: "compacting", startedAt: event.time });
    } else if (event.type === "compaction/summary" && open.has(id)) {
      open.set(id, { ...open.get(id), phase: "saving-summary" });
    } else if (event.type === "compaction/end" && open.has(id)) {
      finished = { ...open.get(id), phase: event.data.error ? "compaction-error" : "compacted", finishedAt: event.time };
      open.delete(id);
    }
  }
  return [...open.values()].at(-1) || finished;
}
function mount(React2, slots, remoteSession, fetchImpl = fetch, sessions) {
  const h = React2.createElement;
  function SwitchCard({ sessionId, useSession }) {
    const running = useSession((value) => value.running);
    const [compaction, setCompaction] = React2.useState(null);
    const [clock, setClock] = React2.useState(Date.now());
    const [rate, setRate] = React2.useState(null);
    const [snapshot, setSnapshot] = React2.useState(null);
    const [elapsed, setElapsed] = React2.useState(0);
    const [cancelState, setCancelState] = React2.useState("idle");
    React2.useEffect(() => {
      const source = sessions?.binding(sessionId)?.eventSource;
      if (!source) return void 0;
      const update = () => {
        const next = compactionLifecycle(source.getSnapshot().entries);
        setCompaction((previous) => previous?.id === next?.id && previous?.phase === next?.phase ? previous : next);
      };
      update();
      const unsubscribe = source.subscribe(update);
      const timer = setInterval(() => setClock(Date.now()), 1e3);
      return () => {
        unsubscribe();
        clearInterval(timer);
      };
    }, [sessionId]);
    React2.useEffect(() => {
      if (!sessionId) {
        setSnapshot(null);
        return void 0;
      }
      let active = true;
      let timer;
      let controller;
      let requestTimeout;
      const poll = async () => {
        controller = new AbortController();
        requestTimeout = setTimeout(() => controller?.abort(), 5e3);
        try {
          const response = await fetchImpl(statusUrl(sessionId), {
            cache: "no-store",
            signal: controller.signal
          });
          if (!response.ok) throw new Error(`status endpoint returned HTTP ${response.status}`);
          let data = await response.json();
          if (!data || data.sessionId !== sessionId) {
            try {
              const global = await fetchImpl(ROUTE, { cache: "no-store", signal: controller.signal });
              if (global.ok) data = await global.json() || data;
            } catch {
            }
          }
          let measured = null;
          try {
            const r = await fetchImpl("/api/dsh-server-tps", { cache: "no-store", signal: controller.signal });
            if (r.ok) measured = await r.json();
          } catch {
          }
          if (active) {
            setRate(measured);
            setSnapshot(observedSnapshot(data, sessionId, measured));
            if (!data || data.sessionId !== sessionId || ["ready", "error"].includes(data.phase)) {
              setCancelState("idle");
            }
          }
        } catch {
          if (active) setRate(null);
          if (active) setSnapshot((previous) => previous?.sessionId === sessionId ? { ...previous, statusUnavailable: true } : null);
        } finally {
          clearTimeout(requestTimeout);
          requestTimeout = void 0;
          controller = void 0;
          if (active) timer = setTimeout(poll, POLL_MS);
        }
      };
      void poll();
      return () => {
        active = false;
        clearTimeout(timer);
        clearTimeout(requestTimeout);
        controller?.abort();
      };
    }, [sessionId]);
    React2.useEffect(() => {
      if (!snapshot) return void 0;
      const tick = () => setElapsed(Math.max(0, Date.now() - snapshot.startedAt));
      tick();
      const timer = setInterval(tick, 1e3);
      return () => clearInterval(timer);
    }, [snapshot?.sessionId, snapshot?.startedAt]);
    React2.useEffect(() => {
      setCancelState("idle");
    }, [snapshot?.startedAt]);
    const compacting = compaction && ["compacting", "saving-summary"].includes(compaction.phase);
    const recentCompaction = compaction?.finishedAt && clock - compaction.finishedAt < 5e3;
    const prefill = running && !compacting && !recentCompaction ? prefillView(snapshot) : null;
    const visible = prefill || compacting || recentCompaction || snapshot?.sessionId === sessionId && (!snapshot.observed || running || snapshot.phase === "loading");
    if (!visible) return null;
    const status = snapshot || {};
    const phase = compacting || recentCompaction ? compaction.phase : prefill ? "prefill" : status.phase;
    const serving = phase === "serving";
    const done = phase === "ready" || serving || phase === "compacted";
    const failed = phase === "error" || phase === "compaction-error";
    const waiting = phase === "waiting-for-active-request";
    const blockers = [...new Set(status.blockingSessionIds || [])];
    const modelName = status.model || status.backend || "Local model";
    const trackStyle = {
      height: 5,
      borderRadius: 99,
      overflow: "hidden",
      background: "var(--bg-soft, rgba(127,127,127,.2))",
      marginTop: 11
    };
    const fillStyle = {
      height: "100%",
      width: done ? "100%" : failed ? "100%" : "38%",
      borderRadius: 99,
      background: failed ? "var(--danger, #ef6262)" : "var(--dsw-alias-state-business-primary)",
      transformOrigin: "left center",
      animation: done || failed ? "none" : "maya-switch-travel 1.45s ease-in-out infinite",
      transition: "width .28s ease"
    };
    const stopAndSwitch = async () => {
      if (cancelState !== "idle" || blockers.length === 0) return;
      setCancelState("stopping");
      try {
        const results = await Promise.all(blockers.map((id) => remoteSession.cancel({ sessionId: id })));
        const failure = results.find((result) => result?.ok === false);
        setCancelState(failure ? `failed:${failure.error?.message || "DSH refused the stop request"}` : "sent");
      } catch (error) {
        setCancelState(`failed:${error?.message || "Could not contact DSH"}`);
      }
    };
    const textColor = failed ? "var(--danger, #ef6262)" : "var(--dsw-alias-label-primary)";
    const phaseLabel = compacting ? phase === "saving-summary" ? "Saving conversation summary" : "Compacting conversation" : phase === "compacted" ? "Compaction finished" : phase === "compaction-error" ? "Compaction failed" : prefill ? prefill.label : serving ? rate?.state === "live" && Number.isFinite(rate.tps) && !["idle", "unknown"].includes(status.backendStatus?.activity?.state) ? `Engine generating - ${rate.tps.toFixed(1)} tokens/sec` : "Model ready - waiting for generation" : phaseLabels[phase] || "Waiting for backend status";
    const duration = compaction && (compacting || recentCompaction) ? (compaction.finishedAt || clock) - compaction.startedAt : done || failed ? Math.max(0, (status.finishedAt || Date.now()) - (status.startedAt || Date.now())) : elapsed;
    return h(
      "div",
      {
        "data-maya-model-switch": phase,
        role: "status",
        "aria-live": "polite",
        title: status.error || prefill?.title || `${phaseLabel}${compacting ? " - preserving conversation context" : `. Engine token readings are shared across sessions.`}`,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 22,
          width: "100%",
          maxWidth: "var(--dsh-composer-card-max-width)",
          boxSizing: "border-box",
          padding: "0 12px",
          margin: "0 auto 3px",
          fontFamily: "var(--dsw-font-family)",
          color: failed ? "var(--dsw-alias-state-danger, #c33)" : "var(--dsw-alias-label-secondary)",
          fontSize: 12,
          lineHeight: "20px"
        }
      },
      h("style", null, "[data-chat-running]{display:none!important}@keyframes maya-switch-travel{0%{transform:translateX(-110%)}100%{transform:translateX(285%)}}@media(prefers-reduced-motion:reduce){[data-maya-model-switch] i{animation:none!important}}"),
      prefill ? prefill.percent !== null ? h("span", {
        role: "progressbar",
        "aria-label": "Prefill - shared engine",
        "aria-valuemin": 0,
        "aria-valuemax": prefill.total,
        "aria-valuenow": prefill.processed,
        "aria-valuetext": `${prefill.processed} / ${prefill.total} tokens`,
        style: { width: 42, height: 3, borderRadius: 4, overflow: "hidden", flex: "0 0 auto", background: "var(--dsw-alias-border-l2)" }
      }, h("i", { style: { display: "block", width: `${prefill.percent}%`, height: "100%", background: "var(--dsw-alias-state-business-primary)" } })) : null : !done && !failed ? h("span", {
        role: "progressbar",
        "aria-label": phaseLabel,
        style: { width: 42, height: 3, borderRadius: 4, overflow: "hidden", flex: "0 0 auto", background: "var(--dsw-alias-border-l2)" }
      }, h("i", { style: { display: "block", width: "38%", height: "100%", background: "var(--dsw-alias-state-business-primary)", animation: "maya-switch-travel 1.45s ease-in-out infinite" } })) : null,
      h(
        "span",
        { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        status.error ? `Load failed: ${status.error}` : phaseLabel
      ),
      compacting || !status.observed ? h("span", { style: { marginLeft: "auto", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" } }, elapsedLabel(compacting ? clock - compaction.startedAt : duration)) : null
    );
  }
  slots.inject("conversation.input.dock", () => slots.register({
    name: "conversation.input.dock",
    id: "maya-model-switch-card",
    order: -20,
    label: "Live local-model switch status"
  }, SwitchCard));
}

// unload-client.js
var localModelRoute = "/api/dsh-local-model";
var pollIntervalMs = 4e3;
var noticeDurationMs = 15e3;
var unloadSlot = "conversation.input.model.options";
var localBackends = /* @__PURE__ */ new Set(["qwen", "maya", "hyperinkling"]);
var warning = "Unload all local GPU models. Normal unload parks Qwen in RAM and prefetches Maya\u2019s weights into the Windows file cache when memory permits. Fully unload stops engines and background prefetch. Windows reclaims file cache as needed.";
async function requestLocalModels(fetchImpl, { sessionId, signal, unload = false, mode = "normal", csrfToken } = {}) {
  const freshToken = async () => {
    const snapshot = await requestLocalModels(fetchImpl, { signal });
    if (typeof snapshot.csrfToken !== "string" || !snapshot.csrfToken.trim()) {
      throw new Error("Local model endpoint did not provide a CSRF token. Refresh status and retry.");
    }
    return snapshot.csrfToken;
  };
  const options = { method: unload ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal };
  if (unload) {
    const token = typeof csrfToken === "string" && csrfToken.trim() ? csrfToken : await freshToken();
    options.headers = { "Content-Type": "application/json", "x-dsh-csrf-token": token };
    options.body = JSON.stringify({ backend: "all", mode, ...sessionId ? { sessionId } : {} });
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(localModelRoute, options);
    let data;
    try {
      data = await response.json();
    } catch {
    }
    if (unload && attempt === 0 && response.status === 403 && data?.error === "csrf_token_required") {
      options.headers = { ...options.headers, "x-dsh-csrf-token": await freshToken() };
      continue;
    }
    if (!response.ok || data?.ok !== true) {
      const message = data?.message || data?.error || `Local model endpoint returned HTTP ${response.status}`;
      throw new Error(response.status === 409 ? `Local models are busy. ${message}` : message);
    }
    if (unload && !["unloaded", "already_idle"].includes(data.status)) {
      throw new Error("Local model endpoint did not confirm unload. Check status and retry.");
    }
    return data;
  }
}
function unloadView(snapshot, { inFlight = false, locked = false, notice = null, statusError = null, now = Date.now() } = {}) {
  const backends = (snapshot?.backends || []).filter((item) => localBackends.has(item.backend));
  const hidden = backends.length === 0 || backends.every((item) => ["offline", "unloaded"].includes(item.state) && !item.checkpointCache);
  const busy = locked || inFlight || !!snapshot?.backendBusy || !!snapshot?.transitioning || snapshot?.unload?.phase === "unloading" || snapshot?.activeRequests > 0 || snapshot?.pendingRequests > 0;
  const recent = notice && now - notice.at < noticeDurationMs ? notice : null;
  const success = recent?.kind === "success" && backends.every((item) => (recent.mode === "full" ? ["offline", "unloaded", "sleeping"] : ["offline", "unloaded", "sleeping", "parked"]).includes(item.state));
  const error = recent?.kind === "error" ? recent.message : statusError || (snapshot?.unload?.phase === "error" ? snapshot.unload.error || "Unload failed. Retry when idle." : null);
  const states = backends.map((item) => {
    const name2 = { qwen: "Qwen", maya: "Maya", hyperinkling: "Hyperinkling" }[item.backend];
    const cache = { warming: "warming weight cache", prefetched: "weights prefetched" }[item.checkpointCache];
    const state = item.backend === "qwen" && item.state === "parked" ? "ready in RAM" : cache || item.state || "unknown";
    return `${name2}: ${state}`;
  }).join(" \xB7 ");
  return {
    visible: inFlight || !hidden || !!recent,
    disabled: busy || !!statusError || !snapshot || hidden,
    busy,
    label: error ? `Unload unavailable: ${error}` : inFlight || snapshot?.unload?.phase === "unloading" ? "Unloading local models\u2026" : success && !backends.some((item) => item.state === "parked" || item.checkpointCache) ? recent.mode === "full" ? "Fully unloaded \xB7 model RAM released" : "Model unloaded \xB7 next request resumes or reloads" : states || "Local models unavailable",
    error: !!error,
    title: `${error ? `${error} ` : ""}${warning}${busy ? " Waiting for local backend work to finish." : ""}`
  };
}
function mountUnload(React2, slots, fetchImpl = fetch) {
  const h = React2.createElement;
  function UnloadControl({ sessionId, useSession, locked = false, reportFailure }) {
    const boundSessionId = useSession((value) => value.sessionId);
    const [snapshot, setSnapshot] = React2.useState(null);
    const [statusError, setStatusError] = React2.useState(null);
    const [notice, setNotice] = React2.useState(null);
    const [inFlight, setInFlight] = React2.useState(false);
    const request = React2.useRef(null);
    const mounted = React2.useRef(false);
    const refresh = React2.useRef(null);
    React2.useEffect(() => {
      mounted.current = true;
      let active = true;
      let timer, controller, timeout;
      const poll = async () => {
        clearTimeout(timer);
        controller?.abort();
        const current = new AbortController();
        controller = current;
        clearTimeout(timeout);
        timeout = setTimeout(() => current.abort(), 8e3);
        try {
          const data = await requestLocalModels(fetchImpl, { signal: current.signal });
          if (active && controller === current && !request.current) {
            setSnapshot(data);
            setStatusError(null);
          }
        } catch (error) {
          if (active && controller === current && !request.current) setStatusError(error?.message || "Status unavailable. Retry shortly.");
        } finally {
          if (controller === current) {
            clearTimeout(timeout);
            if (active) timer = setTimeout(poll, pollIntervalMs);
          }
        }
      };
      refresh.current = poll;
      void poll();
      return () => {
        active = false;
        mounted.current = false;
        refresh.current = null;
        clearTimeout(timer);
        clearTimeout(timeout);
        controller?.abort();
        request.current?.abort();
      };
    }, []);
    React2.useEffect(() => {
      if (!notice) return void 0;
      const timer = setTimeout(() => setNotice(null), Math.max(0, notice.at + noticeDurationMs - Date.now()));
      return () => clearTimeout(timer);
    }, [notice]);
    const view = unloadView(snapshot, { inFlight: !!inFlight, locked, notice, statusError });
    const unload = async (mode = "normal") => {
      if (request.current || view.disabled) return;
      const controller = new AbortController();
      request.current = controller;
      setInFlight(mode);
      try {
        await requestLocalModels(fetchImpl, { unload: true, mode, sessionId: sessionId || boundSessionId, signal: controller.signal, csrfToken: snapshot?.csrfToken });
        if (mounted.current) {
          setNotice({ kind: "success", mode, at: Date.now() });
          setStatusError(null);
        }
      } catch (error) {
        if (mounted.current) {
          const message = error?.message || "Unload failed. Retry when idle.";
          setNotice({ kind: "error", message, at: Date.now() });
          reportFailure?.(message);
        }
      } finally {
        if (request.current === controller) request.current = null;
        if (mounted.current) {
          setInFlight(false);
          void refresh.current?.();
        }
      }
    };
    if (!view.visible) return null;
    return h(
      "div",
      {
        "data-maya-model-unload": true,
        "aria-busy": view.busy,
        title: view.title,
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 0,
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          fontFamily: "var(--dsw-font-family)",
          color: "var(--dsw-alias-label-secondary)",
          fontSize: 12,
          lineHeight: "18px"
        }
      },
      ...["normal", "full"].map((mode) => h("button", {
        key: mode,
        type: "button",
        role: "menuitem",
        disabled: view.disabled,
        onClick: () => unload(mode),
        "aria-label": mode === "full" ? "Fully unload \u2014 all local GPU backends; release model RAM" : "Unload model \u2014 all local GPU backends; prepare for reload",
        "aria-busy": inFlight === mode,
        title: mode === "full" ? "Stop local engines and release model RAM. Next request cold loads the model." : view.title,
        style: {
          font: "inherit",
          fontSize: 13,
          lineHeight: "20px",
          textAlign: "left",
          color: view.disabled ? "var(--dsw-alias-label-dimmed)" : mode === "full" ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-label-primary)",
          border: 0,
          borderRadius: "var(--dsw-radius-md)",
          padding: "7px 8px",
          minHeight: 34,
          width: "100%",
          maxWidth: "100%",
          cursor: view.disabled ? "default" : "pointer"
        }
      }, inFlight === mode ? "Unloading\u2026" : mode === "full" ? "Fully unload \xB7 release RAM" : "Unload model")),
      h("span", { role: "status", "aria-live": "polite", style: {
        minWidth: 0,
        padding: "0 8px 4px",
        overflowWrap: "anywhere",
        color: view.error ? "var(--dsw-alias-state-error-primary)" : "inherit"
      } }, view.label),
      h("style", null, "[data-maya-model-unload] button{background:transparent}[data-maya-model-unload] button:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}[data-maya-model-unload] button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}")
    );
  }
  slots.inject(unloadSlot, () => slots.register({
    name: unloadSlot,
    id: "maya-model-unload",
    order: 100,
    label: "Unload local GPU models"
  }, UnloadControl));
}

// client-entry.js
var name = "maya-model-switch-card";
var inject = [];
function apply(ctx) {
  ctx.inject(["slots", "sessions"], (clientCtx) => {
    const sessionActions = {
      cancel: ({ sessionId }) => {
        const session = clientCtx.sessions.binding(sessionId)?.session;
        if (!session) throw new Error("The selected DSH session is no longer available.");
        return session.cancel();
      }
    };
    mount(import_react.default, clientCtx.slots, sessionActions, fetch, clientCtx.sessions);
    mountUnload(import_react.default, clientCtx.slots, fetch);
  });
}
var client_entry_default = apply;

    return module.exports;
  },
});
