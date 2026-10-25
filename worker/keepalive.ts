/// <reference types="@cloudflare/workers-types" />
// Daily heartbeat that keeps the free-tier Supabase project from pausing.
// Runs from the Worker's Cron Trigger (wrangler.jsonc "triggers"), replacing
// the GitHub Actions job: GitHub's terms say not to use Actions "as part of a
// serverless application". It calls keepalive_beat() (migration 0008), a
// throttled database WRITE, because the old anonymous read did not stop pauses.

export interface KeepaliveEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Optional Healthchecks.io ping URL (a Worker secret). Unset = no dead-man's switch. */
  HEALTHCHECK_URL?: string;
}

export interface BeatResult {
  ok: boolean;
  /** HTTP status from PostgREST; 0 means the request never got an answer (DNS, network). */
  status: number;
  beatAt?: string;
  error?: string;
}

export async function beat(env: KeepaliveEnv): Promise<BeatResult> {
  let result: BeatResult;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    result = { ok: false, status: 0, error: 'SUPABASE_URL or SUPABASE_ANON_KEY is not set' };
  } else {
    try {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/keepalive_beat`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      if (res.ok) {
        const beatAt = (await res.json().catch(() => null)) as string | null;
        result = { ok: true, status: res.status, beatAt: beatAt ?? undefined };
      } else {
        result = { ok: false, status: res.status, error: (await res.text().catch(() => '')).slice(0, 200) };
      }
    } catch (err) {
      result = { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (env.HEALTHCHECK_URL) {
    // Healthchecks.io: a plain ping marks success, /fail marks failure, and
    // silence past the grace period emails the owner. Never let it throw.
    const url = result.ok ? env.HEALTHCHECK_URL : `${env.HEALTHCHECK_URL.replace(/\/$/, '')}/fail`;
    await fetch(url, { method: 'POST', body: JSON.stringify(result) }).catch(() => {});
  }
  return result;
}

/** The Cron Trigger entry point. Throws on failure so the invocation shows as
 * an error in Workers observability, not a silent success. */
export async function runKeepalive(env: KeepaliveEnv): Promise<BeatResult> {
  const result = await beat(env);
  console.log(JSON.stringify({ event: 'supabase_keepalive', ...result }));
  if (!result.ok) {
    throw new Error(`supabase keepalive failed: status ${result.status} ${result.error ?? ''}`.trim());
  }
  return result;
}
