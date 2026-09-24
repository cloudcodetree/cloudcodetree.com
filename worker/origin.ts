/// <reference types="@cloudflare/workers-types" />
// Engagement endpoints only answer pages served by this site. This is a
// browser-context filter, not a security boundary: a script can forge Origin,
// which is why /api/engage also demands a bearer token or a clearance cookie.

/** True when the request's Origin is in the comma-separated `allowed` list. */
export function isAllowedOrigin(request: Request, allowed: string | undefined): boolean {
  const origin = request.headers.get('origin');
  if (!origin || !allowed) return false;
  return allowed.split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}
