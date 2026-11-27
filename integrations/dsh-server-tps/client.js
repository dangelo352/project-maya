window.__ModuleLoader__.load({
  id: "@maya/dsh-server-tps",
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
var POLL_MS = 1e3;
var STALE_MS = 3200;
var ROUTE = "/api/dsh-server-tps";
function formatPill(snapshot, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.timestamp) || !Number.isFinite(snapshot.approx_tps) || !Number.isFinite(snapshot.active_streams)) {
    return { text: "~TPS \xB7 unavailable", state: "unavailable", title: "LLM stream rate unavailable" };
  }
  const age = now - snapshot.timestamp;
  if (age < -2e3 || age > STALE_MS) {
    return { text: "~TPS \xB7 stale", state: "stale", title: "LLM stream rate is stale" };
  }
  const speed = snapshot.approx_tps.toFixed(1);
  const activity = `${snapshot.active_streams} active stream${snapshot.active_streams === 1 ? "" : "s"}`;
  return {
    text: `~${speed} TPS \xB7 ${activity}`,
    state: "live",
    title: `Approximate output delta rate over ${snapshot.window_ms || 2e3} ms across all DSH providers`
  };
}
function mount(React2, slots, fetchImpl = fetch) {
  const h = React2.createElement;
  function Pill() {
    const [snapshot, setSnapshot] = React2.useState(null);
    const [failed, setFailed] = React2.useState(false);
    React2.useEffect(() => {
      let active = true;
      let timer;
      let requestController;
      const poll = async () => {
        try {
          requestController = new AbortController();
          const response = await fetchImpl(ROUTE, {
            cache: "no-store",
            signal: requestController.signal
          });
          if (!response.ok) throw new Error("unavailable");
          const data = await response.json();
          if (active) {
            setSnapshot(data);
            setFailed(false);
          }
        } catch {
          if (active) setFailed(true);
        } finally {
          requestController = void 0;
          if (active) timer = setTimeout(poll, POLL_MS);
        }
      };
      poll();
      return () => {
        active = false;
        clearTimeout(timer);
        requestController?.abort();
      };
    }, []);
    const status = failed ? { text: "~TPS \xB7 disconnected", state: "stale", title: "DSH aggregate stream endpoint is unreachable" } : formatPill(snapshot);
    return h("span", {
      title: status.title,
      "aria-live": "polite",
      "data-dsh-tps-state": status.state,
      style: {
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        padding: "3px 9px",
        borderRadius: "999px",
        fontSize: "12px",
        lineHeight: 1.4,
        color: status.state === "live" && !failed ? "var(--fg)" : "var(--fg-muted)",
        background: "var(--bg-soft)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, status.text);
  }
  slots.inject("conversation.composer.dock", () => slots.register({
    name: "conversation.composer.dock",
    id: "dsh-server-tps",
    order: 20,
    label: "DSH approximate TPS"
  }, Pill));
}

// client-entry.js
var name = "dsh-server-tps";
var inject = [];
function apply(ctx) {
  ctx.inject(["slots"], (clientCtx) => mount(import_react.default, clientCtx.slots));
}
var client_entry_default = apply;

    return module.exports;
  },
});
