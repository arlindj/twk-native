import ScreenRecorder from '../modules/screen-recorder';
import { randomUUID } from './utils/crypto';

/**
 * Replaces expo-constants.
 * Keep APP_VERSION in sync with MARKETING_VERSION (iOS) and
 * versionName (Android).
 */
export const APP_VERSION = '1.0.0';

/** Device model identifier from the native side (e.g. "iPhone15,2", "Pixel 8"). */
export const DEVICE_MODEL = ScreenRecorder.deviceModel ?? 'unknown';

/** Stable id for this app launch — consent audit trail (was Constants.sessionId). */
export const LAUNCH_ID = randomUUID();
