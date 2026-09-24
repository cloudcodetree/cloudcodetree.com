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

// Turnstile site key: public by design, like the keys above. The widget is
// configured as Invisible for cloudcodetree.com and beta.cloudcodetree.com.
// Until Task 10 replaces it, this is Cloudflare's always-pass INVISIBLE TEST
// key. scripts/assert-variant.mjs refuses to deploy it to production.
export const TURNSTILE_SITE_KEY = '1x00000000000000000000BB';
