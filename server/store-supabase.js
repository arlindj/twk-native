/**
 * Supabase store — persists sessions, events, answers, recordings and frame
 * clusters to a real Supabase project (Postgres + Storage). Active whenever
 * SUPABASE_URL and SUPABASE_SECRET_KEY are present in server/.env.
 *
 * Tables are NOT created from here (no direct SQL access) — apply
 * supabase/schema.sql once in the Supabase SQL Editor. Storage buckets ARE
 * created idempotently at boot with the service key.
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hamming, SAME_SCREEN_THRESHOLD } from './phash.js';

const TABLES = [
  'test_links',
  'sessions',
  'session_events',
  'idempotency_keys',
  'answers',
  'recordings',
  'screens',
  'frames',
];
const RECORDINGS_BUCKET = 'recordings';
const FRAMES_BUCKET = 'frames';
const SIGNED_URL_TTL_S = 300; // dashboard playback links

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseStore({ url, secretKey, base }) {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const linkCache = new Map(); //   test token -> test_links row
  const sessionCache = new Map(); // session id -> { token, testToken, hasConsent }
  const screenCache = new Map(); //  session id -> [{ key, hash, storageKey }]

  function fail(error, what) {
    throw new HttpError(500, 'db_error', `${what}: ${error.message}`);
  }

  async function getLink(token) {
    if (linkCache.has(token)) return linkCache.get(token);
    const { data, error } = await supabase
      .from('test_links')
      .select('token, study_name, bootstrap, expires_at, active')
      .eq('token', token)
      .maybeSingle();
    if (error) fail(error, 'test_links lookup failed');
    if (data) linkCache.set(token, data);
    return data ?? null;
  }

  async function updateSession(id, patch, what) {
    const { error } = await supabase.from('sessions').update(patch).eq('id', id);
    if (error) fail(error, what);
  }

  /** Per-session screen clusters, cached in memory so pHash matching on the
   *  (now all-prototype-types, high-volume) frame stream stays fast. */
  async function loadScreens(sessionId) {
    if (screenCache.has(sessionId)) return screenCache.get(sessionId);
    const { data, error } = await supabase
      .from('screens')
      .select('screen_key, phash, canonical_storage_key')
      .eq('session_id', sessionId)
      .order('first_seen_at_ms', { ascending: true });
    if (error) fail(error, 'screens lookup failed');
    const screens = (data ?? []).map((r) => ({
      key: r.screen_key,
      hash: r.phash,
      storageKey: r.canonical_storage_key,
    }));
    screenCache.set(sessionId, screens);
    return screens;
  }

  return {
    mode: 'supabase',

    /** Ensure buckets exist; probe every table and warn (never crash) when
     *  the schema has not been applied yet. */
    async init() {
      for (const name of [RECORDINGS_BUCKET, FRAMES_BUCKET]) {
        const { error } = await supabase.storage.createBucket(name, { public: false });
        if (!error) {
          console.log(`  Created private storage bucket "${name}".`);
        } else if (error.statusCode === '409' || /already exists/i.test(error.message)) {
          console.log(`  Storage bucket "${name}" already exists.`);
        } else {
          console.warn(`  ! Could not ensure bucket "${name}": ${error.message}`);
        }
      }
      const missing = [];
      for (const table of TABLES) {
        // Real select, not head:true — PostgREST HEAD responses carry no
        // error body, so a missing table would look fine to supabase-js.
        const { error } = await supabase.from(table).select('*').limit(1);
        if (error) missing.push(table);
      }
      if (missing.length) {
        console.warn(
          [
            '  ! Missing (or unreadable) tables: ' + missing.join(', '),
            '  ! Apply supabase/schema.sql in the Supabase SQL Editor',
            '  ! (Dashboard → SQL Editor → paste → Run), then restart this server.',
          ].join('\n'),
        );
      } else {
        console.log(`  All ${TABLES.length} tables reachable.`);
      }
    },

    async createSession(testToken, device) {
      if (typeof testToken !== 'string' || !testToken) return null;
      const link = await getLink(testToken);
      if (!link || link.active === false) return null;
      if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return null;
      const sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
      const token = crypto.randomBytes(24).toString('hex');
      const { error } = await supabase.from('sessions').insert({
        id: sessionId,
        token,
        test_token: testToken,
        device: device ?? null,
        status: 'started',
      });
      if (error) fail(error, 'session insert failed');
      sessionCache.set(sessionId, { token, testToken, hasConsent: false });
      return { sessionId, sessionToken: token };
    },

    async authenticate(sessionId, token) {
      if (!sessionId || !token) return null;
      let cached = sessionCache.get(sessionId);
      if (!cached) {
        const { data, error } = await supabase
          .from('sessions')
          .select('id, token, test_token, consent')
          .eq('id', sessionId)
          .maybeSingle();
        if (error) fail(error, 'session lookup failed');
        if (!data) return null;
        cached = { token: data.token, testToken: data.test_token, hasConsent: Boolean(data.consent) };
        sessionCache.set(sessionId, cached);
      }
      if (cached.token !== token) return null;
      const link = cached.testToken ? await getLink(cached.testToken) : null;
      return {
        id: sessionId,
        useFigma: link?.bootstrap?.prototype?.type === 'figma_proto',
        hasConsent: cached.hasConsent,
      };
    },

    async getBootstrap(ctx) {
      const cached = sessionCache.get(ctx.id);
      const link = cached?.testToken ? await getLink(cached.testToken) : null;
      if (!link) {
        throw new HttpError(410, 'expired', 'This test link has expired or does not exist.');
      }
      // The stored bootstrap is a template: sessionId/expiresAt are
      // per-session, and "{{BASE}}" in entryUrl points at whatever host this
      // dev server currently has on the LAN.
      const bootstrap = structuredClone(link.bootstrap ?? {});
      bootstrap.sessionId = ctx.id;
      bootstrap.expiresAt =
        link.expires_at ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      if (typeof bootstrap.prototype?.entryUrl === 'string') {
        bootstrap.prototype.entryUrl = bootstrap.prototype.entryUrl.replaceAll('{{BASE}}', base);
      }
      return bootstrap;
    },

    async saveConsent(id, consent) {
      await updateSession(id, { consent }, 'consent update failed');
      const cached = sessionCache.get(id);
      if (cached) cached.hasConsent = true;
    },

    async saveParticipant(id, participant) {
      await updateSession(id, { participant }, 'participant update failed');
    },

    async startRecording(id) {
      await updateSession(id, { status: 'recording' }, 'recording-start update failed');
    },

    async addEvents(id, idempotencyKey, events) {
      // Claim the batch key first; a replayed batch claims nothing and
      // reports {accepted: 0}, exactly like the in-memory Set did.
      const { data: claimed, error: keyErr } = await supabase
        .from('idempotency_keys')
        .upsert({ key: idempotencyKey, session_id: id }, { onConflict: 'key', ignoreDuplicates: true })
        .select('key');
      if (keyErr) fail(keyErr, 'idempotency key write failed');
      if (!claimed?.length) return 0;
      if (!events.length) return 0;
      const rows = events.map((e, i) => ({
        // Deterministic fallback id so a partially-failed batch can be
        // retried without duplicating rows (ON CONFLICT DO NOTHING).
        event_id: typeof e?.eventId === 'string' ? e.eventId : `${idempotencyKey}#${i}`,
        session_id: id,
        seq: typeof e?.seq === 'number' ? e.seq : i,
        type: typeof e?.type === 'string' ? e.type : null,
        payload: e,
      }));
      const { error } = await supabase
        .from('session_events')
        .upsert(rows, { onConflict: 'event_id', ignoreDuplicates: true });
      if (error) fail(error, 'event insert failed');
      return events.length;
    },

    async addAnswers(id, answers) {
      if (!answers.length) return;
      const rows = answers.map((a, i) => ({
        session_id: id,
        question_id:
          typeof a?.questionId === 'string' ? a.questionId
          : typeof a?.id === 'string' ? a.id
          : `unknown_${i}`,
        payload: a,
      }));
      // Same question answered twice in one batch would trip Postgres'
      // "cannot affect row a second time" — last write wins instead.
      const byQuestion = new Map(rows.map((r) => [r.question_id, r]));
      const { error } = await supabase
        .from('answers')
        .upsert([...byQuestion.values()], { onConflict: 'session_id,question_id' });
      if (error) fail(error, 'answer upsert failed');
    },

    async createUploadTarget(id, recordingId) {
      const storageKey = `${id}/${recordingId}.mp4`;
      // Signed upload URLs refuse to overwrite an existing object, so clear
      // any previous partial upload to let the app retry the same segment.
      await supabase.storage.from(RECORDINGS_BUCKET).remove([storageKey]);
      const { data, error } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .createSignedUploadUrl(storageKey);
      if (error) fail(error, 'signed upload URL failed');
      await updateSession(id, { status: 'uploading' }, 'upload-status update failed');
      // The mobile app does a raw PUT with Content-Type: video/mp4 against
      // this URL — Supabase signed upload URLs accept exactly that.
      return { uploadUrl: data.signedUrl, storageKey };
    },

    async completeRecording(id, body) {
      const recordingId = typeof body?.recordingId === 'string' ? body.recordingId : `rec_${id}`;
      const storageKey =
        typeof body?.storageKey === 'string' ? body.storageKey : `${id}/${recordingId}.mp4`;
      const slash = storageKey.lastIndexOf('/');
      const dir = slash >= 0 ? storageKey.slice(0, slash) : '';
      const name = slash >= 0 ? storageKey.slice(slash + 1) : storageKey;
      const { data: files, error: listErr } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .list(dir, { limit: 100, search: name });
      if (listErr) fail(listErr, 'storage list failed');
      if (!(files ?? []).some((f) => f.name === name)) {
        throw new HttpError(409, 'upload_missing', `No uploaded object found at "${storageKey}".`);
      }
      const { error } = await supabase.from('recordings').upsert(
        {
          recording_id: recordingId,
          session_id: id,
          segment: typeof body?.segment === 'number' ? body.segment : 0,
          storage_key: storageKey,
          duration_ms: body?.durationMs ?? null,
          checksum: body?.checksum ?? null,
          file_size_bytes: body?.fileSizeBytes ?? null,
          width: body?.width ?? null,
          height: body?.height ?? null,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'recording_id' },
      );
      if (error) fail(error, 'recording upsert failed');
    },

    async completeSession(id) {
      await updateSession(
        id,
        { status: 'completed', completed_at: new Date().toISOString() },
        'session complete failed',
      );
    },

    async recordFrame(id, { hash, buffer, atMs }) {
      const screens = await loadScreens(id);
      let match = screens.find((s) => hamming(s.hash, hash) <= SAME_SCREEN_THRESHOLD) ?? null;
      let isNew = false;
      if (!match) {
        isNew = true;
        // Session id baked into the key keeps it globally unique, so the
        // dashboard can resolve /frames/:key without extra context.
        const key = `S${screens.length + 1}_${id}`;
        const storageKey = `${id}/${key}.jpg`;
        const { error: upErr } = await supabase.storage
          .from(FRAMES_BUCKET)
          .upload(storageKey, buffer, { contentType: 'image/jpeg', upsert: true });
        if (upErr) fail(upErr, 'canonical frame upload failed');
        const { error } = await supabase.from('screens').upsert(
          {
            session_id: id,
            screen_key: key,
            phash: hash,
            canonical_storage_key: storageKey,
            first_seen_at_ms: atMs ?? 0,
          },
          { onConflict: 'session_id,screen_key' },
        );
        if (error) fail(error, 'screen insert failed');
        match = { key, hash, storageKey };
        screens.push(match);
      }
      const { error } = await supabase
        .from('frames')
        .insert({ session_id: id, screen_key: match.key, at_ms: atMs ?? 0 });
      if (error) fail(error, 'frame insert failed');
      return { screenKey: match.key, isNew };
    },

    async getVideoSource(key) {
      const { data, error } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .createSignedUrl(key, SIGNED_URL_TTL_S);
      if (error || !data?.signedUrl) return null;
      return { url: data.signedUrl };
    },

    async getFrameSource(key) {
      const { data: row, error } = await supabase
        .from('screens')
        .select('canonical_storage_key')
        .eq('screen_key', key)
        .limit(1)
        .maybeSingle();
      if (error || !row?.canonical_storage_key) return null;
      const { data, error: signErr } = await supabase.storage
        .from(FRAMES_BUCKET)
        .createSignedUrl(row.canonical_storage_key, SIGNED_URL_TTL_S);
      if (signErr || !data?.signedUrl) return null;
      return { url: data.signedUrl };
    },

    async listSessions() {
      const { data: rows, error } = await supabase
        .from('sessions')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) fail(error, 'session list failed');
      const sessions = rows ?? [];
      if (!sessions.length) return [];
      const ids = sessions.map((s) => s.id);
      // Dev dashboard load — capped by PostgREST's max-rows (1000/query),
      // which is plenty for local research sessions.
      const [evRes, ansRes, recRes, frRes, linkRes] = await Promise.all([
        supabase
          .from('session_events')
          .select('session_id, payload')
          .in('session_id', ids)
          .order('created_at', { ascending: true })
          .order('seq', { ascending: true })
          .limit(10000),
        supabase.from('answers').select('session_id, payload').in('session_id', ids),
        supabase
          .from('recordings')
          .select('*')
          .in('session_id', ids)
          .order('segment', { ascending: true }),
        supabase
          .from('frames')
          .select('session_id, screen_key, at_ms')
          .in('session_id', ids)
          .order('at_ms', { ascending: true })
          .limit(10000),
        supabase.from('test_links').select('token, bootstrap'),
      ]);
      for (const r of [evRes, ansRes, recRes, frRes, linkRes]) {
        if (r.error) fail(r.error, 'session detail load failed');
      }
      const groupBySession = (list) => {
        const map = new Map();
        for (const row of list ?? []) {
          if (!map.has(row.session_id)) map.set(row.session_id, []);
          map.get(row.session_id).push(row);
        }
        return map;
      };
      const evBy = groupBySession(evRes.data);
      const ansBy = groupBySession(ansRes.data);
      const recBy = groupBySession(recRes.data);
      const frBy = groupBySession(frRes.data);
      const figmaTokens = new Set(
        (linkRes.data ?? [])
          .filter((l) => l.bootstrap?.prototype?.type === 'figma_proto')
          .map((l) => l.token),
      );
      return sessions.map((s) => {
        const events = (evBy.get(s.id) ?? []).map((r) => r.payload);
        return {
          id: s.id,
          status: s.status,
          startedAt: s.created_at,
          completedAt: s.completed_at ?? undefined,
          device: s.device,
          participant: s.participant,
          useFigma: figmaTokens.has(s.test_token),
          frames: (frBy.get(s.id) ?? []).map((r) => ({
            atMs: Number(r.at_ms ?? 0),
            screenKey: r.screen_key,
          })),
          eventCount: events.length,
          taps: events.filter((e) => e?.type === 'tap').length,
          answers: (ansBy.get(s.id) ?? []).map((r) => r.payload),
          token: s.token,
          recordings: (recBy.get(s.id) ?? []).map((r) => ({
            recordingId: r.recording_id,
            segment: r.segment ?? 0,
            storageKey: r.storage_key,
            durationMs: r.duration_ms ?? undefined,
            checksum: r.checksum ?? undefined,
            fileSizeBytes: r.file_size_bytes ?? undefined,
            width: r.width ?? undefined,
            height: r.height ?? undefined,
            status: 'uploaded',
          })),
          events,
        };
      });
    },
  };
}
