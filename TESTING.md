# Si ta testosh TWK Participate — udhëzues i plotë (hera e parë me native app)

Ky dokument shpjegon **hap pas hapi** si ta marrësh app-in në telefon, si ta testosh
end-to-end me serverin lokal, dhe si ta shpërndash më vonë (TestFlight / Play Store) —
njësoj siç e bën Maze.

---

## 0. Si e bën Maze (referenca jonë)

Nga dokumentacioni zyrtar i Maze:

- Maze ka një app të dedikuar **"Maze Participate"** në App Store dhe Google Play.
  Pjesëmarrësi e instalon **një herë** nga store-i publik.
- Studimi ndahet me **link/QR**. Linku hap app-in (nëse është i instaluar) përmes
  Universal Link / App Link; nëse jo, hap një faqe web fallback me buton "Install".
- Në mobile browser testet funksionojnë, por **pa screen recording** — prandaj app-i
  native rekomandohet nga vetë Maze si "the most reliable testing experience".
- "App tests" (teste mbi app të tjera reale) janë Enterprise-only dhe po ashtu kalojnë
  përmes Maze Participate app.

**Përfundimi për ne:** modeli ynë është identik — një app i vetëm publik në store
(TWK Participate), teste të shpërndara me link/QR, recording vetëm në app native.

---

## 1. Testim gjatë zhvillimit (tani, në kompjuterin tënd)

> **E rëndësishme:** Screen recording NUK funksionon në iOS Simulator.
> Duhet telefon real. Simulator-i mjafton vetëm për UI/flow pa recording.

### 1a. Nis backend-in lokal

```bash
cd server && npm install && cd ..
node server/index.js
```

Hap në browser adresën që printon (p.sh. `http://192.168.1.4:4000`). Kjo faqe është
"web dashboard"-i i zhvillimit: ka **QR code për testin demo** dhe më vonë shfaq
sesionet me video replay + tap markers.

### 1b. iOS — me kabllo, përmes Xcode (rruga jote kryesore)

Kërkesa: Mac me Xcode (e ke ✓), iPhone me kabllo, Apple ID falas.

```bash
npm install
cd ios && pod install && cd ..
npm run ios -- --device
```

> **Nëse `pod install` dështon** me `Encoding::CompatibilityError` (locale jo-UTF-8),
> ekzekutoje me locale të saktë:
> ```bash
> export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
> ```
> Shtoje këtë në `~/.zshrc` që të mos përsëritet.

Hapi pas hapi çfarë ndodh dhe çfarë duhet të bësh:

1. Komanda ndërton projektin native në `ios/` dhe hap listën e pajisjeve — zgjidh iPhone-in tënd.
2. Hera e parë do të dështojë signing. Hap `ios/TWKParticipate.xcworkspace` në Xcode →
   selekto projektin **TWKParticipate** → tab **Signing & Capabilities** →
   **Team**: zgjidh Apple ID-në tënde (Add Account nëse s'e ke shtuar) →
   Xcode krijon provisioning profile automatikisht.
3. Në iPhone: Settings → General → VPN & Device Management → **Trust** zhvilluesin.
4. Nëse iPhone ka iOS 16+: Settings → Privacy & Security → **Developer Mode** → ON → restart.
5. Rikthehu në terminal: `npm run ios -- --device` — tani buildohet dhe instalohet.

Shënim: me Apple ID **falas** app-i skadon pas 7 ditësh (ri-build) dhe **Associated
Domains (universal links) nuk lejohet** — përdor QR-in me `twk://` scheme (dev serveri
e gjeneron pikërisht ashtu). Me **Apple Developer Program ($99/vit)** hiqen të dyja kufizimet.

### 1c. Android — me kabllo

1. Në telefon: Settings → About phone → shtyp 7 herë "Build number" → Developer options → **USB debugging ON**.
2. Lidhe me kabllo, prano dialogun "Allow USB debugging".
3. ```bash
   npm run android
   ```
   (kërkon Android Studio + SDK të instaluar; nëse s'e ke: `brew install --cask android-studio`,
   hape një herë që të instalojë SDK-në.)

### 1d. Kryeje testin

1. Telefoni dhe kompjuteri në **të njëjtin Wi-Fi**.
2. Hap TWK Participate në telefon → **Scan QR code** → skano QR-in nga dashboard-i lokal.
3. Kalon: Consent → leje recording (iOS: dialog ReplayKit; Android: dialog MediaProjection) →
   Task 1 → prototype → "Done?" → pyetjet → upload.
4. Rifresko dashboard-in në browser: sheh sesionin, videon e ngarkuar dhe **tap markers
   të sinkronizuar me videon** gjatë replay.

### 1e. Vetëm në Simulator (pa recording)

```bash
npm run ios               # hap simulator
```
Në simulator app-i e detekton që recording s'është i mundur dhe të ofron
"Continue without recording (dev)" — buton që ekziston vetëm në dev build, kështu që
flow-i testohet komplet edhe pa telefon real (vetëm video mungon).

### 1f. E2E test automatik me Maestro

Flow i plotë i automatizuar (link → consent → 2 tasks → pyetje → completion):

```bash
# një herë: instalo Maestro (kërkon Java: brew install openjdk)
curl -Ls "https://get.maestro.mobile.dev" | bash

# me server + metro të ndezur dhe app të instaluar në simulator:
export JAVA_HOME=$(brew --prefix openjdk)
export PATH="$JAVA_HOME/bin:$PATH:$HOME/.maestro/bin"
maestro test .maestro/full-session.yaml
```

Pas ekzekutimit, kontrollo `http://localhost:4000` — sesioni shfaqet i kompletuar me
taps + answers.

---

## 2. Testim me njerëz të tjerë (beta) — si Maze para launch-it

### iOS — TestFlight (kërkon Apple Developer Program, $99/vit)

Build + upload direkt nga Xcode (projekt bare native, pa shërbime cloud):

```bash
open ios/TWKParticipate.xcworkspace
# Xcode: zgjidh "Any iOS Device (arm64)" → Product → Archive
# → Organizer → Distribute App → App Store Connect → Upload
```

Pastaj në [App Store Connect](https://appstoreconnect.apple.com) → TestFlight:
- **Internal testing**: deri 100 testera (anëtarë të ekipit), pa review, live menjëherë.
- **External testing**: deri 10,000 testera me **link publik invite** — Apple bën një
  review të shkurtër (1-2 ditë). Ky është ekuivalenti i "install link" të Maze.

Testeri: instalon app-in **TestFlight** nga App Store → hap linkun tënd të invite →
instalon TWK Participate. Update-et shkojnë automatikisht.

### Android — Google Play Internal Testing (llogari $25 një herë)

```bash
# një herë: krijo release keystore dhe konfiguroje në android/app/build.gradle
cd android && ./gradlew bundleRelease
# ngarko android/app/build/outputs/bundle/release/app-release.aab në Play Console
```

Në [Play Console](https://play.google.com/console) → Testing → **Internal testing**:
deri 100 testera me email ose link opt-in, live për minuta, pa review të plotë.
Alternativa zero-kosto: `cd android && ./gradlew assembleRelease` prodhon **APK**
(`android/app/build/outputs/apk/release/`) që e dërgon me çfarëdo linku — Android e
instalon direkt ("install nga burime të panjohura").

### App Review — çfarë do të pyesin (përgatitu)

- **Pse regjistron ekranin?** → Privacy policy + consent screen (e kemi: consent para çdo
  recording, indicator i dukshëm, retention policy në copy). Kjo është pika që Apple/Google
  kontrollojnë më shumë — mos e fshih askund recording-un.
- iOS `NSCameraUsageDescription` (vetëm për QR scan) — e deklaruar në `ios/TWKParticipate/Info.plist`.
- Android `FOREGROUND_SERVICE_MEDIA_PROJECTION` — deklarim në Play Console Data Safety.

---

## 3. Produksioni (si Maze në shkallë të plotë)

1. Publiko app-in në **App Store + Google Play** (një herë; pastaj vetëm update).
2. Web dashboard-i gjeneron link `https://test.tawakkalnaos.app/t/<token>` + QR.
3. Konfiguro universal links:
   - `https://test.tawakkalnaos.app/.well-known/apple-app-site-association` (Team ID + bundle ID)
   - `https://test.tawakkalnaos.app/.well-known/assetlinks.json` (SHA-256 e signing key)
4. E njëjta URL shërben faqen fallback: "Hape në app / Instalo nga App Store / Play".
5. Zëvendëso `server/index.js` me endpoint-et reale në backend-in tënd — kontrata API
   është dokumentuar në README dhe në `src/api/client.ts`.

---

## 4. Çfarë të testosh (QA checklist nga dokumentimi)

- [ ] Link/QR hap app-in në iOS dhe Android
- [ ] Token i skaduar → mesazh i qartë (dev serveri: çdo token ≠ `DEMO123` kthen 410)
- [ ] Refuzo recording permission → app shpjegon + retry, testi s'fillon
- [ ] Recording starton vetëm pas consent + OS permission
- [ ] Tap markers përputhen me videon në replay (dashboard lokal)
- [ ] Fike Wi-Fi gjatë testit → events ruhen lokalisht, sync në fund
- [ ] Fike Wi-Fi gjatë upload → "Upload didn't finish" + Retry, videoja s'humbet
- [ ] Mbylle app-in në mes → event `app_backgrounded` në timeline
- [ ] iPhone i vogël + i madh, Android low-end + flagship
