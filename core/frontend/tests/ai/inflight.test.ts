import { describe, it, expect } from 'vitest';
import { InflightRegistry } from '../../components/editor/aiAutocomplete/cache';

describe('InflightRegistry', () => {
  it('dedup: same key + 3 concurrent callers resolve to one factory result', async () => {
    const reg = new InflightRegistry<string>();
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls++;
      return new Promise<string>((resolve) => setTimeout(() => resolve('value'), 5));
    };
    const [a, b, c] = await Promise.all([
      reg.start('k', factory),
      reg.start('k', factory),
      reg.start('k', factory),
    ]);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(c).toBe('value');
    expect(factoryCalls).toBe(1);
  });

  it('different keys run independent factories in parallel', async () => {
    const reg = new InflightRegistry<string>();
    let calls = 0;
    const make = (label: string) => () => {
      calls++;
      return Promise.resolve(label);
    };
    const [a, b] = await Promise.all([
      reg.start('keyA', make('A')),
      reg.start('keyB', make('B')),
    ]);
    expect(a).toBe('A');
    expect(b).toBe('B');
    expect(calls).toBe(2);
  });

  it('rejected promise clears registry — next call re-runs factory', async () => {
    const reg = new InflightRegistry<string>();
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new Error('boom'));
    };
    await expect(reg.start('k', failing)).rejects.toThrow('boom');
    // Registry should now be clear for 'k'.
    expect(reg.has('k')).toBe(false);
    const succeeding = () => {
      calls++;
      return Promise.resolve('ok');
    };
    await expect(reg.start('k', succeeding)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('resolved promise clears registry', async () => {
    const reg = new InflightRegistry<string>();
    await reg.start('k', () => Promise.resolve('v'));
    expect(reg.has('k')).toBe(false);
  });

  it('mid-flight, has(key) is true; settles cleanly', async () => {
    const reg = new InflightRegistry<string>();
    let resolveIt!: (v: string) => void;
    const promise = reg.start('k', () => new Promise<string>((r) => { resolveIt = r; }));
    expect(reg.has('k')).toBe(true);
    resolveIt('done');
    await expect(promise).resolves.toBe('done');
    expect(reg.has('k')).toBe(false);
  });

  it('synchronously-throwing factory propagates the error and registry is empty', async () => {
    const reg = new InflightRegistry<string>();
    // A factory that throws synchronously isn't caught by `.finally` chained
    // on the returned promise — but `reg.start` calls `factory()` directly,
    // so a sync throw becomes a rejected start. Validate that it surfaces.
    expect(() =>
      reg.start('k', () => { throw new Error('sync fail'); })
    ).toThrow('sync fail');
    expect(reg.has('k')).toBe(false);
  });

  it('clear() drops all in-flight entries', async () => {
    const reg = new InflightRegistry<string>();
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    const pA = reg.start('a', () => new Promise<string>(r => { resolveA = r; }));
    const pB = reg.start('b', () => new Promise<string>(r => { resolveB = r; }));
    expect(reg.has('a')).toBe(true);
    expect(reg.has('b')).toBe(true);
    reg.clear();
    expect(reg.has('a')).toBe(false);
    expect(reg.has('b')).toBe(false);
    // Pending promises still resolve normally; registry side-effects only.
    resolveA('x');
    resolveB('y');
    await expect(pA).resolves.toBe('x');
    await expect(pB).resolves.toBe('y');
  });

  it('new call for the same key after settle starts a fresh inflight', async () => {
    const reg = new InflightRegistry<string>();
    let n = 0;
    const factory = () => Promise.resolve('v' + (++n));
    await expect(reg.start('k', factory)).resolves.toBe('v1');
    await expect(reg.start('k', factory)).resolves.toBe('v2');
  });

  it('factory returning already-resolved promise still cleans up', async () => {
    const reg = new InflightRegistry<string>();
    await expect(reg.start('k', () => Promise.resolve('fast'))).resolves.toBe('fast');
    expect(reg.has('k')).toBe(false);
    // Confirm a second start gets a fresh factory call.
    let count = 0;
    await reg.start('k', () => { count++; return Promise.resolve('again'); });
    expect(count).toBe(1);
  });

  it('two waiters on the same key receive identical reference (single promise)', async () => {
    const reg = new InflightRegistry<{ id: number }>();
    let calls = 0;
    const factory = () => {
      calls++;
      return Promise.resolve({ id: 42 });
    };
    const p1 = reg.start('k', factory);
    const p2 = reg.start('k', factory);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});
