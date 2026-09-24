// scripts/lib/engagement-contract.mjs
// The engagement event contract. The Worker (worker/engage.ts), the browser
// (app/lib/engagement.ts) and the future harvester all import it, so the three
// cannot drift. Spec: docs/superpowers/specs/2026-09-24-reader-reactions-design.md

/** Events a reader action can produce. */
export const EVENTS = Object.freeze(['like', 'dislike', 'save', 'read']);

/**
 * Item ids: the reader_state shape, narrowed to 96 characters so an id fits
 * Analytics Engine's 96-byte index. Ids are ASCII, so characters equal bytes.
 */
export const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;

export const MAX_CHANGES = 2;
export const MAX_BODY_BYTES = 1024;

/** 'tutorial' for tutorial-<slug> ids, 'post' for everything else. */
export function kindOf(id) {
  return id.startsWith('tutorial-') ? 'tutorial' : 'post';
}

/** A known event with a delta of 1 or -1. A read can only be added. */
export function isValidChange(change) {
  if (!change || typeof change !== 'object') return false;
  const { event, delta } = change;
  if (!EVENTS.includes(event)) return false;
  if (delta !== 1 && delta !== -1) return false;
  return !(event === 'read' && delta !== 1);
}

/** Parse an /api/engage body into { postId, changes }, or null. Never throws. */
export function parseEngagement(body) {
  if (!body || typeof body !== 'object') return null;
  const { post_id: postId, changes } = body;
  if (typeof postId !== 'string' || !ITEM_ID_RE.test(postId)) return null;
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_CHANGES) return null;
  if (!changes.every(isValidChange)) return null;
  if (new Set(changes.map((c) => c.event)).size !== changes.length) return null;
  return { postId, changes: changes.map(({ event, delta }) => ({ event, delta })) };
}
