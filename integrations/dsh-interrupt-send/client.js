window.__ModuleLoader__.load({
  id: "@maya/dsh-interrupt-send",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
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
var WAIT_POLL_MS = 100;
var IDLE_STABLE_MS = 250;
var CANCEL_TIMEOUT_MS = 12e4;
async function waitForIdle(readSession, sessionId, options = {}) {
  const pollMs = options.pollMs ?? WAIT_POLL_MS;
  const stableMs = options.stableMs ?? IDLE_STABLE_MS;
  const timeoutMs = options.timeoutMs ?? CANCEL_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let idleSince;
  while (now() - started <= timeoutMs) {
    const session = readSession();
    if (!session || session.sessionId !== sessionId || session.removed) {
      throw new Error("The selected session changed while stopping; your draft is still saved.");
    }
    if (!session.running) {
      idleSince ??= now();
      if (now() - idleSince >= stableMs) return;
    } else {
      idleSince = void 0;
    }
    await sleep(pollMs);
  }
  throw new Error("DSH has not reached idle yet. Your draft is still in the composer; try again after the current tool finishes.");
}
function hasDraft(input) {
  return Boolean(input && (input.draft?.trim() || input.attachmentIds?.length));
}
function mount(React2, slots, remoteSession) {
  const h = React2.createElement;
  function InterruptSend({ session, input, inputActions }) {
    const [phase, setPhase] = React2.useState("idle");
    const [message, setMessage] = React2.useState("");
    const sessionRef = React2.useRef(session);
    const inputRef = React2.useRef(input);
    const actionsRef = React2.useRef(inputActions);
    const operationRef = React2.useRef(false);
    const mountedRef = React2.useRef(true);
    sessionRef.current = session;
    inputRef.current = input;
    actionsRef.current = inputActions;
    React2.useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);
    const canSubmit = hasDraft(input) && ["plain", "claimed"].includes(input?.phase) && typeof inputActions?.persistDraft === "function" && typeof inputActions?.submit === "function";
    const visible = Boolean(session?.running && canSubmit) || phase === "stopping";
    const interruptAndSend = async () => {
      if (operationRef.current || !session?.sessionId || !canSubmit || typeof remoteSession?.cancel !== "function") return;
      const sessionId = session.sessionId;
      operationRef.current = true;
      setPhase("stopping");
      setMessage("Saving your draft and stopping the active turn\u2026");
      try {
        actionsRef.current.persistDraft();
        const result = await remoteSession.cancel({ sessionId });
        if (result?.ok === false || result?.accepted === false) {
          throw new Error(result.error?.message || result.message || "DSH did not accept the stop request.");
        }
        await waitForIdle(() => sessionRef.current, sessionId);
        const latestSession = sessionRef.current;
        const latestInput = inputRef.current;
        const latestActions = actionsRef.current;
        if (latestSession?.sessionId !== sessionId || latestSession.running) {
          throw new Error("The session started again before your message could be sent. Your draft is still saved.");
        }
        if (!hasDraft(latestInput) || !["plain", "claimed"].includes(latestInput?.phase)) {
          throw new Error("The composer changed while DSH was stopping. Your draft is still saved.");
        }
        latestActions.submit();
        setPhase("sent");
        setMessage("Stopped the previous turn and sent the latest draft.");
      } catch (error) {
        setPhase("error");
        setMessage(error?.message || "Could not stop and send. Your draft remains in the composer.");
      } finally {
        operationRef.current = false;
      }
    };
    if (!visible) return null;
    const busy = phase === "stopping";
    const tone = phase === "error" ? "var(--danger, #ef6262)" : "var(--fg-muted, #a4aab6)";
    return h(
      "section",
      {
        "data-dsh-interrupt-send": phase,
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          margin: "0 0 7px",
          padding: "7px 10px",
          border: "1px solid var(--border, rgba(150,160,180,.2))",
          borderRadius: 11,
          background: "var(--bg-soft, rgba(127,127,127,.08))"
        }
      },
      h("span", {
        role: phase === "error" ? "alert" : "status",
        "aria-live": "polite",
        style: { minWidth: 0, fontSize: 11, lineHeight: 1.4, color: tone }
      }, message || "Stop this turn and deliver the current draft as a new turn."),
      h("button", {
        type: "button",
        onClick: interruptAndSend,
        disabled: busy || !canSubmit,
        title: "Cancel the current turn, wait until DSH is idle, then send the latest composer draft once.",
        style: {
          flex: "0 0 auto",
          border: "1px solid var(--border, rgba(150,160,180,.28))",
          borderRadius: 9,
          padding: "7px 10px",
          color: "var(--fg, #ededed)",
          background: "var(--bg, rgba(40,40,45,.8))",
          cursor: busy ? "wait" : "pointer",
          opacity: busy || !canSubmit ? 0.6 : 1,
          fontSize: 11,
          fontWeight: 600
        }
      }, busy ? "Stopping\u2026" : phase === "error" ? "Retry stop & send" : "Stop & send now")
    );
  }
  slots.inject("conversation.input.dock", () => slots.register({
    name: "conversation.input.dock",
    id: "dsh-interrupt-send",
    order: 100,
    label: "Interrupt the active turn and send the latest draft"
  }, InterruptSend));
}

// client-entry.js
var name = "dsh-interrupt-send";
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
