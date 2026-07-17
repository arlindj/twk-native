import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * Direct connection to the synth (TawakkalnaOS web app) backend.
 *
 * Auth + the invite-redemption RPC talk to Supabase directly — the exact same
 * database, RLS policies and `redeem_study_invite` function the web app uses
 * (see synth's docs/DECISIONS.md "Surface-agnostic backend"). Everything that
 * needs server-trusted timing or an admin-bypassed write (session begin/
 * consent/finalize, prompt outcomes, recordings, heatmap beats) goes through
 * the small Bearer-authed REST routes under /api/mobile/* and /api/human-beats
 * instead, so a modified client can never fake a duration or inject beats
 * into someone else's session.
 *
 * SECURITY: unlike SYNTH_API_BASE (the plain JSON REST base, which a `?api=`
 * deep-link override may repoint to a LAN dev server — see
 * sessionStore.isLocalApiTarget), the Supabase URL/anon key below are NEVER
 * taken from a deep link. They are compiled into the app. A crafted QR code
 * cannot redirect authentication itself, only the plain data endpoints, and
 * only to loopback/private-network addresses in release builds.
 */

// Fill these in with the real synth Supabase project before shipping. The
// anon key is a public, RLS-scoped credential — safe to compile into the app
// (same as any Supabase client app), never the service-role key.
const SYNTH_SUPABASE_URL = 'https://pvkzxbeiagsqqkzjtqiv.supabase.co';
const SYNTH_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2a3p4YmVpYWdzcXFremp0cWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyODA2NjcsImV4cCI6MjA5NTg1NjY2N30.aLHcpUv7YF9u85_fauu4tPTYNLrJy5L5hHXhiYwemUc';

// The Next.js app's own base URL (its /api/mobile/* + /api/human-beats
// routes). Overridable via the deep link's `?api=` param for local QA,
// exactly like the old dev-server override (see isLocalApiTarget).
const DEFAULT_SYNTH_API_BASE = 'https://synth-web-neon.vercel.app/api';
let synthApiBase = DEFAULT_SYNTH_API_BASE;

export function setSynthApiBase(url: string) {
  synthApiBase = url.replace(/\/$/, '');
}

export function getSynthApiBase() {
  return synthApiBase;
}

export const supabase = createClient(SYNTH_SUPABASE_URL, SYNTH_SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/** True once a live Supabase auth session exists on this device. */
export async function hasAuthSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return data.session != null;
}

/**
 * One real, anonymous auth.uid() per device — signs in once and reuses it
 * for every study the tester takes on this device (matches the web app's
 * own anonymous-tester model). Returns the current access token.
 */
export async function ensureAuth(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: signIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signIn.session) throw new Error(error?.message ?? 'Could not start a session.');
  return signIn.session.access_token;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await ensureAuth();
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export class SynthApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function synthFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers = await authHeader();
  const res = await fetch(`${synthApiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = undefined;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new SynthApiError(res.status, message);
  }
  return data as T;
}

export const synth = {
  get: <T>(path: string) => synthFetch<T>('GET', path),
  post: <T>(path: string, body?: unknown) => synthFetch<T>('POST', path, body),
};

/** Redeem an invite code directly against the DB — same RPC the web app calls. */
export async function redeemInvite(code: string): Promise<string> {
  await ensureAuth();
  const { data, error } = await supabase.rpc('redeem_study_invite', { invite_code: code });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Invalid or inactive invite code');
  return data as string;
}

const AGE_RANGE_BRACKETS: { max: number; value: string }[] = [
  { max: 17, value: 'under_18' },
  { max: 24, value: '18_24' },
  { max: 34, value: '25_34' },
  { max: 44, value: '35_44' },
  { max: 54, value: '45_54' },
  { max: Infinity, value: '55_plus' },
];

/** Maps the app's free-entry age (a number) onto synth's stored bracket. */
export function ageToRange(age: number | undefined): string | null {
  if (age == null || !Number.isFinite(age) || age < 0) return null;
  return AGE_RANGE_BRACKETS.find((b) => age <= b.max)?.value ?? 'prefer_not_to_say';
}

/**
 * Updates the tester's own profile fields directly (RLS: sessions_tester_update
 * lets a tester update only their own row). Not integrity-sensitive like
 * timing, so no REST round-trip is needed for this one.
 */
export async function updateTesterProfile(
  sessionId: string,
  fields: { fullName?: string; age?: number; role?: string },
): Promise<void> {
  await ensureAuth();
  const { error } = await supabase
    .from('sessions')
    .update({
      tester_name: fields.fullName ?? null,
      tester_age_range: ageToRange(fields.age),
      tester_role: fields.role ?? null,
    })
    .eq('id', sessionId);
  if (error) throw new Error(error.message);
}
