/**
 * Task-completion GOAL matcher — a VERBATIM MIRROR of synth's
 * `packages/types/src/goal.ts`.
 *
 * This app cannot import that package (it is a bare React Native project outside
 * the web monorepo), so the contract is duplicated instead. Two guards keep the
 * copies honest:
 *  - `v: 1` on every goal: an unrecognized version is ignored rather than
 *    guessed at, so a web-side contract change degrades to "no auto-complete"
 *    instead of to a wrong completion;
 *  - the fixture list in `goalMatch.test.ts` is the SAME list as the web repo's
 *    matcher test. If the two implementations drift, one of them fails.
 *
 * Everything here is pure — no React, no RN modules — so it runs under
 * `node --test` directly.
 *
 * Why a goal is not just a screen id: an uploaded HTML prototype is one
 * self-contained file served at a fixed URL, so its pathname is a CONSTANT.
 * Completion has to be expressible as "this element was used" or "this screen
 * was reached", where a screen is identified by hash + authored name + DOM
 * signature.
 */

/**
 * A prototype screen's identity. `name` (authored via `data-synth-screen`) is
 * authoritative when both sides have it; `hash` is next; `sig` (a structural DOM
 * signature) is a last resort because it also flips on unrelated layout changes.
 */
export type ScreenKey = {
  path: string;
  hash: string;
  sig: string;
  name?: string;
};

/** Ordered candidate fingerprints of an element the participant used. */
export type ElementFingerprint = {
  sel: string[];
  text?: string;
  role?: string;
  aria?: string;
  /** `data-synth-goal` value — the declared convention. */
  goal?: string;
};

export type GoalMatcher =
  | { kind: 'declared'; name?: string }
  | { kind: 'element'; sel: string[]; text?: string; role?: string; aria?: string }
  | { kind: 'screen'; hash?: string; path?: string; sig?: string; name?: string }
  | { kind: 'url'; pattern: string };

export type TaskGoal = {
  v: 1;
  label: string;
  any: GoalMatcher[];
  scopeScreen?: ScreenKey;
  entryScreen?: ScreenKey;
  needsReview?: boolean;
};

/** What the injected tracker / the WebView bridge posts. */
export type GoalSignal = {
  type: 'synth-signal';
  v: 1;
  kind: 'screen' | 'element' | 'declared';
  screen: ScreenKey;
  el?: ElementFingerprint;
  name?: string;
  ts: number;
  framesUnsupported?: boolean;
};

/** Whitespace-collapsed, lowercased, length-capped text. */
export function normalizeText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
}

/**
 * Are two screen keys the same screen? Authored names win outright when both
 * sides carry one; otherwise path + hash must agree and `sig` is only compared
 * when BOTH sides have it (a key captured before the DOM settled has an empty
 * sig and must not read as a different screen for that reason alone).
 */
export function screenKeyEquals(
  a: ScreenKey | null | undefined,
  b: ScreenKey | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.name && b.name) return a.name === b.name;
  if ((a.path ?? '') !== (b.path ?? '')) return false;
  if ((a.hash ?? '') !== (b.hash ?? '')) return false;
  if (a.sig && b.sig) return a.sig === b.sig;
  return true;
}

/**
 * Legacy success-screen semantics: exact match, or a `*` glob where each `*`
 * stands for exactly one path segment (anchored).
 */
export function matchesUrlPattern(pattern: string, path: string): boolean {
  const pat = (pattern ?? '').trim();
  if (!pat) return false;
  if (!pat.includes('*')) return pat === path;
  const re = new RegExp(
    '^' +
      pat
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]+') +
      '$',
  );
  return re.test(path);
}

/** Turn a captured fingerprint into the matcher a goal should store. */
export function buildElementMatcher(el: ElementFingerprint): GoalMatcher {
  if (el.goal) return { kind: 'declared', name: el.goal };
  const m: GoalMatcher = { kind: 'element', sel: [...new Set(el.sel ?? [])].slice(0, 8) };
  const text = normalizeText(el.text);
  if (text) m.text = text;
  if (el.role) m.role = el.role;
  if (el.aria) m.aria = normalizeText(el.aria);
  return m;
}

function elementHit(
  m: Extract<GoalMatcher, { kind: 'element' }>,
  el: ElementFingerprint,
): boolean {
  const want = m.sel ?? [];
  const got = el.sel ?? [];
  if (want.length > 0 && got.some((s) => want.includes(s))) return true;
  if (m.aria && normalizeText(el.aria) === m.aria) return true;
  if (m.text && normalizeText(el.text) === m.text) {
    if (!m.role || m.role === el.role) return true;
  }
  return false;
}

function screenHit(m: Extract<GoalMatcher, { kind: 'screen' }>, screen: ScreenKey): boolean {
  const fields = [m.name, m.hash, m.path, m.sig].filter((v) => v != null && v !== '');
  if (fields.length === 0) return false;
  if (m.name != null && m.name !== '' && screen.name !== m.name) return false;
  if (m.hash != null && m.hash !== '' && (screen.hash ?? '') !== m.hash) return false;
  if (m.path != null && m.path !== '' && (screen.path ?? '') !== m.path) return false;
  if (m.sig != null && m.sig !== '' && (screen.sig ?? '') !== m.sig) return false;
  return true;
}

/**
 * Does this signal satisfy the goal? Returns the matcher that fired (so the
 * caller can tell an element hit from a screen hit and wait for the transition
 * accordingly), or null.
 */
export function matchesGoal(
  goal: TaskGoal | null | undefined,
  signal: GoalSignal,
): GoalMatcher | null {
  if (!goal || goal.v !== 1 || !Array.isArray(goal.any) || goal.any.length === 0) return null;
  const screen = signal.screen ?? { path: '', hash: '', sig: '' };

  for (const m of goal.any) {
    switch (m.kind) {
      case 'declared': {
        if (signal.kind === 'declared') {
          if (m.name && signal.name !== m.name) break;
        } else if (signal.kind === 'element') {
          if (!signal.el?.goal) break;
          if (m.name && signal.el.goal !== m.name) break;
        } else {
          break;
        }
        if (goal.scopeScreen && !screenKeyEquals(goal.scopeScreen, screen)) break;
        return m;
      }
      case 'element': {
        if (signal.kind !== 'element' || !signal.el) break;
        if (!elementHit(m, signal.el)) break;
        if (goal.scopeScreen && !screenKeyEquals(goal.scopeScreen, screen)) break;
        return m;
      }
      case 'screen': {
        if (signal.kind !== 'screen') break;
        if (!screenHit(m, screen)) break;
        if (goal.entryScreen && screenKeyEquals(goal.entryScreen, screen)) break;
        return m;
      }
      case 'url': {
        if (signal.kind !== 'screen') break;
        if (!matchesUrlPattern(m.pattern, screen.path ?? '')) break;
        if (goal.entryScreen && screenKeyEquals(goal.entryScreen, screen)) break;
        return m;
      }
    }
  }
  return null;
}

/** Would this goal already be true on the task's first screen? */
export function goalIsEntryScreen(goal: TaskGoal, entry: ScreenKey): boolean {
  if (!goal.any.length) return false;
  return goal.any.every((m) => {
    if (m.kind === 'screen') return screenHit(m, entry);
    if (m.kind === 'url') return matchesUrlPattern(m.pattern, entry.path ?? '');
    return false;
  });
}

/** A goal built from a legacy success-screen value (a pathname or a Figma node id). */
export function legacyGoalFromSuccessScreen(pattern: string): TaskGoal {
  return { v: 1, label: pattern, any: [{ kind: 'url', pattern }] };
}

// ---------------------------------------------------------------------------
// Mobile-only helpers
// ---------------------------------------------------------------------------

/**
 * Parses a message from the prototype WebView into a GoalSignal, or null.
 *
 * Deliberately strict: a malformed or differently-versioned payload must produce
 * "no signal" (participant completes manually) rather than a guess that could
 * end a task early.
 */
export function parseGoalSignal(raw: unknown): GoalSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<GoalSignal>;
  if (m.type !== 'synth-signal' || m.v !== 1) return null;
  if (m.kind !== 'screen' && m.kind !== 'element' && m.kind !== 'declared') return null;
  const s = m.screen as Partial<ScreenKey> | undefined;
  if (!s || typeof s.path !== 'string') return null;
  return {
    type: 'synth-signal',
    v: 1,
    kind: m.kind,
    screen: {
      path: s.path,
      hash: typeof s.hash === 'string' ? s.hash : '',
      sig: typeof s.sig === 'string' ? s.sig : '',
      ...(typeof s.name === 'string' && s.name ? { name: s.name } : {}),
    },
    ...(m.el && typeof m.el === 'object' ? { el: m.el as ElementFingerprint } : {}),
    ...(typeof m.name === 'string' ? { name: m.name } : {}),
    ts: typeof m.ts === 'number' ? m.ts : Date.now(),
    ...(m.framesUnsupported ? { framesUnsupported: true } : {}),
  };
}

/**
 * A stable, human-ish screen id for analytics, derived from a ScreenKey.
 *
 * The beats pipeline keys everything by a screen STRING (`prototypeScreenId`),
 * and it has to agree with what the web tracker reports for the same screen or
 * the dashboard would show a mobile session's screens as a separate set. Order
 * mirrors the ScreenKey priority: authored name, hash route, then DOM signature.
 */
export function screenIdFromKey(screen: ScreenKey): string {
  if (screen.name) return screen.name;
  if (screen.hash) return screen.hash.replace(/^#/, '');
  if (screen.sig) return `dom-${screen.sig}`;
  return screen.path || 'entry';
}
