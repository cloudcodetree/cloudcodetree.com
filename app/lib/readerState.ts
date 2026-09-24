'use client';

// Per-reader state for blog posts and tutorial lessons — opened and saved.
// Blog IDs stay unchanged; tutorials use their RSS GUID, tutorial-<slug>.
//
// The browser talks to Supabase directly with the reader's own JWT; RLS on
// public.reader_state (migration 0005) is the whole enforcement story. There is
// no Worker hop and no service key, exactly as demo_events and profiles work.
//
// Two rules shape this module:
//
//  1. A signed-out reader must produce NO query and NO extra bytes. The
//     session probe is a synchronous localStorage check and supabase-js is
//     imported dynamically behind it, so importing this module from BlogPage
//     does not drag the auth SDK into the list page's chunk (the same reason
//     GlobalAuth loads AuthWidget with next/dynamic).
//  2. Failed reads reject and are evicted from the cache. Callers show a retry
//     notice; writes return success/failure without breaking the static page.

/** A reader's own reaction: like (1), none (0), dislike (-1). */
export type Reaction = -1 | 0 | 1;

export interface ReaderRow {
  post_id: string;
  saved: boolean;
  read_at: string | null;
  reaction: Reaction;
}

export type ReaderStateMap = Map<string, ReaderRow>;

/** A post annotated with this reader's state. */
export type WithReaderState<T> = T & { isRead: boolean; isSaved: boolean };

/**
 * Cheap synchronous "might be signed in" probe — the same localStorage check
 * GlobalAuth uses to decide whether to load supabase-js at all. False means we
 * are certainly signed out, so no client is constructed and no request leaves
 * the page. MUST only be consulted from an effect: during render it would
 * disagree with the server-rendered (always signed-out) HTML and break
 * hydration.
 */
export function hasReaderSession(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  } catch {
    return false;
  }
}

/** The signed-in reader's id, or null. Never throws; loads supabase-js lazily. */
async function currentUserId(): Promise<string | null> {
  if (!hasReaderSession()) return null;
  try {
    const { supabase } = await import('./supabaseClient');
    const { data } = await supabase().auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * One paginated read per signed-in session, shared: /saved renders BlogPage, and both
 * want the same rows. Callers each get their OWN Map copy so an optimistic
 * update in one component can never alias another's state. Cleared by
 * resetReaderState() whenever the reader changes.
 */
let inFlight: Promise<ReaderStateMap> | null = null;

async function fetchReaderState(): Promise<ReaderStateMap> {
  if (!(await currentUserId())) return new Map();
  const { supabase } = await import('./supabaseClient');
  const map: ReaderStateMap = new Map();
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase().from('reader_state')
      .select('post_id, saved, read_at, reaction').order('post_id').range(from, from + pageSize - 1);
    if (error || !data) throw new Error('Could not load your reading state.');
    (data as ReaderRow[]).forEach((row) => map.set(row.post_id, row));
    if (data.length < pageSize) return map;
  }
}

/**
 * Keep the shared copy honest after a successful write, so a client-side
 * navigation back to a post the reader just saved does not read a stale row.
 * Safe to mutate: every caller of loadReaderState() got its own copy.
 */
function patchCache(postId: string, patch: Partial<ReaderRow>): void {
  if (!inFlight) return;
  void inFlight.then((map) => {
    const current = map.get(postId) ?? { post_id: postId, saved: false, read_at: null, reaction: 0 };
    map.set(postId, { ...current, ...patch });
  }).catch(() => {});
}

/**
 * Every row this reader owns, keyed by post id. The caller holds the Map so
 * pagination, topic filtering and the view switcher never re-query. Resolves to
 * an empty Map when signed out. Failed reads reject and are never cached.
 */
export async function loadReaderState(): Promise<ReaderStateMap> {
  if (!inFlight) {
    const request = fetchReaderState().catch((error) => {
      if (inFlight === request) inFlight = null;
      throw error;
    });
    inFlight = request;
  }
  const shared = await inFlight;
  const copy: ReaderStateMap = new Map();
  shared.forEach((row, id) => copy.set(id, row));
  return copy;
}

/**
 * Forget everything cached for the previous reader: the shared row Map and the
 * set of posts already marked read. Called on every auth transition, so signing
 * out — or signing in as somebody else on the same browser — cannot leave one
 * reader looking at another's state, or suppress the next reader's first
 * "mark as read" because the previous one had already read that post.
 */
let generation = 0;
export function resetReaderState(): void {
  generation++;
  inFlight = null;
  marked.clear();
}

/**
 * Record that the reader opened this post. Fire-and-forget: never awaited
 * before render, failures swallowed, exactly as the Worker's logDemoOpen is.
 *
 * The payload deliberately carries only user_id, post_id and read_at. PostgREST
 * turns an upsert into `on conflict do update set <the columns sent>`, so
 * `saved` is untouched — re-reading a post can never unsave it.
 */
const marked = new Set<string>();

export function markRead(postId: string): void {
  const epoch = generation;
  if (!hasReaderSession()) return;
  // At most one write per post for as long as this reader's session lasts in
  // this tab — module state, so it survives client-side navigation between
  // articles, and is cleared only by resetReaderState() on an auth change. That
  // is deliberately wider than "per page load": an article's effect can run
  // several times for reasons that have nothing to do with the reader
  // (StrictMode's double invoke in dev, AnimatePresence remounting the route),
  // and re-opening a post the reader already opened in this session tells us
  // nothing new. A real return visit is a fresh page load, which re-reads
  // read_at honestly. Cleared again if the write fails, so a later mount
  // still gets its chance.
  if (marked.has(postId)) return;
  marked.add(postId);
  void (async () => {
    const userId = await currentUserId();
    if (generation !== epoch) return;
    if (!userId) { marked.delete(postId); return; }
    try {
      const { supabase } = await import('./supabaseClient');
      const readAt = new Date().toISOString();
      // updated_at is deliberately absent: a before-insert-or-update trigger
      // (migration 0006) sets it from server time, which no client clock can
      // backdate and no payload can forget.
      const { error } = await supabase()
        .from('reader_state')
        .upsert({ user_id: userId, post_id: postId, read_at: readAt }, { onConflict: 'user_id,post_id' });
      if (error && generation === epoch) marked.delete(postId);
      else if (generation === epoch) patchCache(postId, { read_at: readAt });
    } catch {
      if (generation === epoch) marked.delete(postId);   // best-effort: let a later mount retry
    }
  })();
}

/**
 * Save or unsave a post. Resolves true on success and false on any failure, so
 * an optimistic caller knows to revert. Unsaving writes saved = false rather
 * than deleting the row (there is no delete policy) — read state survives it.
 */
export async function setSaved(postId: string, saved: boolean): Promise<boolean> {
  const epoch = generation;
  const userId = await currentUserId();
  if (!userId || generation !== epoch) return false;
  try {
    const { supabase } = await import('./supabaseClient');
    const { error } = await supabase()
      .from('reader_state')
      .upsert({ user_id: userId, post_id: postId, saved }, { onConflict: 'user_id,post_id' });
    if (!error && generation === epoch) {
      patchCache(postId, { saved });
      // Every save path (article pages, list cards, /saved) goes through here,
      // so this is the one place the save event is sent.
      void import('./engagement').then(({ sendEngagement }) =>
        sendEngagement(postId, [{ event: 'save', delta: saved ? 1 : -1 }]));
    }
    return !error && generation === epoch;
  } catch {
    return false;
  }
}

/**
 * Set this reader's reaction on an item. Resolves true on success. Persists
 * only: engagement events are the caller's job, because merging signed-out
 * reactions into an account must not count them a second time.
 */
export async function setReaction(postId: string, reaction: Reaction): Promise<boolean> {
  const epoch = generation;
  const userId = await currentUserId();
  if (!userId || generation !== epoch) return false;
  try {
    const { supabase } = await import('./supabaseClient');
    const { error } = await supabase()
      .from('reader_state')
      .upsert({ user_id: userId, post_id: postId, reaction }, { onConflict: 'user_id,post_id' });
    if (!error && generation === epoch) patchCache(postId, { reaction });
    return !error && generation === epoch;
  } catch {
    return false;
  }
}

/**
 * Copy reactions made while signed out into the account, for items where the
 * account has no reaction. Sends no engagement events: each was counted when
 * it happened. `settled` lists local entries that can be deleted: the ones
 * written, and the ones the account already overrides. Failed writes stay
 * local so a later visit retries them.
 */
export async function mergeLocalReactions(
  local: Record<string, Reaction>,
  account: ReaderStateMap,
): Promise<{ applied: Record<string, Reaction>; settled: string[] }> {
  const applied: Record<string, Reaction> = {};
  const settled: string[] = [];
  for (const [id, reaction] of Object.entries(local)) {
    if ((account.get(id)?.reaction ?? 0) !== 0) { settled.push(id); continue; }
    if (await setReaction(id, reaction)) {
      applied[id] = reaction;
      settled.push(id);
    }
  }
  return { applied, settled };
}

// ---- auth ------------------------------------------------------------------

/**
 * Whether it is worth loading supabase-js at all.
 *
 * A token in storage is the ordinary signal. The `?signin=1` fallback is the
 * same one GlobalAuth carries: on the OAuth return the client that will hold
 * the session does not exist yet when a page's mount effect runs, so
 * hasReaderSession() is still false and the reader would get none of this
 * feature until a manual refresh. AuthWidget deliberately does not navigate
 * when the destination is the page you are already on, so there is no reload to
 * rescue it.
 *
 * Neither branch is ever true for an ordinary signed-out visitor, so they still
 * download no auth SDK and fire no query.
 */
function shouldWatchAuth(): boolean {
  if (hasReaderSession()) return true;
  try {
    return new URLSearchParams(window.location.search).get('signin') === '1';
  } catch {
    return false;
  }
}

/** The reader the cache belongs to, so a change of reader invalidates it. */
let watchedUserId: string | null = null;

/**
 * Track who is reading, for as long as the caller is mounted. `onChange`
 * receives the signed-in reader's id, or null when signed out. It always fires
 * with the current answer — synchronously with `null` when there is no reason
 * to load supabase-js at all — and then on every later transition. Returns an
 * unsubscribe function.
 *
 * It reports the id rather than a boolean because supabase-js also emits events
 * that change nothing a caller cares about: TOKEN_REFRESHED fires roughly
 * hourly, and a caller that treats it as a fresh sign-in will visibly reload
 * itself under a reader who is just sitting on the page. Comparing the id makes
 * "same reader, new token" distinguishable from "a different reader".
 *
 * Failure of any kind — no session, an expired token, supabase-js not loading —
 * ends with `onChange(null)`, so a stale token cannot leave dead controls on
 * screen. Callers can therefore treat this as the single source of truth and
 * never probe storage themselves.
 */
export function watchReaderAuth(onChange: (userId: string | null) => void): () => void {
  if (!shouldWatchAuth()) { onChange(null); return () => {}; }

  let live = true;
  let unsubscribe: (() => void) | null = null;

  void (async () => {
    try {
      const { supabase } = await import('./supabaseClient');
      // Fires INITIAL_SESSION immediately, so this doubles as the first read.
      const { data } = supabase().auth.onAuthStateChange((_event, session) => {
        if (!live) return;
        const userId = session?.user.id ?? null;
        // Synchronous, before onChange, so several subscribers on one page
        // agree about whose cache this is and only the first one clears it.
        if (userId !== watchedUserId) {
          watchedUserId = userId;
          resetReaderState();
        }
        onChange(userId);
      });
      if (!live) { data.subscription.unsubscribe(); return; }
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      if (live) onChange(null);
    }
  })();

  return () => {
    live = false;
    if (unsubscribe) unsubscribe();
  };
}

// ---- pure helpers (unit-tested in readerState.test.ts) ---------------------

/** Annotate a post list with the reader's state. Order and length preserved. */
export function applyReaderState<T extends { id: string }>(posts: T[], state: ReaderStateMap): WithReaderState<T>[] {
  return posts.map((post) => {
    const row = state.get(post.id);
    return { ...post, isRead: !!(row && row.read_at), isSaved: !!(row && row.saved) };
  });
}

/**
 * The Hide-read filter. A no-op (same array identity) when `hide` is false, so
 * it composes with search and topic filtering instead of replacing them.
 */
export function filterHideRead<T extends { isRead: boolean }>(posts: T[], hide: boolean): T[] {
  return hide ? posts.filter((post) => !post.isRead) : posts;
}

/**
 * The reader-state narrowing the list applies, in one place.
 *
 * `onlySaved` (the /saved page) deliberately ignores `hideRead`. Saving is an
 * explicit "keep this for later", and the ordinary way a post becomes saved is
 * that the reader opened it and then saved it — so composing the two filters
 * would empty /saved for exactly the readers using both features as intended,
 * and make the page look broken. Read state never overrides an explicit save.
 */
export function selectVisiblePosts<T extends { isRead: boolean; isSaved: boolean }>(
  posts: T[],
  options: { onlySaved?: boolean; hideRead?: boolean },
): T[] {
  if (options.onlySaved) return posts.filter((post) => post.isSaved);
  return filterHideRead(posts, !!options.hideRead);
}
