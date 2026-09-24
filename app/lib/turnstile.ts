'use client';

// Invisible Turnstile, loaded only when a signed-out reader first engages.
// Readers who never react, save or read for 10 seconds never download it.
import { TURNSTILE_SITE_KEY } from './authConfig';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    'error-callback': () => void;
    'timeout-callback': () => void;
  }): string;
  remove(id: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loading: Promise<TurnstileApi | null> | null = null;

function loadScript(): Promise<TurnstileApi | null> {
  loading ??= new Promise((resolve) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.turnstile ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

/** A Turnstile token, or null when Turnstile is blocked, fails or times out. Never throws. */
export async function getTurnstileToken(timeoutMs = 15_000): Promise<string | null> {
  const api = await loadScript();
  if (!api) return null;
  return new Promise((resolve) => {
    // An invisible widget has no visual footprint, but it still needs a host
    // element in the document.
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.bottom = '0';
    host.style.right = '0';
    document.body.appendChild(host);
    let settled = false;
    let id: string | null = null;
    const done = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (id) { try { api.remove(id); } catch { /* already gone */ } }
      host.remove();
      resolve(token);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      id = api.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => done(token),
        'error-callback': () => done(null),
        'timeout-callback': () => done(null),
      });
    } catch {
      done(null);
    }
  });
}
