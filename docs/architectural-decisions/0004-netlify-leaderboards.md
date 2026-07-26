# ADR 0004: Netlify Functions and Blobs for Competition Leaderboards

## Status

accepted

## Date

2026-07-27

## Context

Vehicle Sim targets Netlify and now has client-side lap integrity, but it needs durable online standings and a player-facing identity flow. Browser state cannot be authoritative, Netlify Blobs is optimized for frequent reads/infrequent writes, and overlapping writes to the same blob use last-write-wins without general concurrency control.

## Decision

Expose a same-origin `/api/leaderboard` Netlify Function backed by a strongly-consistent, site-wide Netlify Blobs store. Store every accepted lap under an immutable unique key, derive each case-insensitive driver's best lap when reading, validate all request fields and plausible timing bounds on the server, and apply IP/domain rate limiting in the Function's exported config. Milestone 008 uses persistent anonymous local handles and labels accepted entries `client-integrity`; replay-grade authoritative verification remains required before high-stakes competition.

## Consequences

### Positive

- Deploys with the existing static Vite site and needs no separately provisioned database.
- Immutable writes avoid lost updates when multiple drivers finish simultaneously.
- Same-origin Functions keep storage credentials and validation logic out of the browser.
- The storage adapter and request handler can be tested without connecting to Netlify.

### Negative

- Reading standings requires listing submissions and deriving the best entry per driver in function code.
- Anonymous handles are not owned accounts and can collide or be impersonated.
- Client-integrity validation blocks ordinary UI exploits but cannot defeat a deliberately forged HTTP request.
- Submission retention and a database migration will be needed if entry volume grows substantially.

## Alternatives considered

- **One mutable leaderboard blob:** rejected because concurrent finishes can overwrite each other under last-write-wins semantics.
- **One mutable blob per player:** better than a global blob but still has same-player races and makes name ownership ambiguous without authentication.
- **External relational database now:** deferred because it adds provisioning and operational scope before the competition usage pattern is known.

## Related

- `docs/milestones/008-netlify-leaderboards.md`
- [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/)
