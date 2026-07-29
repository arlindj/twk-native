import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { TimeoutError } from './retry';

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
const DEFAULT_SYNTH_API_BASE = 'https://synth.nacew.com/api';
let synthApiBase = DEFAULT_SYNTH_API_BASE;

export function setSynthApiBase(url: string) {
  synthApiBase = url.replace(/\/$/, '');
}

export function getSynthApiBase() {
  return synthApiBase;
}

/**
 * Default ceiling for a request that carries no payload worth waiting on.
 *
 * React Native's `fetch` has no usable default here: on Android the OkHttp
 * read timeout is effectively unbounded, and on iOS the *resource* timeout is
 * days. The failure that matters is not a refused connection — that rejects
 * immediately — it is the half-open socket left behind by a 5G↔Wi-Fi handoff,
 * a dead zone or a captive portal, where the request neither completes nor
 * fails. Without an abort, the participant watches a spinner forever and the
 * retry loop (which only ever fires on a rejection) never runs at all.
 */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * `fetch` with a hard ceiling. Shared by the REST layer and by supabase-js
 * (auth, the invite RPC, profile writes) — those go over the same radio and
 * hang in exactly the same way, so bounding only our own routes would leave
 * half the flow able to freeze.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // RN's fetch typing predates the URL overload; supabase-js hands us either.
    return await fetch(input as RequestInfo, { ...init, signal: controller.signal });
  } catch (err) {
    // An AbortError is indistinguishable from a user cancellation to callers,
    // and its message ("Aborted") reads like a bug rather than a network
    // problem. Re-label it so failure classification and the participant-facing
    // copy both treat it as what it is: the request timed out.
    if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)) {
      throw new TimeoutError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const supabase = createClient(SYNTH_SUPABASE_URL, SYNTH_SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetchWithTimeout(input, init),
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

/**
 * Returns a token guaranteed to outlive the next `minTtlMs`.
 *
 * `autoRefreshToken` only ticks while the app is in the foreground, and a
 * usability session routinely spends minutes backgrounded (a call, the OS
 * consent dialog, the participant reading the task on another app). Left
 * alone, a long upload can start with a token that expires mid-PUT: the file
 * transfers, `recordings/complete` returns 401, and the participant is told
 * their session expired after the work was already done. Refreshing up front
 * is one cheap request against a several-minute transfer.
 */
export async function ensureFreshAuth(minTtlMs = 10 * 60 * 1000): Promise<string> {
  const token = await ensureAuth();
  const { data } = await supabase.auth.getSession();
  const expiresAt = data.session?.expires_at; // seconds since epoch
  if (!expiresAt) return token;
  if (expiresAt * 1000 - Date.now() > minTtlMs) return token;
  try {
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? token;
  } catch {
    // Offline, or the refresh token is gone. Returning the current token lets
    // the request itself produce the real error (401 / network), which carries
    // far better copy than a refresh failure would.
    return token;
  }
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
  timeoutMs?: number,
): Promise<T> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${synthApiBase}${path}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
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
  get: <T>(path: string, timeoutMs?: number) => synthFetch<T>('GET', path, undefined, timeoutMs),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    synthFetch<T>('POST', path, body, timeoutMs),
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
 * Whether synth already closed this session row.
 *
 * The authoritative answer to "has finalize already run?". The local
 * `resultsSubmitted` snapshot flag is written with a fire-and-forget
 * AsyncStorage call, so a process death in the window between finalize
 * returning and that write landing would leave a resumed session believing it
 * still had to finalize — and `finalizeHumanSession` recomputes
 * `real_duration_ms` as `now - started_at`, so a second call bills the whole
 * upload (and however long the phone was dead) to the participant's measured
 * time-on-task. Asking the server costs one small query on resume only.
 *
 * Returns false on any error: an unreachable server must not be read as
 * "already finalized", because that would skip finalize entirely and leave the
 * session `running` forever.
 */
export async function isSessionFinalized(sessionId: string): Promise<boolean> {
  try {
    await ensureAuth();
    const { data, error } = await supabase
      .from('sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) return false;
    return data?.status === 'completed';
  } catch {
    return false;
  }
}

/**
 * Records why the session's evidence is incomplete, on the session row itself.
 *
 * Until now this only existed on the device: `recording_discarded` is a
 * lifecycle event, and `toBeat` maps lifecycle events to null, so a session
 * that arrived with no video looked identical to one where the participant
 * declined recording. The research team could not tell "the file was too
 * large" from "the phone reclaimed the cache" from "consent was refused".
 *
 * Written straight through the tester's own RLS update (the same
 * `sessions_tester_update` policy `updateTesterProfile` uses) rather than via
 * `/mobile/session/finalize`, deliberately: finalize recomputes
 * `real_duration_ms` from `started_at`, so calling it a second time after a
 * slow upload would silently inflate the participant's measured time-on-task.
 *
 * Best-effort by design — this is diagnostics about a degraded session, and
 * failing to record it must never be what fails the session.
 */
export async function writeSessionDiagnostics(sessionId: string, notes: string): Promise<void> {
  try {
    await ensureAuth();
    // `notes` is capped at 2000 chars by synth's FinalizeHumanSessionInput;
    // stay inside the same bound for the rows we write directly.
    await supabase
      .from('sessions')
      .update({ notes: notes.slice(0, 2000) })
      .eq('id', sessionId);
  } catch {
    /* diagnostics only — never surfaced, never fatal */
  }
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
