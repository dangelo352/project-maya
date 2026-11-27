# DSH Steer and Override

Adds compact **Steer** and **Override** actions to the active-session composer in the desktop DSH profile. The controls are model-agnostic and remain visible in the native composer toolbar beside the model selector. They enable whenever the draft is eligible, including after a failed or stopped turn. Colors, typography, hover, and focus styles use DSH theme tokens for light and dark mode.

- **Steer** sends plain text through DSH's session controller with delivery mode `steer`. DSH accepts it into the active turn at a step boundary; a currently running tool must finish first. Attachments, reference chips, and slash commands are disabled for this action so the plugin cannot silently flatten or drop structured input.
- **Override** persists the draft and requests cancellation. For plain text it then delivers through the native steer inbox immediately after cancellation acceptance, avoiding the idle-window race with automatic goals. Structured drafts wait for cancellation to settle before using the regular composer action, preserving slash commands, references, and attachment handling. Stop acceptance does not imply that external tool side effects have been undone.

Both controls use DSH's own session and composer APIs. No app.asar patch or model-server change is involved. The two actions are guarded against double submission; errors leave the draft in the composer.

## Build and install

Run `npm run bundle:client` from this directory. The desktop profile includes this package in its bundle list; restart DSH to load an updated browser bundle.

Action acknowledgements and errors appear beside the buttons. `node --test test/buttons.test.js` checks duplicate-click exclusion, failed-turn input, cancellation refusal, and auto-goal cancellation races.

## Queued messages

An interactive queue strip replaces the built-in queue presentation while pending messages exist. It uses the Host inbox projection and preserves native message IDs. Each user-authored row offers Edit (plain text only), Steer, Send now (promote then request cancellation), and Remove. Attachments remain Host-owned and are never copied into a second prompt. Uploads awaiting Host admission appear as Sending with no mutation controls. Queue mutations surface errors when the item has already been consumed; a failed promotion never cancels unrelated work. The Host still owns step-boundary steering and cancellation timing.
