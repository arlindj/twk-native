# Bare React Native project (NO Expo)

This app was migrated off Expo entirely. Do not add any `expo-*` package or
suggest `expo`/`npx expo` commands. It is a bare React Native 0.86 app:

- Entry: `index.js` → `src/App.tsx` (react-navigation, deep linking).
- Native projects `ios/` and `android/` are source of truth and committed —
  never regenerate them with `expo prebuild`.
- Native config changes (permissions, intent filters, icons) go directly in
  `ios/TWKParticipate/Info.plist` / `android/app/src/main/AndroidManifest.xml`.
- Custom native module: `ScreenRecorder` (Swift in `ios/TWKParticipate/`,
  Kotlin in `android/.../screenrecorder/`), JS facade in `modules/screen-recorder/`.

Check https://reactnative.dev/docs/0.86/getting-started for version-exact APIs
before writing code that touches the RN runtime.
