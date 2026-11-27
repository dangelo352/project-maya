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
  error: "Model switch failed"
};
function elapsedLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1e3));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function statusUrl(sessionId) {
  return `${ROUTE}?sessionId=${encodeURIComponent(sessionId)}`;
}
function canStopForSwitch(snapshot, sessionId) {
  return snapshot?.sessionId === sessionId && snapshot?.phase === "waiting-for-active-request" && Array.isArray(snapshot.blockingSessionIds) && snapshot.blockingSessionIds.length > 0;
}
function backendDetail(snapshot) {
  const state = snapshot?.backendStatus?.state;
  if (state === "loading") return "Backend reports that weights are loading.";
  if (state === "unloaded") return "Backend confirms the model is not resident yet.";
  if (state === "ready") return "Backend confirms the model is loaded and ready.";
  if (state === "sleeping") return "Backend reports the model is asleep; waking it now.";
  if (state === "error") return snapshot.backendStatus.error || "Backend reported a load error.";
  return "Waiting for the local backend status endpoint.";
}
function mount(React2, slots, remoteSession, fetchImpl = fetch) {
  const h = React2.createElement;
  function SwitchCard({ sessionId }) {
    const [snapshot, setSnapshot] = React2.useState(null);
    const [elapsed, setElapsed] = React2.useState(0);
    const [cancelState, setCancelState] = React2.useState("idle");
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
          const data = await response.json();
          if (active) {
            setSnapshot(data?.sessionId === sessionId ? data : null);
            if (!data || data.sessionId !== sessionId || ["ready", "error"].includes(data.phase)) {
              setCancelState("idle");
            }
          }
        } catch {
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
    const visible = snapshot?.sessionId === sessionId;
    if (!visible) return null;
    const phase = snapshot.phase;
    const done = phase === "ready";
    const failed = phase === "error";
    const waiting = phase === "waiting-for-active-request";
    const blockers = [...new Set(snapshot.blockingSessionIds || [])];
    const modelName = snapshot.model || snapshot.backend;
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
      background: failed ? "var(--danger, #ef6262)" : "var(--accent, #77aaff)",
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
    const textColor = failed ? "var(--danger, #ef6262)" : "var(--fg, #ededed)";
    const phaseLabel = phaseLabels[phase] || "Switching local model";
    const duration = done || failed ? Math.max(0, (snapshot.finishedAt || Date.now()) - snapshot.startedAt) : elapsed;
    return h(
      "section",
      {
        "data-maya-model-switch": phase,
        role: "status",
        "aria-live": "polite",
        style: {
          position: "relative",
          display: "block",
          overflow: "hidden",
          margin: "8px 0",
          padding: "13px 15px",
          borderRadius: 14,
          border: "1px solid var(--border, rgba(150,160,180,.2))",
          background: "linear-gradient(115deg, var(--bg-soft, rgba(127,127,127,.08)), var(--bg, rgba(40,40,45,.96)))",
          color: textColor,
          boxShadow: "0 8px 24px rgba(0,0,0,.12)"
        }
      },
      h("style", null, "@keyframes maya-switch-travel{0%{transform:translateX(-110%)}100%{transform:translateX(285%)}}@keyframes maya-switch-pulse{0%,100%{transform:scale(.9);filter:saturate(.8)}50%{transform:scale(1.06);filter:saturate(1.25)}}"),
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10 } },
        h("span", {
          "aria-hidden": true,
          style: {
            width: 28,
            height: 28,
            flex: "0 0 28px",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "radial-gradient(circle at 35% 30%, #dbeafe, #6c9eff 48%, #3451a3)",
            boxShadow: done ? "0 0 18px rgba(100,180,255,.55)" : "0 0 13px rgba(100,150,255,.32)",
            animation: done || failed ? "none" : "maya-switch-pulse 1.8s ease-in-out infinite"
          }
        }, "\u2726"),
        h(
          "div",
          { style: { minWidth: 0, flex: 1 } },
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" } },
            h("strong", { style: { fontSize: 13, fontWeight: 650 } }, `${done ? "Ready" : failed ? "Switch issue" : "Switching"} \xB7 ${modelName}`),
            h("span", { style: { fontSize: 11, color: "var(--fg-muted, #9ca3af)", whiteSpace: "nowrap" } }, elapsedLabel(duration))
          ),
          h("div", { style: { marginTop: 3, fontSize: 12, color: "var(--fg-muted, #a4aab6)" } }, phaseLabel)
        )
      ),
      h("div", {
        role: "progressbar",
        "aria-label": `Loading ${modelName}`,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        ...done ? { "aria-valuenow": 100 } : {},
        "aria-valuetext": done ? "Backend reports ready" : phaseLabel,
        style: trackStyle
      }, h("div", { style: fillStyle })),
      h(
        "div",
        { style: { display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", marginTop: 8 } },
        h(
          "span",
          { style: { fontSize: 11, lineHeight: 1.45, color: "var(--fg-muted, #9ca3af)" } },
          snapshot.error ? snapshot.error : snapshot.statusUnavailable ? "Live status endpoint temporarily unavailable." : backendDetail(snapshot)
        ),
        canStopForSwitch(snapshot, sessionId) && typeof remoteSession?.cancel === "function" ? h("button", {
          type: "button",
          onClick: stopAndSwitch,
          disabled: cancelState === "stopping",
          style: {
            flex: "0 0 auto",
            border: "1px solid var(--border, rgba(150,160,180,.25))",
            borderRadius: 9,
            padding: "7px 10px",
            color: "var(--fg, #ededed)",
            background: "var(--bg-soft, rgba(127,127,127,.12))",
            cursor: "pointer",
            fontSize: 11
          }
        }, cancelState === "stopping" ? "Stopping\u2026" : `Stop ${blockers.length} active ${blockers.length === 1 ? "turn" : "turns"} & switch`) : null
      ),
      cancelState === "sent" ? h("div", { style: { marginTop: 6, fontSize: 11, color: "var(--fg-muted, #9ca3af)" } }, "Stop sent to DSH. Queued inbox work remains in the session.") : null,
      cancelState.startsWith("failed:") ? h("div", { role: "alert", style: { marginTop: 6, fontSize: 11, color: "var(--danger, #ef6262)" } }, cancelState.slice(7)) : null,
      !done && !failed ? h("div", { style: { marginTop: 5, fontSize: 10, color: "var(--fg-muted, #8f96a3)" } }, "The backend exposes load phases, not a reliable percentage; the moving bar is indeterminate until it confirms ready.") : null
    );
  }
  slots.inject("conversation.composer.dock", () => slots.register({
    name: "conversation.composer.dock",
    id: "maya-model-switch-card",
    order: -20,
    label: "Live local-model switch status"
  }, SwitchCard));
}

// client-entry.js
var name = "maya-model-switch-card";
var inject = ["slots", "remote.session"];
function apply(ctx) {
  ctx.inject(["slots", "remote.session"], (clientCtx) => {
    mount(import_react.default, clientCtx.slots, clientCtx.remote.session);
  });
}
var client_entry_default = apply;

    return module.exports;
  },
});
