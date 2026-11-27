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
function buttonStyle() {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    flex: "0 0 auto",
    height: 28,
    padding: "0 8px",
    border: "none",
    borderRadius: "var(--dsw-radius-sm, 8px)",
    color: "var(--dsw-alias-label-primary)",
    background: "transparent",
    fontFamily: "var(--dsw-font-family)",
    fontSize: 13,
    lineHeight: "20px",
    fontWeight: 500,
    whiteSpace: "nowrap",
    transition: "background-color 100ms ease"
  };
}
function mount(React2, slots, remoteSession, sessions) {
  const h = React2.createElement;
  function BusyDraftActions({ useSession, useInput, inputActions }) {
    const session = useSession((value) => value);
    const input = useInput((value) => value);
    const [busyAction, setBusyAction] = React2.useState("");
    const [notice, setNotice] = React2.useState("");
    const sessionRef = React2.useRef(session);
    const inputRef = React2.useRef(input);
    const actionsRef = React2.useRef(inputActions);
    const actionRef = React2.useRef(false);
    sessionRef.current = session;
    inputRef.current = input;
    actionsRef.current = inputActions;
    const sessionId = session?.sessionId;
    const canSubmit = Boolean(session?.running && sessionId && hasDraft(input) && ["plain", "claimed"].includes(input?.phase) && typeof inputActions?.persistDraft === "function" && typeof inputActions?.submit === "function");
    if (!sessionId) return null;
    const draft = input?.draft?.trim() || "";
    const canSteer = canSubmit && Boolean(draft) && input?.attachmentIds?.length === 0 && input?.occurrences?.length === 0 && !input?.claim && !draft.startsWith("/") && typeof sessions?.binding === "function";
    const steer = async () => {
      if (actionRef.current || !canSteer) return;
      actionRef.current = true;
      setBusyAction("steer");
      setNotice("");
      try {
        const before = sessionRef.current;
        const text = inputRef.current?.draft?.trim();
        if (!before?.running || before.sessionId !== sessionId || !text) {
          throw new Error("The active turn or draft changed. Nothing was sent.");
        }
        actionsRef.current.persistDraft();
        const binding = sessions.binding(sessionId);
        if (!binding?.session?.prompt || !binding.session.beginSubmission) {
          throw new Error("DSH could not access the active session. Your draft is still saved.");
        }
        const submission = binding.session.beginSubmission({ mode: "steer", text, attachments: [] });
        const result = await binding.session.prompt(
          [{ type: "text", text }],
          "steer",
          void 0,
          submission.requestId
        );
        if (!result?.ok) throw new Error(result?.error?.message || "DSH did not accept the steer.");
        const latest = sessionRef.current;
        const latestInput = inputRef.current;
        if (latest?.sessionId !== sessionId || latestInput?.draft?.trim() !== text) {
          throw new Error("The steer was accepted, but the composer changed before it could be cleared. Check the conversation before resending.");
        }
        actionsRef.current.setDraft("");
        setNotice("Steer accepted \xB7 takes effect at the next step boundary.");
      } catch (error) {
        setNotice(error?.message || "Steer failed; your draft remains in the composer.");
      } finally {
        actionRef.current = false;
        setBusyAction("");
      }
    };
    const override = async () => {
      if (actionRef.current || !canSubmit || typeof remoteSession?.cancel !== "function") return;
      actionRef.current = true;
      setBusyAction("override");
      setNotice("Saving draft and stopping the active turn\u2026");
      try {
        actionsRef.current.persistDraft();
        const result = await remoteSession.cancel({ sessionId });
        if (result?.ok === false || result?.accepted === false) {
          throw new Error(result.error?.message || result.message || "DSH did not accept the stop request.");
        }
        await waitForIdle(() => sessionRef.current, sessionId);
        const latestSession = sessionRef.current;
        const latestInput = inputRef.current;
        if (latestSession?.sessionId !== sessionId || latestSession.running) {
          throw new Error("The session started again before the draft could be sent. Your draft is still saved.");
        }
        if (!hasDraft(latestInput) || !["plain", "claimed"].includes(latestInput?.phase)) {
          throw new Error("The composer changed while DSH was stopping. Your draft is still saved.");
        }
        actionsRef.current.submit();
        setNotice("Previous turn stopped \xB7 latest draft sent as a new turn.");
      } catch (error) {
        setNotice(error?.message || "Override failed; your draft remains in the composer.");
      } finally {
        actionRef.current = false;
        setBusyAction("");
      }
    };
    const disabled = !canSubmit || Boolean(busyAction);
    return h(
      "div",
      {
        "data-dsh-busy-draft-actions": "",
        role: "group",
        "aria-label": "Message delivery",
        style: { display: "inline-flex", alignItems: "center", flex: "0 0 auto", gap: 2 }
      },
      h("style", null, `[data-dsh-busy-draft-actions] button:enabled{cursor:pointer}[data-dsh-busy-draft-actions] button:enabled:hover{background:var(--dsw-alias-interactive-bg-hover)}[data-dsh-busy-draft-actions] button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}[data-dsh-busy-draft-actions] button:disabled{cursor:default;color:var(--dsw-alias-label-secondary)}@media(pointer:coarse){[data-dsh-busy-draft-actions] button{min-height:36px}}`),
      notice ? h("span", { role: "status", "aria-live": "polite", style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" } }, notice) : null,
      h("button", {
        type: "button",
        onClick: steer,
        disabled: disabled || !canSteer,
        title: canSteer ? "Send this text into the current turn; it is picked up at the next step boundary." : "Steer supports plain text only. Use Override for attachments, references, or slash commands.",
        style: buttonStyle()
      }, busyAction === "steer" ? "Steering\u2026" : "Steer"),
      h("button", {
        type: "button",
        onClick: override,
        disabled,
        title: "Stop the current turn, wait for DSH to become idle, then send the full composer draft as a new turn.",
        style: buttonStyle()
      }, busyAction === "override" ? "Overriding\u2026" : "Override")
    );
  }
  slots.inject("conversation.input.right", () => slots.register({
    name: "conversation.input.right",
    id: "dsh-busy-draft-actions",
    order: 100,
    label: "Steer the active turn or stop it and send a new turn"
  }, BusyDraftActions));
}

// client-entry.js
var name = "dsh-interrupt-send";
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
    mount(import_react.default, clientCtx.slots, sessionActions, clientCtx.sessions);
  });
}
var client_entry_default = apply;

    return module.exports;
  },
});
