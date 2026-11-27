# DSH Interrupt & Send

Adds an explicit **Stop & send now** action while a DeepSeek Harness session is running and the composer contains a draft.

The action saves the draft, requests DSH's normal session cancellation, waits for the selected session to report idle, then submits the latest composer contents through DSH's regular input API. That preserves the normal handling of slash commands, references, and uploaded attachment receipts. A double-click cannot submit twice. If cancellation fails, the session changes, the composer becomes invalid, or DSH does not become idle within two minutes, the action reports the problem and leaves the draft in place.

This is intentionally an explicit third action. Ordinary Queue and Steer keep their existing meanings. DSH Steer is consumed at a step boundary, so it cannot interrupt a long model request or blocking tool call. Already-running external side effects are not rolled back by cancellation.

The extension occupies the built-in `conversation.input.dock` slot and uses the public client `remote.session.cancel`, `inputActions.persistDraft`, and `inputActions.submit` APIs. No app.asar patch or model-server change is required.

## Build

Run `npm run bundle:client` from this directory, then add this package to the desktop profile dependencies and bundle list. Restart DSH to load the client module.
