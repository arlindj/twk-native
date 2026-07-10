import { requireNativeModule } from 'expo-modules-core';

/**
 * JS bridge for the native screen recorder.
 * iOS: ReplayKit (in-app capture, system permission dialog on start).
 * Android: MediaProjection + foreground service (system consent dialog
 * on every session, as required by the OS).
 *
 * In environments without the native module (Expo Go, web, simulator
 * builds without the module) a mock implementation is returned so the
 * rest of the flow stays testable — recording is simply reported as
 * unavailable.
 */

export interface NativeScreenRecorder {
  isAvailable(): Promise<boolean>;
  /** Resolves when recording is confirmed started (after OS consent). */
  startRecording(): Promise<void>;
  /** Resolves with the local file URI of the finished mp4. */
  stopRecording(): Promise<string>;
  /** Discards an in-flight recording without producing a file. */
  discardRecording(): Promise<void>;
}

class MockRecorder implements NativeScreenRecorder {
  async isAvailable() {
    return false;
  }
  async startRecording() {
    throw new Error('Screen recording is not available in this environment (Expo Go / web).');
  }
  async stopRecording(): Promise<string> {
    throw new Error('Screen recording is not available in this environment (Expo Go / web).');
  }
  async discardRecording() {
    /* no-op */
  }
}

let recorder: NativeScreenRecorder;
try {
  recorder = requireNativeModule<NativeScreenRecorder>('ScreenRecorder');
} catch {
  recorder = new MockRecorder();
}

export default recorder;
