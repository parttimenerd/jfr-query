import { describe, it, expect, beforeEach } from 'vitest';

// Import the class via a fresh module instantiation for isolated tests.
// The module exports a singleton, so we re-create the logic directly.
// We do this by importing and testing through the singleton's behavior
// (reset isn't available), but we can verify all behaviors with fresh calls.

// Since linkXStore is a singleton and tests share state, we test behavior
// rather than resetting. Each test uses unique keys.

import { linkXStore } from '../../services/linkXStore';

const KEY_A: [string, string] = ['$startA', '$endA'];
const KEY_B: [string, string] = ['$startB', '$endB'];

describe('LinkXStore — key', () => {
    it('produces a stable string key from a variable pair', () => {
        expect(linkXStore.key(KEY_A)).toBe('$startA::$endA');
    });

    it('produces different keys for different pairs', () => {
        expect(linkXStore.key(KEY_A)).not.toBe(linkXStore.key(KEY_B));
    });
});

describe('LinkXStore — publish and get', () => {
    it('get returns null for an unpublished key', () => {
        const unique: [string, string] = ['$unpublished1', '$unpublished2'];
        expect(linkXStore.get(unique)).toBeNull();
    });

    it('get returns the published domain', () => {
        const key: [string, string] = ['$pub1', '$pub2'];
        linkXStore.publish(key, [100, 200]);
        expect(linkXStore.get(key)).toEqual([100, 200]);
    });

    it('null domain is stored and retrievable', () => {
        const key: [string, string] = ['$null1', '$null2'];
        linkXStore.publish(key, [100, 200]);
        linkXStore.publish(key, null);
        expect(linkXStore.get(key)).toBeNull();
    });
});

describe('LinkXStore — subscribe', () => {
    it('subscriber receives current value immediately on subscribe', () => {
        const key: [string, string] = ['$sub1', '$sub2'];
        linkXStore.publish(key, [10, 20]);
        const received: any[] = [];
        const unsub = linkXStore.subscribe(key, d => received.push(d));
        expect(received).toEqual([[10, 20]]);
        unsub();
    });

    it('subscriber receives null immediately when no domain published', () => {
        const key: [string, string] = ['$sub_none1', '$sub_none2'];
        const received: any[] = [];
        const unsub = linkXStore.subscribe(key, d => received.push(d));
        expect(received).toEqual([null]);
        unsub();
    });

    it('subscriber receives publish updates', () => {
        const key: [string, string] = ['$sub_upd1', '$sub_upd2'];
        const received: any[] = [];
        const unsub = linkXStore.subscribe(key, d => received.push(d));
        received.length = 0; // clear the immediate call
        linkXStore.publish(key, [50, 100]);
        linkXStore.publish(key, [75, 150]);
        expect(received).toEqual([[50, 100], [75, 150]]);
        unsub();
    });

    it('multiple subscribers on the same key all receive updates', () => {
        const key: [string, string] = ['$multi1', '$multi2'];
        const r1: any[] = [];
        const r2: any[] = [];
        const u1 = linkXStore.subscribe(key, d => r1.push(d));
        const u2 = linkXStore.subscribe(key, d => r2.push(d));
        r1.length = 0;
        r2.length = 0;
        linkXStore.publish(key, [1, 2]);
        expect(r1).toEqual([[1, 2]]);
        expect(r2).toEqual([[1, 2]]);
        u1();
        u2();
    });

    it('unsubscribed listener no longer receives updates', () => {
        const key: [string, string] = ['$unsub1', '$unsub2'];
        const received: any[] = [];
        const unsub = linkXStore.subscribe(key, d => received.push(d));
        received.length = 0;
        unsub();
        linkXStore.publish(key, [99, 200]);
        expect(received).toHaveLength(0);
    });
});
