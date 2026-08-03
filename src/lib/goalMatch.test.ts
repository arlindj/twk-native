import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildElementMatcher,
  goalIsEntryScreen,
  matchesGoal,
  matchesUrlPattern,
  normalizeText,
  parseGoalSignal,
  screenIdFromKey,
  screenKeyEquals,
  type GoalSignal,
  type ScreenKey,
  type TaskGoal,
} from './goalMatch.ts';

/**
 * Goal-matcher fixtures.
 *
 * This SAME case list exists in synth's `tests/usability/goal-matcher.test.ts`,
 * run against the ORIGINAL matcher. `src/lib/goalMatch.ts` is a hand-kept mirror
 * of that file (this app can't import the web monorepo's package), so these
 * fixtures are the only thing that catches drift between the two copies: if one
 * implementation changes behaviour, one of the two suites fails.
 *
 * Run: `npm test` (node's built-in runner — no jest, no transform step; the file
 * is excluded from tsconfig because it imports node: builtins the app doesn't).
 */

const entry: ScreenKey = { path: '/p/abc', hash: '#home', sig: 'h0me01' };
const cart: ScreenKey = { path: '/p/abc', hash: '#cart', sig: 'cart01' };
const done: ScreenKey = { path: '/p/abc', hash: '#done', sig: 'done01' };
const namedDone: ScreenKey = { path: '/p/abc', hash: '', sig: 'swap02', name: 'order-confirmed' };

const sig = (over: Partial<GoalSignal> & Pick<GoalSignal, 'kind' | 'screen'>): GoalSignal => ({
  type: 'synth-signal',
  v: 1,
  ts: 1,
  ...over,
});

const CHECKOUT_BUTTON = {
  sel: ['#pay', 'button:nth-of-type(1)'],
  text: 'pay €79',
  role: 'button',
};

describe('normalizeText', () => {
  it('collapses whitespace, lowercases and caps at 80 chars', () => {
    assert.equal(normalizeText('  Add   TO\nCart  '), 'add to cart');
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText('x'.repeat(200)).length, 80);
  });
});

describe('screenKeyEquals', () => {
  it('treats an authored name as authoritative when both sides have one', () => {
    assert.equal(
      screenKeyEquals({ ...cart, name: 'cart' }, { path: '/other', hash: '#x', sig: 'z', name: 'cart' }),
      true,
    );
    assert.equal(screenKeyEquals({ ...cart, name: 'cart' }, { ...cart, name: 'checkout' }), false);
  });

  it('compares path + hash, and sig only when both sides have it', () => {
    assert.equal(screenKeyEquals(cart, cart), true);
    assert.equal(screenKeyEquals(cart, done), false);
    assert.equal(screenKeyEquals(cart, { ...cart, sig: '' }), true);
    assert.equal(screenKeyEquals(cart, { ...cart, sig: 'other1' }), false);
  });

  it('is false when either side is missing', () => {
    assert.equal(screenKeyEquals(null, cart), false);
    assert.equal(screenKeyEquals(cart, undefined), false);
  });
});

describe('matchesUrlPattern', () => {
  it('matches exactly, or one path segment per *', () => {
    assert.equal(matchesUrlPattern('/checkout/done', '/checkout/done'), true);
    assert.equal(matchesUrlPattern('/order/*', '/order/42'), true);
    assert.equal(matchesUrlPattern('/order/*', '/order/42/receipt'), false);
    assert.equal(matchesUrlPattern('', '/anything'), false);
  });
});

describe('buildElementMatcher', () => {
  it('prefers the declared data-synth-goal over a fingerprint', () => {
    assert.deepEqual(buildElementMatcher({ sel: ['#pay'], text: 'pay', goal: 'checkout-done' }), {
      kind: 'declared',
      name: 'checkout-done',
    });
  });

  it('normalizes text/aria and dedupes selectors', () => {
    assert.deepEqual(
      buildElementMatcher({ sel: ['#pay', '#pay', 'button'], text: '  Pay  NOW ', aria: 'Pay Now' }),
      { kind: 'element', sel: ['#pay', 'button'], text: 'pay now', aria: 'pay now' },
    );
  });
});

describe('matchesGoal — element goals', () => {
  const goal: TaskGoal = {
    v: 1,
    label: 'Order paid',
    any: [{ kind: 'element', sel: ['#pay'], text: 'pay €79', role: 'button' }],
    entryScreen: entry,
  };

  it('matches on a shared selector', () => {
    assert.equal(
      matchesGoal(goal, sig({ kind: 'element', screen: cart, el: CHECKOUT_BUTTON }))?.kind,
      'element',
    );
  });

  it('matches on accessible text when the selectors all changed', () => {
    const responsive = {
      sel: ['div:nth-of-type(3)>button:nth-of-type(1)'],
      text: 'Pay €79',
      role: 'button',
    };
    assert.notEqual(matchesGoal(goal, sig({ kind: 'element', screen: cart, el: responsive })), null);
  });

  it('rejects the same text under a different role', () => {
    const link = { sel: ['a:nth-of-type(2)'], text: 'pay €79', role: 'link' };
    assert.equal(matchesGoal(goal, sig({ kind: 'element', screen: cart, el: link })), null);
  });

  it('ignores a screen signal', () => {
    assert.equal(matchesGoal(goal, sig({ kind: 'screen', screen: done })), null);
  });

  it('honours scopeScreen — same button label on another screen does not count', () => {
    const scoped: TaskGoal = { ...goal, scopeScreen: cart };
    assert.notEqual(
      matchesGoal(scoped, sig({ kind: 'element', screen: cart, el: CHECKOUT_BUTTON })),
      null,
    );
    assert.equal(matchesGoal(scoped, sig({ kind: 'element', screen: done, el: CHECKOUT_BUTTON })), null);
  });
});

describe('matchesGoal — screen goals', () => {
  it('matches a hash route but not the entry screen', () => {
    const goal: TaskGoal = {
      v: 1,
      label: 'Order confirmed',
      any: [{ kind: 'screen', hash: '#done', path: '/p/abc' }],
      entryScreen: entry,
    };
    assert.notEqual(matchesGoal(goal, sig({ kind: 'screen', screen: done })), null);
    assert.equal(matchesGoal(goal, sig({ kind: 'screen', screen: cart })), null);
    const selfGoal: TaskGoal = { ...goal, any: [{ kind: 'screen', hash: '#home', path: '/p/abc' }] };
    assert.equal(matchesGoal(selfGoal, sig({ kind: 'screen', screen: entry })), null);
  });

  it('matches a DOM-swap screen by authored name, ignoring path and hash', () => {
    const goal: TaskGoal = {
      v: 1,
      label: 'Order confirmed',
      any: [{ kind: 'screen', name: 'order-confirmed' }],
      entryScreen: entry,
    };
    assert.notEqual(matchesGoal(goal, sig({ kind: 'screen', screen: namedDone })), null);
    assert.equal(
      matchesGoal(goal, sig({ kind: 'screen', screen: { ...namedDone, name: 'cart' } })),
      null,
    );
  });

  it('matches a DOM-swap screen by signature when it has no name or hash', () => {
    const swapped: ScreenKey = { path: '/p/abc', hash: '', sig: 'swap99' };
    const goal: TaskGoal = {
      v: 1,
      label: 'Success panel',
      any: [{ kind: 'screen', sig: 'swap99', path: '/p/abc' }],
      entryScreen: { path: '/p/abc', hash: '', sig: 'swap00' },
    };
    assert.notEqual(matchesGoal(goal, sig({ kind: 'screen', screen: swapped })), null);
    assert.equal(
      matchesGoal(goal, sig({ kind: 'screen', screen: { ...swapped, sig: 'swap00' } })),
      null,
    );
  });

  it('never fires on a matcher with no fields', () => {
    const goal: TaskGoal = { v: 1, label: 'Empty', any: [{ kind: 'screen' }] };
    assert.equal(matchesGoal(goal, sig({ kind: 'screen', screen: done })), null);
  });
});

describe('matchesGoal — declared goals', () => {
  const goal: TaskGoal = {
    v: 1,
    label: 'Checkout done',
    any: [{ kind: 'declared', name: 'checkout-done' }],
  };

  it('matches a postMessage completion from the prototype', () => {
    assert.notEqual(
      matchesGoal(goal, sig({ kind: 'declared', screen: done, name: 'checkout-done' })),
      null,
    );
    assert.equal(matchesGoal(goal, sig({ kind: 'declared', screen: done, name: 'other' })), null);
  });

  it('matches a data-synth-goal attribute on the used element', () => {
    const el = { sel: ['[data-synth-goal="checkout-done"]'], text: 'pay', goal: 'checkout-done' };
    assert.notEqual(matchesGoal(goal, sig({ kind: 'element', screen: cart, el })), null);
  });

  it('does not match an element without the attribute', () => {
    assert.equal(matchesGoal(goal, sig({ kind: 'element', screen: cart, el: CHECKOUT_BUTTON })), null);
  });
});

describe('matchesGoal — legacy + versioning', () => {
  it('matches a legacy pathname pattern on a screen signal', () => {
    const goal: TaskGoal = {
      v: 1,
      label: '/checkout/done',
      any: [{ kind: 'url', pattern: '/checkout/*' }],
    };
    assert.notEqual(
      matchesGoal(goal, sig({ kind: 'screen', screen: { path: '/checkout/done', hash: '', sig: '' } })),
      null,
    );
  });

  it('ignores a goal from a future contract version', () => {
    const future = { v: 2, label: 'x', any: [{ kind: 'screen', hash: '#done' }] } as unknown as TaskGoal;
    assert.equal(matchesGoal(future, sig({ kind: 'screen', screen: done })), null);
  });

  it('ignores an empty or missing goal', () => {
    assert.equal(matchesGoal(null, sig({ kind: 'screen', screen: done })), null);
    assert.equal(matchesGoal({ v: 1, label: 'x', any: [] }, sig({ kind: 'screen', screen: done })), null);
  });

  it('returns the FIRST matching matcher, so ordering expresses confidence', () => {
    const goal: TaskGoal = {
      v: 1,
      label: 'Done',
      any: [
        { kind: 'element', sel: ['#nope'] },
        { kind: 'screen', hash: '#done', path: '/p/abc' },
      ],
      entryScreen: entry,
    };
    assert.equal(matchesGoal(goal, sig({ kind: 'screen', screen: done }))?.kind, 'screen');
  });
});

describe('goalIsEntryScreen', () => {
  it('flags a goal that is already true where the task starts', () => {
    assert.equal(
      goalIsEntryScreen(
        { v: 1, label: 'x', any: [{ kind: 'screen', hash: '#home', path: '/p/abc' }] },
        entry,
      ),
      true,
    );
    assert.equal(
      goalIsEntryScreen(
        { v: 1, label: 'x', any: [{ kind: 'screen', hash: '#done', path: '/p/abc' }] },
        entry,
      ),
      false,
    );
  });

  it('does not flag element or declared goals — they need an interaction', () => {
    assert.equal(
      goalIsEntryScreen({ v: 1, label: 'x', any: [{ kind: 'element', sel: ['#pay'] }] }, entry),
      false,
    );
    assert.equal(goalIsEntryScreen({ v: 1, label: 'x', any: [{ kind: 'declared' }] }, entry), false);
  });
});

// --- Mobile-only helpers ----------------------------------------------------

describe('parseGoalSignal', () => {
  it('accepts a well-formed v1 signal and fills missing screen fields', () => {
    const parsed = parseGoalSignal({
      type: 'synth-signal',
      v: 1,
      kind: 'screen',
      screen: { path: '/p/abc' },
      ts: 5,
    });
    assert.deepEqual(parsed, {
      type: 'synth-signal',
      v: 1,
      kind: 'screen',
      screen: { path: '/p/abc', hash: '', sig: '' },
      ts: 5,
    });
  });

  it('rejects anything it cannot trust rather than guessing', () => {
    assert.equal(parseGoalSignal(null), null);
    assert.equal(parseGoalSignal({ type: 'tap' }), null);
    assert.equal(parseGoalSignal({ type: 'synth-signal', v: 2, kind: 'screen', screen: { path: '/' } }), null);
    assert.equal(parseGoalSignal({ type: 'synth-signal', v: 1, kind: 'nope', screen: { path: '/' } }), null);
    assert.equal(parseGoalSignal({ type: 'synth-signal', v: 1, kind: 'screen' }), null);
  });
});

describe('screenIdFromKey', () => {
  it('prefers the authored name, then the hash, then the signature', () => {
    assert.equal(screenIdFromKey(namedDone), 'order-confirmed');
    assert.equal(screenIdFromKey(done), 'done');
    assert.equal(screenIdFromKey({ path: '/p/abc', hash: '', sig: 'swap01' }), 'dom-swap01');
    assert.equal(screenIdFromKey({ path: '/p/abc', hash: '', sig: '' }), '/p/abc');
  });
});
