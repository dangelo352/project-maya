# DSH message delivery controls

Native themed composer and queued-message controls shared by the desktop profile's models.

- Steer promotes input at the next step boundary.
- Override / queued Send now uses the host step-override route. It refreshes an active goal's continuation revision, retains the exact pending message and attachments, interrupts the current activity with a distinct hook cause, and wakes the agent with that message. The goal's objective and round counter are retained. It never calls the ordinary user-stop action.
- Standard DSH Stop remains a user stop.
- Queued rows provide Edit (plain text), Steer, Send now, and Remove. Host-owned item IDs are retained; messages are not copied into duplicate prompts.

The host entry is `index.js`, which exports `step-override.js`. The client uses `/api/dsh-step-override` through DSH's authenticated connection. A read-only inspection flag verifies goal service availability without interrupting a task. Service resolution uses Cordis Context.get rather than an undeclared service-property access.

Build with `npm run bundle:client`. Run `node --test test/buttons.test.js` for goal preservation, message identity, cancellation/wakeup order, consumed-message fencing, and the Cordis service-access regression.
