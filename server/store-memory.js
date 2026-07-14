/**
 * In-memory store — the original dev-server persistence. Sessions, events,
 * answers and the screen registry live in process memory; uploaded videos
 * and canonical frames go to ./uploads on disk via the local PUT /storage
 * stand-in route. Active whenever the Supabase env vars are absent.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hamming, SAME_SCREEN_THRESHOLD } from './phash.js';

export function createMemoryStore({ base, uploadDir, framesDir, demoBootstrap, demoToken, demoFigmaToken }) {
  const sessions = new Map(); // sessionId -> session record
  const seenIdempotencyKeys = new Set();
  const screenRegistry = []; // [{ key, hash (bit string), file }]

  return {
    mode: 'memory',

    async init() {},

    async createSession(testToken, device) {
      if (testToken !== demoToken && testToken !== demoFigmaToken) return null;
      const sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(sessionId, {
        id: sessionId,
        token,
        device,
        useFigma: testToken === demoFigmaToken,
        status: 'started',
        startedAt: new Date().toISOString(),
        consent: null,
        participant: null,
        events: [],
        answers: [],
        recordings: [], // uploaded segments (a session can have several)
        recordingSlot: false,
      });
      return { sessionId, sessionToken: token };
    },

    async authenticate(sessionId, token) {
      const session = sessions.get(sessionId);
      if (!session || session.token !== token) return null;
      return { id: session.id, useFigma: session.useFigma, hasConsent: Boolean(session.consent) };
    },

    async getBootstrap(ctx) {
      return demoBootstrap(ctx.id, ctx.useFigma);
    },

    async saveConsent(id, consent) {
      sessions.get(id).consent = consent;
    },

    async saveParticipant(id, participant) {
      sessions.get(id).participant = participant;
    },

    async startRecording(id) {
      const session = sessions.get(id);
      session.recordingSlot = true;
      session.status = 'recording';
    },

    async addEvents(id, idempotencyKey, events) {
      if (seenIdempotencyKeys.has(idempotencyKey)) {
        return 0; // duplicate retry — already stored
      }
      seenIdempotencyKeys.add(idempotencyKey);
      sessions.get(id).events.push(...events);
      return events.length;
    },

    async addAnswers(id, answers) {
      sessions.get(id).answers.push(...answers);
    },

    async createUploadTarget(id, recordingId) {
      const storageKey = `recordings/${id}_${recordingId}.mp4`;
      const session = sessions.get(id);
      session.recordingScratch = {
        ...(session.recordingScratch ?? {}),
        storageKey,
        status: 'upload_pending',
      };
      session.status = 'uploading';
      // Production: signed S3/GCS URL. Dev: a local PUT endpoint.
      return { uploadUrl: `${base}/storage/${encodeURIComponent(storageKey)}`, storageKey };
    },

    async completeRecording(id, body) {
      const seg = { ...body, status: 'uploaded' };
      const session = sessions.get(id);
      const i = session.recordings.findIndex((r) => r.recordingId === seg.recordingId);
      if (i >= 0) session.recordings[i] = seg;
      else session.recordings.push(seg);
      session.recordings.sort((a, b) => (a.segment ?? 0) - (b.segment ?? 0));
    },

    async completeSession(id) {
      const session = sessions.get(id);
      session.status = 'completed';
      session.completedAt = new Date().toISOString();
    },

    async recordFrame(id, { hash, buffer, atMs }) {
      let match = null;
      for (const s of screenRegistry) {
        if (hamming(s.hash, hash) <= SAME_SCREEN_THRESHOLD) {
          match = s;
          break;
        }
      }
      let isNew = false;
      if (!match) {
        isNew = true;
        match = { key: `S${screenRegistry.length + 1}`, hash, file: '' };
        match.file = path.join(framesDir, `${match.key}.jpg`);
        fs.writeFileSync(match.file, buffer);
        screenRegistry.push(match);
      }
      const session = sessions.get(id);
      (session.frames ??= []).push({ atMs: atMs ?? 0, screenKey: match.key });
      return { screenKey: match.key, isNew };
    },

    async getVideoSource(key) {
      return { file: path.join(uploadDir, key.replaceAll('/', '_')) };
    },

    async getFrameSource(key) {
      return { file: path.join(framesDir, `${key.replaceAll('/', '_')}.jpg`) };
    },

    async listSessions() {
      return [...sessions.values()].map((s) => ({
        id: s.id,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        device: s.device,
        participant: s.participant,
        useFigma: s.useFigma,
        frames: s.frames ?? [],
        eventCount: s.events.length,
        taps: s.events.filter((e) => e.type === 'tap').length,
        answers: s.answers,
        token: s.token,
        recordings: s.recordings,
        events: s.events,
      }));
    },
  };
}
