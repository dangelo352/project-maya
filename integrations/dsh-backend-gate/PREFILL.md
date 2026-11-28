# Native Maya prefill progress

The existing compact model-status row now distinguishes model residency, prompt prefill and output generation. Maya health and JSON metrics are read concurrently; only the allowlisted live state, prompt counters, reused prefix and prefill rate leave the backend boundary. Request history, log tails and arbitrary metrics fields are never forwarded.

For running chats, `reading` takes precedence over output TPS. A valid pair of native `prompt_read` / `prompt_total` counters drives the real progress bar; the compact label uses rounded K counts while its accessible label keeps exact counts. ETA is `(total - read) / prefill_tok_s_mean`, rounded up to seconds. The reused prefix is already included in read progress, so it is not subtracted again. Invalid counters omit determinate progress; invalid or unknown rates omit ETA. No assumed 1,000 TPS or timer-based fake percentages are used.

When a scoped snapshot belongs to a different active session, the client obtains a shared engine observation and preserves its activity while dropping foreign control ownership. Shared activity is described in the tooltip and is hidden in idle chats. Stale/unavailable status is not treated as real prefill progress. Compaction lifecycle status remains independently visible. Waiting copy no longer claims a loaded engine has no measured tokens while it is reading a prompt.

The versioned `memory-controls-v4` Host export permits an idle-boundary hot reload without restarting DSH. Earlier entries remain available for rollback. Tests exercise sanitized boundary data, concurrent reads, actual component rendering, global fallback, bad metrics, cached-prefix math, idle chat visibility and progress accessibility.
