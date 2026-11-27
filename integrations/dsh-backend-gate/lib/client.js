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
  serving: "Model loaded - waiting for engine output",
  "status-unavailable": "Waiting for backend status - no engine reading available"
};
function elapsedLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1e3));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function statusUrl(sessionId) {
  return `${ROUTE}?sessionId=${encodeURIComponent(sessionId)}`;
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
          const data = await response.json();
          let measured = null;
          try {
            const r = await fetchImpl("/api/dsh-server-tps", { cache: "no-store", signal: controller.signal });
            if (r.ok) measured = await r.json();
          } catch {
          }
          if (active) {
            setRate(measured);
            setSnapshot(data?.sessionId === sessionId ? data : {
              sessionId,
              backend: "local",
              model: "Local inference engine",
              phase: measured && measured.state !== "unavailable" ? "serving" : "status-unavailable",
              observed: true,
              startedAt: Date.now(),
              updatedAt: Date.now()
            });
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
    const compacting = compaction && ["compacting", "saving-summary"].includes(compaction.phase);
    const recentCompaction = compaction?.finishedAt && clock - compaction.finishedAt < 5e3;
    const visible = compacting || recentCompaction || snapshot?.sessionId === sessionId && (!snapshot.observed || running || snapshot.phase === "loading");
    if (!visible) return null;
    const status = snapshot || {};
    const phase = compacting || recentCompaction ? compaction.phase : status.phase;
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
    const phaseLabel = compacting ? phase === "saving-summary" ? "Saving conversation summary" : "Compacting conversation" : phase === "compacted" ? "Compaction finished" : phase === "compaction-error" ? "Compaction failed" : serving ? rate?.state === "live" ? `Engine generating - ${rate.tps.toFixed(1)} tokens/sec` : "Model loaded - no new engine tokens measured" : phaseLabels[phase] || "Waiting for backend status";
    const duration = compaction && (compacting || recentCompaction) ? (compaction.finishedAt || clock) - compaction.startedAt : done || failed ? Math.max(0, (status.finishedAt || Date.now()) - (status.startedAt || Date.now())) : elapsed;
    return h(
      "div",
      {
        "data-maya-model-switch": phase,
        role: "status",
        "aria-live": "polite",
        title: status.error || `${phaseLabel}${compacting ? " - preserving conversation context" : `. Engine token readings are shared across sessions.`}`,
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
      !done && !failed ? h("span", {
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
  });
}
var client_entry_default = apply;

    return module.exports;
  },
});
