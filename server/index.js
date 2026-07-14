/**
 * TWK dev server — stands in for the production backend while the web
 * dashboard's mobile endpoints are being built. Implements the exact
 * API contract from the documentation:
 *
 *   POST /mobile/sessions/start
 *   GET  /mobile/sessions/:id/bootstrap
 *   POST /mobile/sessions/:id/consent
 *   POST /mobile/sessions/:id/participant
 *   POST /mobile/sessions/:id/recording/start
 *   POST /mobile/sessions/:id/events/batch      (idempotent)
 *   POST /mobile/sessions/:id/answers
 *   POST /mobile/sessions/:id/recording/upload-url
 *   PUT  /storage/:key                          (signed-URL stand-in)
 *   POST /mobile/sessions/:id/recording/complete
 *   POST /mobile/sessions/:id/complete
 *
 * Plus a researcher-side page at / with the demo QR code and a replay
 * viewer that syncs tap markers with the uploaded video.
 *
 * Persistence is pluggable (see store-memory.js / store-supabase.js):
 * with SUPABASE_URL + SUPABASE_SECRET_KEY in server/.env it runs against a
 * real Supabase project (apply supabase/schema.sql once), otherwise it
 * falls back to the original in-memory + ./uploads behaviour.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import QRCode from 'qrcode';
import { perceptualHash } from './phash.js';
import { createMemoryStore } from './store-memory.js';
import { createSupabaseStore } from './store-supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const FRAMES_DIR = path.join(UPLOAD_DIR, 'frames');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

const app = express();
if (process.env.LOG_REQUESTS) {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });
}
app.use(express.json({ limit: '5mb' }));
app.use('/prototype', express.static(path.join(__dirname, 'prototype')));

function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
const HOST = lanIp();
const BASE = `http://${HOST}:${PORT}`;

/* ------------------------- Demo study data ------------------------ */

const DEMO_TOKEN = 'DEMO123';
const DEMO_FIGMA_TOKEN = 'DEMOFIGMA';
// Real Figma prototype share link, wired in for the Figma-compatibility test.
const FIGMA_PROTO_URL =
  'https://www.figma.com/proto/xMgEQPqRS7X9rLEvQotYFk/UBER-APP?node-id=9-93&page-id=0%3A1&starting-point-node-id=9%3A93&t=C0PL3b4TnaoDUuEF-1';

function demoBootstrap(sessionId, useFigma) {
  return {
    sessionId,
    studyVersionId: useFigma ? 'stv_demo_figma' : 'stv_demo_01',
    studyName: useFigma ? 'Uber app — Figma prototype test' : 'Checkout flow — mobile app',
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    recordingRequired: true,
    prototype: {
      type: useFigma ? 'figma_proto' : 'html_package',
      platform: 'mobile_app',
      entryUrl: useFigma ? FIGMA_PROTO_URL : `${BASE}/prototype/index.html`,
      viewport: { width: 390, height: 844 },
    },
    consent: {
      version: 'consent_v1',
      body:
        'By continuing you agree that your screen, taps and answers will be recorded during this test and shared with the research team. Recordings are deleted according to the study retention policy.',
    },
    intake: {
      enabled: true,
      askFullName: true,
      askAge: true,
      askRole: true,
      roleOptions: [
        'Product designer',
        'UX researcher',
        'Product manager',
        'Engineer',
        'Student',
        'Other professional',
      ],
    },
    tasks: useFigma
      ? [
          {
            id: 'task_figma',
            title: 'Explore the app',
            instruction: 'Tap around the prototype like you would in the real app.',
            required: true,
          },
        ]
      : [
      {
        id: 'task_browse',
        title: 'Find a product you like',
        instruction: 'Browse the shop and open the product that looks most interesting to you.',
        required: true,
      },
      {
        id: 'task_checkout',
        title: 'Buy the product',
        instruction: 'Add the product to your cart and complete the checkout.',
        required: true,
      },
    ],
    questionBlocks: useFigma
      ? [
          {
            id: 'q_recommend',
            type: 'yes_no',
            title: 'Would you use this app again?',
            required: true,
          },
        ]
      : [
      {
        id: 'q_task_difficulty',
        afterTaskId: 'task_checkout',
        type: 'opinion_scale',
        title: 'How easy was it to complete the checkout?',
        required: true,
        scaleMin: 1,
        scaleMax: 5,
        scaleMinLabel: 'Very hard',
        scaleMaxLabel: 'Very easy',
      },
      {
        id: 'q_feedback',
        type: 'open_text',
        title: 'What would you improve about this app?',
        description: 'Anything that confused or annoyed you.',
        required: false,
      },
      {
        id: 'q_recommend',
        type: 'yes_no',
        title: 'Would you use this app again?',
        required: true,
      },
    ],
  };
}

/* --------------------------- Persistence -------------------------- */
/* Two interchangeable stores behind one async interface: the original
   in-memory store, and a Supabase store (Postgres + Storage) that turns
   on automatically when server/.env carries the project credentials. */

const SUPABASE_MODE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const store = SUPABASE_MODE
  ? createSupabaseStore({
      url: process.env.SUPABASE_URL,
      secretKey: process.env.SUPABASE_SECRET_KEY,
      base: BASE,
    })
  : createMemoryStore({
      base: BASE,
      uploadDir: UPLOAD_DIR,
      framesDir: FRAMES_DIR,
      demoBootstrap,
      demoToken: DEMO_TOKEN,
      demoFigmaToken: DEMO_FIGMA_TOKEN,
    });

/** Async route wrapper — store errors carry {status, code}; anything else
 *  becomes a generic 500 with the same {code, message} body shape. */
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`[${req.method} ${req.url}]`, err?.message ?? err);
    if (res.headersSent) return;
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const code = typeof err?.code === 'string' ? err.code : 'internal_error';
    res.status(status).json({ code, message: err?.message ?? 'Unexpected server error.' });
  });
};

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    const ctx = await store.authenticate(req.params.id, token);
    if (!ctx) {
      return res.status(401).json({ code: 'unauthorized', message: 'Invalid session token.' });
    }
    req.sessionCtx = ctx;
    next();
  } catch (err) {
    console.error(`[auth ${req.url}]`, err?.message ?? err);
    res.status(500).json({ code: 'internal_error', message: 'Unexpected server error.' });
  }
}

/* ----------------------------- API ------------------------------- */

app.post('/api/mobile/sessions/start', wrap(async (req, res) => {
  const { testToken, device } = req.body ?? {};
  const created = await store.createSession(testToken, device);
  if (!created) {
    return res.status(410).json({ code: 'expired', message: 'This test link has expired or does not exist.' });
  }
  res.json(created); // { sessionId, sessionToken }
}));

app.get('/api/mobile/sessions/:id/bootstrap', auth, wrap(async (req, res) => {
  res.json(await store.getBootstrap(req.sessionCtx));
}));

app.post('/api/mobile/sessions/:id/consent', auth, wrap(async (req, res) => {
  await store.saveConsent(req.sessionCtx.id, req.body);
  res.json({ ok: true });
}));

/** Guest profile (name / age / role) for user personas — no auth account. */
app.post('/api/mobile/sessions/:id/participant', auth, wrap(async (req, res) => {
  const { participantId, fullName, age, role } = req.body ?? {};
  if (!participantId || typeof participantId !== 'string') {
    return res.status(400).json({ code: 'bad_participant', message: 'participantId is required.' });
  }
  await store.saveParticipant(req.sessionCtx.id, {
    participantId,
    fullName: typeof fullName === 'string' ? fullName : undefined,
    age: typeof age === 'number' ? age : undefined,
    role: typeof role === 'string' ? role : undefined,
    submittedAt: new Date().toISOString(),
  });
  res.json({ ok: true, participantId });
}));

app.post('/api/mobile/sessions/:id/recording/start', auth, wrap(async (req, res) => {
  if (!req.sessionCtx.hasConsent) {
    return res.status(409).json({ code: 'consent_required', message: 'Consent must be recorded first.' });
  }
  await store.startRecording(req.sessionCtx.id);
  res.json({ recordingId: `rec_${req.sessionCtx.id}` });
}));

app.post('/api/mobile/sessions/:id/events/batch', auth, wrap(async (req, res) => {
  const { idempotencyKey, events } = req.body ?? {};
  if (!idempotencyKey || !Array.isArray(events)) {
    return res.status(400).json({ code: 'bad_batch', message: 'idempotencyKey and events are required.' });
  }
  const accepted = await store.addEvents(req.sessionCtx.id, idempotencyKey, events);
  res.json({ accepted });
}));

app.post('/api/mobile/sessions/:id/answers', auth, wrap(async (req, res) => {
  await store.addAnswers(req.sessionCtx.id, req.body?.answers ?? []);
  res.json({ ok: true });
}));

app.post('/api/mobile/sessions/:id/recording/upload-url', auth, wrap(async (req, res) => {
  const recordingId = req.body?.recordingId ?? `rec_${req.sessionCtx.id}`;
  // Memory: a local PUT endpoint. Supabase: a signed Storage upload URL
  // (accepts the app's raw PUT with Content-Type: video/mp4).
  const { uploadUrl, storageKey } = await store.createUploadTarget(req.sessionCtx.id, recordingId);
  res.json({ uploadUrl, storageKey });
}));

// Signed-URL stand-in for the in-memory store; Supabase mode uploads
// straight to Storage, so the route is not mounted there.
if (!SUPABASE_MODE) {
  app.put('/storage/:key', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.key.replaceAll('/', '_'));
    const stream = fs.createWriteStream(filePath);
    req.pipe(stream);
    stream.on('finish', () => res.status(200).json({ ok: true }));
    stream.on('error', () => res.status(500).json({ code: 'write_failed', message: 'Could not persist file.' }));
  });
}

app.post('/api/mobile/sessions/:id/recording/complete', auth, wrap(async (req, res) => {
  await store.completeRecording(req.sessionCtx.id, req.body ?? {});
  res.json({ ok: true });
}));

app.post('/api/mobile/sessions/:id/complete', auth, wrap(async (req, res) => {
  await store.completeSession(req.sessionCtx.id);
  res.json({ ok: true });
}));

/* ------------------- Frame capture clustering --------------------
   Prototypes rendered without stable DOM identity (Figma canvas — and now
   frame capture runs for ALL prototype types) expose no screen id, so the
   app snapshots the viewport after each tap and uploads it here. Frames
   are clustered by perceptual hash (see phash.js): visually-identical
   captures map to one stable screen key, and the first capture becomes
   that screen's canonical image for heatmap backgrounds. The store decides
   where clusters live (memory registry vs. screens/frames tables + the
   "frames" bucket), keeping hashes cached in memory either way. */

app.post('/api/mobile/sessions/:id/frames', auth, async (req, res) => {
  const { imageBase64, atMs } = req.body ?? {};
  if (!imageBase64) {
    return res.status(400).json({ code: 'bad_frame', message: 'imageBase64 is required.' });
  }
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const { hash, uniform } = await perceptualHash(buffer);
    if (uniform) {
      // Blank/loading frame — tell the app so it can retry shortly.
      return res.json({ screenKey: null, isNew: false, blank: true });
    }
    const { screenKey, isNew } = await store.recordFrame(req.sessionCtx.id, { hash, buffer, atMs });
    res.json({ screenKey, isNew });
  } catch (err) {
    res.status(500).json({ code: 'frame_failed', message: String(err?.message ?? err) });
  }
});

app.get('/frames/:key', wrap(async (req, res) => {
  const key = req.params.key.replace(/\.jpg$/, '');
  const src = await store.getFrameSource(key);
  if (!src) return res.status(404).json({ code: 'not_found', message: 'Frame not found.' });
  if (src.url) return res.redirect(src.url); // short-TTL signed Storage URL
  res.sendFile(src.file);
}));

/* -------------------- Researcher-side dev pages ------------------- */

app.get('/video/:key', wrap(async (req, res) => {
  const src = await store.getVideoSource(req.params.key);
  if (!src) return res.status(404).json({ code: 'not_found', message: 'Recording not found.' });
  if (src.url) return res.redirect(src.url); // short-TTL signed Storage URL
  res.sendFile(src.file);
}));

app.get('/api/dev/sessions', wrap(async (_req, res) => {
  res.json(await store.listSessions());
}));

app.get('/', async (_req, res) => {
  const deepLink = `twk://t/${DEMO_TOKEN}?api=${encodeURIComponent(`${BASE}/api`)}`;
  const qr = await QRCode.toDataURL(deepLink, { width: 280, margin: 1 });
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>TWK Dev Dashboard</title>
<style>
body{font-family:system-ui;margin:0;background:#F7FAF8;color:#101828}
.wrap{max-width:1080px;margin:0 auto;padding:32px 20px}
.card{background:#fff;border:1px solid #E4E7EC;border-radius:16px;padding:20px;margin-bottom:16px}
h1{color:#0B7A4B} h3{margin-top:0} code{background:#EEF4F0;padding:2px 6px;border-radius:6px}
.session:hover{border-color:#0B7A4B}
.replay{position:relative;display:inline-block}
.replay video{max-width:320px;border-radius:12px;display:block}
.marker{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;
  background:rgba(11,122,75,.35);border:2px solid #0B7A4B;pointer-events:none;transition:opacity .15s}
button{background:#0B7A4B;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
pre{white-space:pre-wrap;font-size:12px;background:#F7FAF8;padding:10px;border-radius:8px}
table{border-collapse:collapse;font-size:13px;margin-top:8px}
td,th{border:1px solid #E4E7EC;padding:5px 10px;text-align:left}
th{background:#EDF3EF;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.hm-grid{display:flex;gap:18px;flex-wrap:wrap}
.hm-item{width:236px}
.hm-frame{position:relative;width:234px;height:506px;border:1px solid #E4E7EC;border-radius:14px;overflow:hidden;background:#fff}
.hm-frame iframe{width:390px;height:844px;border:0;transform:scale(0.6);transform-origin:0 0;pointer-events:none}
.hm-frame canvas{position:absolute;inset:0;pointer-events:none}
.hm-meta{font-size:12.5px;color:#475467;margin-top:8px;line-height:1.5}
.hm-meta b{color:#101828}
.hm-toggle{display:flex;gap:6px;margin-top:8px}
.hm-toggle button{font-size:11px;padding:4px 10px;background:#fff;color:#101828;border:1px solid #E4E7EC}
.hm-toggle button.on{background:#0B7A4B;color:#fff;border-color:#0B7A4B}
.pill{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 8px;margin-left:6px}
.pill.ok{background:#ECFDF3;color:#067647}.pill.bad{background:#FEF3F2;color:#D92D20}
</style></head><body><div class="wrap">
<h1>TWK Participate — Dev Dashboard</h1>
<div class="card">
  <h3>Demo test</h3>
  <p>Scan with the TWK Participate app (or with the iOS camera on a device that has the app installed):</p>
  <img src="${qr}" alt="QR"/>
  <p>Deep link: <code>${deepLink}</code></p>
</div>

<div class="card">
  <h3>Heatmaps — where participants tapped <span style="font-weight:400;font-size:13px;color:#475467">(aggregated across all sessions, per prototype screen)</span></h3>
  <div class="hm-grid" id="heatmaps">No tap data yet.</div>
</div>

<div class="card">
  <h3>Task metrics</h3>
  <div id="taskmetrics">No completed tasks yet.</div>
</div>

<div class="card"><h3>Sessions</h3><div id="sessions">Loading…</div></div>
<script>
const VIEW_W = 390, VIEW_H = 844, SCALE = 0.6;
const fmt = (ms) => ms >= 60000 ? Math.floor(ms/60000)+'m '+Math.round((ms%60000)/1000)+'s' : (ms/1000).toFixed(1)+'s';

/* Per-session task durations: pair task_started with its terminal event. */
function taskRuns(events){
  const runs = [];
  const open = {};
  for(const e of events){
    if(e.type === 'task_started') open[e.taskId] = e.timestampMs;
    if((e.type === 'task_completed' || e.type === 'task_abandoned') && open[e.taskId] !== undefined){
      runs.push({taskId: e.taskId, durationMs: e.timestampMs - open[e.taskId], outcome: e.type === 'task_completed' ? 'completed' : 'abandoned'});
      delete open[e.taskId];
    }
  }
  return runs;
}

function drawHeat(canvas, taps, mode, showMisclickColor){
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(mode === 'clean') return;
  for(const t of taps){
    const x = t.normalizedX * canvas.width, y = t.normalizedY * canvas.height;
    if(mode === 'heat'){
      const r = 26;
      const g = ctx.createRadialGradient(x,y,2,x,y,r);
      g.addColorStop(0,'rgba(255,60,40,0.55)');
      g.addColorStop(0.5,'rgba(255,160,40,0.28)');
      g.addColorStop(1,'rgba(255,220,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x,y,7,0,7);
      ctx.fillStyle = (showMisclickColor && t.meta && t.meta.interactive === false)
        ? 'rgba(217,45,32,.75)' : 'rgba(11,122,75,.75)';
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
}

async function load(){
  const sessions = await (await fetch('/api/dev/sessions')).json();

  /* -------------------------- Heatmaps -------------------------
     Two data sources, rendered differently:
     - Prototypes we host ourselves (HTML): location.hash gives a real
       per-screen id, and DOM elements make misclick detection valid.
     - Figma (or any canvas-rendered) prototypes: verified empirically
       that Figma's proto viewer renders on a single <canvas> with no
       DOM hotspots, and never touches location.hash on navigation.
       Per-screen bucketing and misclick % would be fabricated for
       these, so we degrade to one task-level tap-density plot with no
       misclick claim, clearly labeled as such. */
  const ownTaps = [], figmaTaps = [];
  for(const s of sessions){
    for(const e of s.events){
      if(e.type !== 'tap' || !e.meta || e.meta.source !== 'webview') continue;
      if(s.useFigma) figmaTaps.push({...e, sessionId: s.id});
      else if(e.meta.prototypeScreenId) ownTaps.push(e);
    }
  }
  const byScreen = {};
  for(const t of ownTaps) (byScreen[t.meta.prototypeScreenId] ||= []).push(t);

  /* Figma taps → screens via the captured-frame timeline. A tap belongs to
     the screen last observed BEFORE it (the frame captured ~1s after the
     tap describes where the tap LANDED the user, so it also serves as the
     "did this tap navigate?" signal). */
  const byFrameScreen = {}; // screenKey -> taps
  for(const s of sessions){
    if(!s.useFigma || !s.frames || !s.frames.length) continue;
    const timeline = [...s.frames].sort((a,b) => a.atMs - b.atMs);
    const sessionTaps = s.events
      .filter(e => e.type === 'tap' && e.meta && e.meta.source === 'webview')
      .sort((a,b) => a.timestampMs - b.timestampMs);
    for(const tap of sessionTaps){
      let active = timeline[0] ? timeline[0].screenKey : null;
      for(const f of timeline){
        if(f.atMs <= tap.timestampMs) active = f.screenKey; else break;
      }
      if(!active) continue;
      const next = timeline.find(f => f.atMs > tap.timestampMs && f.atMs <= tap.timestampMs + 3000);
      (byFrameScreen[active] ||= []).push({...tap, effective: !!next && next.screenKey !== active});
    }
  }

  const hmEl = document.getElementById('heatmaps');
  const screens = Object.keys(byScreen);
  const frameScreens = Object.keys(byFrameScreen);
  if(!screens.length && !frameScreens.length){
    hmEl.innerHTML = 'No tap data yet.';
  } else {
    const ownHtml = screens.map(id => {
      const taps = byScreen[id];
      const mis = taps.filter(t => t.meta.interactive === false).length;
      const misRate = Math.round(100 * mis / taps.length);
      return \`<div class="hm-item" data-screen="\${id}">
        <div class="hm-frame">
          <iframe src="/prototype/index.html#\${id}" scrolling="no" tabindex="-1"></iframe>
          <canvas width="234" height="506"></canvas>
        </div>
        <div class="hm-meta"><b>\${id}</b> · \${taps.length} taps ·
          misclick <b>\${misRate}%</b><span class="pill \${misRate > 20 ? 'bad' : 'ok'}">\${mis} miss</span></div>
        <div class="hm-toggle">
          <button data-mode="heat" class="on">Heat</button>
          <button data-mode="dots">Dots</button>
          <button data-mode="clean">Clean</button>
        </div>
      </div>\`;
    }).join('');
    const figmaHtml = frameScreens.map(key => {
      const taps = byFrameScreen[key];
      const noEffect = taps.filter(t => !t.effective).length;
      const noEffectRate = Math.round(100 * noEffect / taps.length);
      return \`<div class="hm-item" data-frame-key="\${key}">
        <div class="hm-frame">
          <img src="/frames/\${key}.jpg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill" />
          <canvas width="234" height="506" style="position:absolute;inset:0"></canvas>
        </div>
        <div class="hm-meta"><b>\${key}</b> (captured) · \${taps.length} taps ·
          no-effect <b>\${noEffectRate}%</b><span class="pill \${noEffectRate > 40 ? 'bad' : 'ok'}">\${noEffect} taps</span></div>
        <div class="hm-toggle">
          <button data-mode="heat" class="on">Heat</button>
          <button data-mode="dots">Dots</button>
          <button data-mode="clean">Clean</button>
        </div>
      </div>\`;
    }).join('');
    hmEl.innerHTML = ownHtml + figmaHtml;
    for(const item of hmEl.querySelectorAll('[data-screen]')){
      const taps = byScreen[item.dataset.screen];
      const canvas = item.querySelector('canvas');
      drawHeat(canvas, taps, 'heat', true);
      item.querySelectorAll('.hm-toggle button').forEach(btn => btn.onclick = () => {
        item.querySelectorAll('.hm-toggle button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        drawHeat(canvas, taps, btn.dataset.mode, true);
      });
    }
    for(const item of hmEl.querySelectorAll('[data-frame-key]')){
      const taps = byFrameScreen[item.dataset.frameKey];
      // Dots mode colors: red = no-effect tap (behavioral misclick heuristic).
      const colored = taps.map(t => ({...t, meta: {...t.meta, interactive: t.effective}}));
      const canvas = item.querySelector('canvas');
      drawHeat(canvas, colored, 'heat', true);
      item.querySelectorAll('.hm-toggle button').forEach(btn => btn.onclick = () => {
        item.querySelectorAll('.hm-toggle button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        drawHeat(canvas, colored, btn.dataset.mode, true);
      });
    }
  }

  /* ------------------------ Task metrics ---------------------- */
  const agg = {};
  for(const s of sessions) for(const r of taskRuns(s.events)){
    (agg[r.taskId] ||= {runs: 0, done: 0, total: 0}).runs++;
    agg[r.taskId].total += r.durationMs;
    if(r.outcome === 'completed') agg[r.taskId].done++;
  }
  const tmEl = document.getElementById('taskmetrics');
  const taskIds = Object.keys(agg);
  if(taskIds.length){
    tmEl.innerHTML = '<table><tr><th>Task</th><th>Runs</th><th>Completion</th><th>Avg time</th></tr>' +
      taskIds.map(id => {
        const a = agg[id];
        return \`<tr><td>\${id}</td><td>\${a.runs}</td><td>\${Math.round(100*a.done/a.runs)}%</td><td>\${fmt(a.total/a.runs)}</td></tr>\`;
      }).join('') + '</table>';
  }

  /* -------------------------- Sessions ------------------------ */
  const el = document.getElementById('sessions');
  if(!sessions.length){ el.textContent = 'No sessions yet. Scan the QR above.'; return; }
  el.innerHTML = sessions.map(s => {
    const runs = taskRuns(s.events);
    const sessionMs = (() => {
      const done = s.events.find(e => e.type === 'session_completed');
      return done ? done.timestampMs : null;
    })();
    return \`
    <div class="card session">
      <strong>\${s.id}</strong> — \${s.status} · \${s.taps} taps ·
      \${(s.device && s.device.platform) || '?'} \${(s.device && s.device.osVersion) || ''}
      \${s.participant ? ' · <b>' + (s.participant.fullName || 'Guest') + '</b>' +
        (s.participant.role ? ' · ' + s.participant.role : '') +
        (s.participant.age != null ? ' · age ' + s.participant.age : '') +
        ' · <code>' + s.participant.participantId + '</code>' : ''}
      \${sessionMs ? ' · total <b>' + fmt(sessionMs) + '</b>' : ''}
      \${runs.length ? '<table><tr><th>Task</th><th>Time</th><th>Outcome</th></tr>' +
        runs.map(r => \`<tr><td>\${r.taskId}</td><td>\${fmt(r.durationMs)}</td><td>\${r.outcome}</td></tr>\`).join('') + '</table>' : ''}
      \${(s.recordings || []).length ? (s.recordings || []).map((r, ri) => \`
        <div class="replay" id="replay-\${s.id}-\${ri}" style="margin-top:12px">
          \${s.recordings.length > 1 ? '<p style="color:#475467;font-size:12px;margin:0 0 4px">Segment ' + (ri + 1) + ' of ' + s.recordings.length + '</p>' : ''}
          <video src="/video/\${encodeURIComponent(r.storageKey)}" controls playsinline></video>
        </div>\`).join('') : '<p style="color:#475467;font-size:13px">No recording uploaded (yet).</p>'}
      <details><summary>Answers (\${s.answers.length}) & events</summary>
        <pre>\${JSON.stringify({answers:s.answers, events:s.events.slice(0,200)}, null, 1)}</pre>
      </details>
    </div>\`;
  }).join('');
  // Tap marker sync on replay: recordingTimeMs is relative to its own
  // segment, so each segment's <video> only gets taps tagged with its index.
  for(const s of sessions){
    (s.recordings || []).forEach((r, ri) => {
      const wrap = document.getElementById('replay-'+s.id+'-'+ri);
      if(!wrap) return;
      const video = wrap.querySelector('video');
      const segIdx = r.segment ?? ri;
      const taps = s.events.filter(e => e.type === 'tap' && e.recordingTimeMs >= 0 &&
        (e.recordingSegment ?? 0) === segIdx && e.meta && e.meta.source === 'native');
      video.addEventListener('timeupdate', () => {
        wrap.querySelectorAll('.marker').forEach(m => m.remove());
        const tMs = video.currentTime * 1000;
        for(const tap of taps){
          if(Math.abs(tMs - tap.recordingTimeMs) < 250){
            const m = document.createElement('div');
            m.className = 'marker';
            m.style.left = (tap.normalizedX * video.clientWidth) + 'px';
            m.style.top = (tap.normalizedY * video.clientHeight) + 'px';
            wrap.appendChild(m);
          }
      }
    });
  }
}
load(); setInterval(load, 8000);
</script>
</div></body></html>`);
});

console.log(`TWK dev server — ${SUPABASE_MODE ? 'SUPABASE' : 'IN-MEMORY'} mode${SUPABASE_MODE ? ` (${process.env.SUPABASE_URL})` : ' (no SUPABASE_URL/SUPABASE_SECRET_KEY in server/.env)'}`);
try {
  await store.init();
} catch (err) {
  console.warn(`  ! Store init failed (continuing anyway): ${err?.message ?? err}`);
}

app.listen(PORT, () => {
  console.log(`TWK dev server running:`);
  console.log(`  Dashboard + QR:  ${BASE}`);
  console.log(`  API base:        ${BASE}/api`);
  console.log(`  Demo deep link:  twk://t/${DEMO_TOKEN}?api=${BASE}/api`);
});
