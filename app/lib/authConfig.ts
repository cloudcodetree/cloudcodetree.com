// Public auth configuration — committed by design, like the Web3Forms access
// key: the Supabase URL and publishable (anon) key ship in every built page;
// enforcement lives in RLS and the Worker gate, never in hiding these.
export const SUPABASE_URL = 'https://tgcysgioncdmtzcfknix.supabase.co';
export const SUPABASE_ANON_KEY =
  'sb_publishable_xElUD5_ZTjOVM8ZHSZ1lQw_Zq5gto2o';
// OAuth providers shown in the sign-in dialog. Add a provider here ONLY after
// configuring it in Supabase (Auth → Sign In / Providers) — an unconfigured
// provider errors at click time. Magic link is always on. Supabase links
// accounts by verified email, so one person across methods stays one user.
export type OAuthProvider = 'github' | 'google' | 'linkedin_oidc';
export const OAUTH_PROVIDERS: OAuthProvider[] = ['github', 'google', 'linkedin_oidc'];

// Turnstile site key: public by design, like the keys above. Production uses
// widget `cct-engage` (Invisible). Its secret lives only in the Worker as
// TURNSTILE_SECRET. Beta uses Cloudflare's always-pass TEST key, paired with the
// test secret on cct-site-staging, so automated browsers can run the full flow
// there. Turnstile rejects them by design. The staging build inlines the flag,
// so the test key never reaches the production bundle, and
// scripts/assert-variant.mjs refuses a production deploy that carries it.
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_CONTENT_PREVIEW === '1'
  ? '1x00000000000000000000BB'
  : '0x4AAAAAAFCjZ4InZnx-Fxni';
