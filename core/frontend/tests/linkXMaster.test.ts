import { describe, it, expect } from 'vitest';
import { shouldPublishLinkX } from '../utils/linkXMaster';

describe('shouldPublishLinkX', () => {
  it('publishes when no linkX pair (no linking)', () => {
    expect(shouldPublishLinkX(undefined, undefined)).toBe(true);
  });
  it('publishes when linked with master undefined (legacy peer)', () => {
    expect(shouldPublishLinkX(['$a', '$b'], undefined)).toBe(true);
  });
  it('publishes when master is true', () => {
    expect(shouldPublishLinkX(['$a', '$b'], true)).toBe(true);
  });
  it('does NOT publish when master is false (explicit follower)', () => {
    expect(shouldPublishLinkX(['$a', '$b'], false)).toBe(false);
  });
});
