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
async function requestStepOverride(sessionId, identity, fetchImpl = fetch) {
  const response = await fetchImpl("/api/dsh-step-override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, ...identity })
  });
  const result = await response.json();
  if (!response.ok || !result.accepted) throw new Error(result.error || "Step override was not accepted.");
  return result;
}
async function promoteQueuedMessage(face, itemId, interrupt = false, stepOverride) {
  if (interrupt) {
    if (!stepOverride) throw new Error("Step override service unavailable; nothing was stopped.");
    return stepOverride(itemId);
  }
  const result = await face.updateQueue(itemId, { kind: "steer" });
  if (!result?.ok) throw new Error(result?.error?.message || "The queued message could not be steered.");
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
    const canSubmit = Boolean(sessionId && hasDraft(input) && ["plain", "claimed"].includes(input?.phase) && typeof inputActions?.persistDraft === "function" && typeof inputActions?.submit === "function");
    if (!sessionId) return null;
    const draft = input?.draft?.trim() || "";
    const canSteer = canSubmit && Boolean(draft) && (input?.attachmentIds?.length ?? 0) === 0 && (input?.occurrences?.length ?? 0) === 0 && !input?.claim && !draft.startsWith("/") && typeof sessions?.binding === "function";
    const steer = async () => {
      if (actionRef.current || !canSteer) return;
      actionRef.current = true;
      setBusyAction("steer");
      setNotice("");
      try {
        const before = sessionRef.current;
        const text = inputRef.current?.draft?.trim();
        if (!before || before.sessionId !== sessionId || !text) {
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
        const face = sessions.binding(sessionId)?.session;
        if (!face) throw new Error("The selected session is no longer available.");
        const plainText = canSteer;
        const text = inputRef.current?.draft?.trim();
        if (plainText && text) {
          const submission = face.beginSubmission({ mode: "steer", text, attachments: [] });
          const result = await face.prompt([{ type: "text", text }], "steer", void 0, submission.requestId);
          if (!result?.ok) throw new Error(result?.error?.message || "DSH refused the new message.");
          let deliveryNotice = "Message delivered.";
          if (face.getSnapshot().running) {
            try {
              await requestStepOverride(sessionId, { requestId: submission.requestId });
              deliveryNotice = "Step overridden - goal continues.";
            } catch (error) {
              deliveryNotice = `Message sent; step override unavailable: ${error.message}`;
            }
          }
          if (sessionRef.current?.sessionId === sessionId && inputRef.current?.draft?.trim() === text) {
            actionsRef.current.setDraft("");
            actionsRef.current.persistDraft();
          }
          setNotice(deliveryNotice);
        } else {
          throw new Error("Step override currently requires a plain-text draft. Use queued Send now to preserve attached messages.");
        }
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
      notice ? h("span", { role: "status", "aria-live": "polite", title: notice, style: { maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "var(--dsw-alias-label-primary)" } }, notice) : null,
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
  function QueuedMessages({ sessionId, useSession, useProjection }) {
    const running = useSession((value) => value.running);
    const pending = useSession((value) => value.pendingSubmissions || []);
    const inbox = useProjection("inbox");
    const queue = inbox?.["next-turn"] || [];
    const [busy, setBusy] = React2.useState(null);
    const [notice, setNotice] = React2.useState("");
    const [editing, setEditing] = React2.useState(null);
    const locked = React2.useRef(false);
    const admitted = new Set(queue.map((row) => row.source?.rpcId).filter(Boolean));
    const sending = pending.filter((row) => row.placement === "queued" && !admitted.has(row.requestId));
    if (!queue.length && !sending.length) return null;
    const action = async (row, kind, content) => {
      if (locked.current) return;
      const face = sessions.binding(sessionId)?.session;
      if (!face) {
        setNotice("This session is no longer available.");
        return;
      }
      locked.current = true;
      setBusy(row.id);
      setNotice("");
      try {
        if (kind === "steer" || kind === "override") {
          await promoteQueuedMessage(face, row.id, kind === "override", (itemId) => requestStepOverride(sessionId, { itemId }));
          setNotice(kind === "override" ? "Current step overridden; goal continues." : "Queued message will be read after the current step.");
        } else {
          const result = await face.updateQueue(row.id, kind === "edit" ? { kind: "edit", content: [{ type: "text", text: content }] } : { kind: "remove" });
          if (!result?.ok) throw new Error(result?.error?.message || "Queue update failed.");
          setEditing(null);
        }
      } catch (error) {
        setNotice(error?.message || "Queue action failed. Check the message before retrying.");
      } finally {
        locked.current = false;
        setBusy(null);
      }
    };
    const control = (label, title, onClick, disabled) => h("button", {
      type: "button",
      title,
      "aria-label": title,
      onClick,
      disabled,
      style: { ...buttonStyle(), color: "var(--dsw-alias-label-primary)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.65 : 1 }
    }, label);
    return h(
      "section",
      {
        "data-dsh-queued-actions": "",
        "aria-label": "Queued messages",
        style: { width: "100%", maxWidth: "var(--dsh-composer-card-max-width)", boxSizing: "border-box", margin: "0 auto 6px", padding: "6px 8px", borderRadius: "var(--dsw-radius-md, 12px)", background: "var(--dsw-specific-input-major)", border: "1px solid var(--dsw-alias-border-l2)", fontFamily: "var(--dsw-font-family)", color: "var(--dsw-alias-label-primary)" }
      },
      h("style", null, "[data-queue-dock]{display:none!important}[data-dsh-queued-actions] button:enabled:hover{background:var(--dsw-alias-interactive-bg-hover)}[data-dsh-queued-actions] button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}[data-dsh-queued-actions] .dsh-queued-row{display:flex;align-items:center;gap:6px;min-height:32px;flex-wrap:wrap}[data-dsh-queued-actions] .dsh-queued-preview{flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;padding:0 4px}"),
      h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", padding: "0 4px 3px" } }, `${queue.length + sending.length} queued`),
      ...queue.map((row) => {
        const content = row.content || [];
        const text = content.filter((block) => block.type === "text").map((block) => block.text).join("");
        const attachments = content.filter((block) => block.type !== "text").length;
        const mutable = row.source?.kind === "user";
        return h(
          "div",
          { key: row.id, className: "dsh-queued-row" },
          editing?.id === row.id ? h("input", { "aria-label": "Edit queued message", value: editing.text, onChange: (event) => setEditing({ id: row.id, text: event.target.value }), style: { flex: "1 1 180px", minWidth: 80, padding: "5px 8px", font: "inherit", fontSize: 13, border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, color: "var(--dsw-alias-label-primary)", background: "var(--dsw-specific-input-major)" } }) : h("span", { className: "dsh-queued-preview", title: text }, `${text || "Attached message"}${attachments ? ` (${attachments} attachment${attachments === 1 ? "" : "s"})` : ""}`),
          editing?.id === row.id ? h(
            React2.Fragment,
            null,
            control("Save", "Save queued message", () => action(row, "edit", editing.text), busy !== null || !editing.text.trim()),
            control("Cancel", "Cancel editing", () => setEditing(null), busy !== null)
          ) : mutable ? h(
            React2.Fragment,
            null,
            control("Edit", "Edit queued message", () => setEditing({ id: row.id, text }), busy !== null || attachments > 0),
            control("Steer", "Steer this queued message", () => action(row, "steer"), busy !== null || !running),
            control("Send now", "Stop current step and send this queued message", () => action(row, "override"), busy !== null || !running),
            control("\uFFFD", "Remove queued message", () => action(row, "remove"), busy !== null)
          ) : null
        );
      }),
      ...sending.map((row) => h("div", { key: row.requestId, className: "dsh-queued-row" }, h("span", { className: "dsh-queued-preview" }, row.text || "Attached message"), h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" } }, "Sending\uFFFD"))),
      notice ? h("div", { role: "status", "aria-live": "polite", style: { fontSize: 11, padding: "3px 4px", color: "var(--dsw-alias-label-secondary)" } }, notice) : null
    );
  }
  slots.inject("conversation.input.dock", () => slots.register({
    name: "conversation.input.dock",
    id: "dsh-queued-message-actions",
    order: 10,
    label: "Interactive queued messages"
  }, QueuedMessages));
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
