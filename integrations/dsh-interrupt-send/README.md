# DSH Steer and Override

Adds compact **Steer** and **Override** actions to the active-session composer in the desktop DSH profile. The controls are model-agnostic and remain visible in the native composer toolbar beside the model selector. They enable when a turn is running and the draft is eligible. Colors, typography, hover, and focus styles use DSH theme tokens for light and dark mode.

- **Steer** sends plain text through DSH's session controller with delivery mode `steer`. DSH accepts it into the active turn at a step boundary; a currently running tool must finish first. Attachments, reference chips, and slash commands are disabled for this action so the plugin cannot silently flatten or drop structured input.
- **Override** persists the full draft, cancels the current turn, waits for the selected session to remain idle, then submits once through the regular composer action. That preserves normal slash-command, reference, and attachment handling.

Both controls use DSH's own session and composer APIs. No app.asar patch or model-server change is involved. The two actions are guarded against double submission; errors leave the draft in the composer.

## Build and install

Run `npm run bundle:client` from this directory. The desktop profile includes this package in its bundle list; restart DSH to load an updated browser bundle.
