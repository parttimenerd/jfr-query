# AI Autocomplete — Orchestrator Contract

Ghost-text inline completion for SQL, markdown, and plot DSL cells. The orchestrator (`index.ts`) sits between CodeMirror keystrokes and the streaming AI provider. Four mechanisms cooperate to keep the UI responsive and the API bill bounded:

## 1. Cache (`cache.ts:LRUCache`)

- Key: hash of `(system + user)` prompt — schema, prior cells, cursor context.
- Value: the resolved suggestion string.
- Evicts oldest on overflow (`MAX_ENTRIES = 64`).
- Schema change ⇒ different prompt ⇒ different key ⇒ no stale reuse.

## 2. Prefix-aware reuse (`cache.ts:reuseCachedPrefix`)

After a cache lookup miss for the *new* key, the orchestrator checks the `recent` sidecar — the last suggestion shown — to see if the user simply typed a prefix of it. If so, no new request fires; we just shorten the displayed completion.

Contract:

- `reuseCachedPrefix(cached, userTyped)` returns `cached.slice(userTyped.length)` iff `cached.startsWith(userTyped)` AND `userTyped.length < cached.length`.
- Exact equality returns `null` (cursor is at the end of the suggestion; nothing left to show).
- Empty `userTyped` returns the full `cached`.
- Case-sensitive — DuckDB quoted identifiers must match exactly.

## 3. In-flight dedup (`cache.ts:InflightRegistry`)

If three keystrokes 50ms apart produce the same cache key, only one stream is dispatched. Subsequent callers `await` the existing `Promise`. On settle (resolve or reject), the entry clears so the next request fires fresh.

## 4. The `recent` sidecar (`index.ts`)

A single-slot record of the last `{ key, suggestion, upTo }`. Cleared on:

- Mode switch (SQL → markdown → plot).
- Escape suppression.
- Settings change (model swap, disable).
- Cursor moving backward (the user backspaced — divergence likely).

The sidecar exists per CodeMirror ViewPlugin instance, so parallel editors do not share state.

## Order of operations on every keystroke

1. Build prompt → derive key.
2. **Cache hit?** Show cached completion. Done.
3. **Prefix reuse?** Trim and show. Done.
4. **In-flight for this key?** Await it. Done.
5. Otherwise: register in-flight, stream from provider, cache on resolve.
