import NetInfoModule, { type NetInfoState } from '@react-native-community/netinfo';

/**
 * Connectivity — the app's only source of truth about the radio.
 *
 * Without this, every retry loop was blind: four attempts with a doubling
 * backoff burned themselves out in ~30s while the radio was simply down
 * (elevator, tunnel, underground parking), and then the participant was
 * shown a failure they had no way to understand. Retries now *wait for the
 * network to come back* instead of counting down against it.
 *
 * `isInternetReachable` is deliberately preferred over `isConnected`: a
 * captive-portal Wi-Fi (hotel, airport, mall) is "connected" and routes
 * nothing, which is one of the failure modes that used to hang forever.
 * It is tri-state though — `null` means "not determined yet", which must be
 * treated as usable rather than offline, or a cold check right after launch
 * would refuse to even try.
 *
 * The native module is optional at runtime: if it is missing (JS-only test
 * environment, or a JS bundle running on a build that predates the native
 * dependency) every helper degrades to "assume online", which restores the
 * previous behaviour instead of blocking the participant.
 */

export interface ConnectionInfo {
  online: boolean;
  /** 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown' | ... */
  type: string;
  /**
   * True when the OS says this connection costs the participant money
   * (cellular, or a metered hotspot). Used to ask before pushing tens of
   * megabytes of video over their data plan.
   */
  expensive: boolean;
  /** Cellular generation when known ('4g', '5g', …) — diagnostics only. */
  cellularGeneration?: string;
}

type Unsubscribe = () => void;

interface NetInfoLike {
  fetch(): Promise<NetInfoState>;
  addEventListener(listener: (s: NetInfoState) => void): Unsubscribe;
}

/** Present unless the JS bundle is running without the native module. */
const NetInfo: NetInfoLike | undefined =
  NetInfoModule && typeof NetInfoModule.fetch === 'function'
    ? (NetInfoModule as unknown as NetInfoLike)
    : undefined;

const UNKNOWN: ConnectionInfo = { online: true, type: 'unknown', expensive: false };

function toInfo(state: NetInfoState): ConnectionInfo {
  // isInternetReachable === null means "still probing" — not offline.
  const reachable = state.isInternetReachable !== false;
  const details = state.details as { isConnectionExpensive?: boolean; cellularGeneration?: string } | null;
  return {
    online: !!state.isConnected && reachable,
    type: state.type,
    expensive: details?.isConnectionExpensive ?? state.type === 'cellular',
    ...(details?.cellularGeneration ? { cellularGeneration: details.cellularGeneration } : {}),
  };
}

export async function connectionInfo(): Promise<ConnectionInfo> {
  if (!NetInfo) return UNKNOWN;
  try {
    return toInfo(await NetInfo.fetch());
  } catch {
    return UNKNOWN;
  }
}

export async function isOnline(): Promise<boolean> {
  return (await connectionInfo()).online;
}

/**
 * Resolves true as soon as the device has a usable connection, or false if
 * `timeoutMs` passes first. Event-driven, so coming out of a tunnel resumes
 * the upload in the same second rather than on the next backoff tick.
 */
export function waitForConnection(timeoutMs: number): Promise<boolean> {
  if (!NetInfo) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unsubscribe: Unsubscribe | undefined;
    const timer = setTimeout(() => finish(false), timeoutMs);

    function finish(online: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(online);
    }

    try {
      // Subscribe before the initial fetch: subscribing second could miss a
      // transition that lands between the two calls.
      unsubscribe = NetInfo!.addEventListener((state) => {
        if (toInfo(state).online) finish(true);
      });
    } catch {
      finish(true);
      return;
    }
    void connectionInfo().then((info) => {
      if (info.online) finish(true);
    });
  });
}

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export function onConnectivityChange(listener: (info: ConnectionInfo) => void): Unsubscribe {
  if (!NetInfo) return () => undefined;
  try {
    return NetInfo.addEventListener((state) => listener(toInfo(state)));
  } catch {
    return () => undefined;
  }
}
