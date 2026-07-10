# TWK Participate — Native Mobile Testing App

Native iOS + Android participant runtime for testing **mobile app prototypes** (Maze
Participate–style). The app does one thing: open a test from a link/QR/deep link, run it
with screen recording + tap tracking, and upload the evidence so the web dashboard can
build the results overview.

Built with **React Native + Expo (Development Build)** — not Expo Go, because screen
recording, app/universal links and the custom native modules require a real binary.

## What's inside

```
app/                     Expo Router screens (participant flow)
  index.tsx              Home: paste link / scan QR
  scan.tsx               QR scanner (expo-camera)
  t/[token].tsx          Deep-link target + phase-driven session runner
src/
  api/client.ts          Session API client (scoped participant token, retries)
  state/sessionStore.ts  Session state machine (consent → record → tasks → upload)
  events/eventQueue.ts   Persisted event queue: batching, idempotency, crash recovery
  upload/uploader.ts     Signed-URL video upload with retry; local file kept until confirmed
  recording/recorder.ts  Recording state machine facade over the native module
  components/            Maze-style UI kit (green brand), TapOverlay, question blocks
  screens/               Consent, permission, task intro, player, questions, upload, done
modules/screen-recorder/ Custom native module
  ios/                   ReplayKit (RPScreenRecorder) — in-app capture only
  android/               MediaProjection + foreground service (mediaProjection type)
server/                  Dev backend: full API contract, uploads, QR + replay viewer
```

## Quick start (development, end to end)

```bash
# 1. Install dependencies
npm install
cd server && npm install && cd ..

# 2. Start the dev backend (prints a QR + deep link, serves the demo prototype)
node server/index.js
# open http://<your-lan-ip>:4000 in a browser — this is the "web dashboard"

# 3. Build & run the app on a device (recording does NOT work in the simulator)
npx expo run:ios --device      # iPhone via cable, needs free Apple ID at minimum
npx expo run:android           # Android device with USB debugging

# 4. On the phone: open the app → "Scan QR code" → scan the QR from the dev dashboard.
#    The QR carries ?api=... so the app talks to your local server.

# 5. Finish the test on the phone, then refresh the dev dashboard:
#    you'll see the session, the uploaded video and tap markers synced on replay.
```

Phone and computer must be on the same Wi-Fi network.

## Deep links

| Format | Example | Used by |
|---|---|---|
| Universal/App Link | `https://test.tawakkalnaos.app/t/<token>` | production share links + QR |
| Custom scheme | `twk://t/<token>` | dev QR, fallback page button |
| Raw code | `DEMO123` | manual entry in the app |

`?api=<url>` on any link overrides the API base (development only).

Production requirements for universal links:
- iOS: serve `https://test.tawakkalnaos.app/.well-known/apple-app-site-association` with the app's Team ID + bundle ID (`com.tawakkalnaos.participate`).
- Android: serve `.well-known/assetlinks.json` with the app's signing-cert SHA-256.
- The same URL must render a web fallback page ("Install the app / Open the app") for people without the app.

## Screen recording

- **iOS — ReplayKit**: records only this app's screen. The system shows a consent alert
  on first start and the red status-bar indicator while recording. Output: local `.mp4`
  via `stopRecording(withOutput:)`.
- **Android — MediaProjection**: system consent dialog on *every* session (OS
  requirement), recording runs inside a foreground service of type `mediaProjection`
  with a persistent notification. Android 14+: consent token used exactly once.
- Simulators and Expo Go cannot record — the app detects this and explains it.

## Evidence pipeline

1. `POST /mobile/sessions/start` → scoped session token (SecureStore).
2. `GET /mobile/sessions/:id/bootstrap` → immutable StudyVersion payload.
3. Events (taps, task lifecycle, navigation) → persisted local queue → `POST
   /events/batch` with idempotency keys; retries never duplicate.
4. Video → `POST /recording/upload-url` → `PUT` to signed URL → `POST
   /recording/complete` with checksum/duration. Local file deleted only after confirmation.
5. `POST /mobile/sessions/:id/complete` → web overview is ready.

## Testing & distribution

See [TESTING.md](TESTING.md) for the full guide: Xcode, real devices, TestFlight,
Google Play internal testing, and how Maze does it (for reference).
