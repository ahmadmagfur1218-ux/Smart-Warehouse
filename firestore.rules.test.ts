import assert from 'node:assert/strict';

/**
 * Security Rule Unit Verification Spec for Smart Warehouse Inventory
 * Verifies the 12 adversarial payloads against the Eight Pillars design invariants.
 */
export const dirtyDozenCases = [
  {
    name: 'Unverified Email Write',
    collection: 'racks/rack-1',
    auth: { uid: 'u1', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Self-Role Escalation',
    collection: 'users/u2',
    auth: { uid: 'u2', email: 'operator@example.com', email_verified: true },
    payload: { uid: 'u2', role: 'ADMIN', status: 'ACTIVE' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Shadow Field Injection',
    collection: 'racks/rack-1',
    payload: { id: 'rack-1', isBypassed: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'ID Poisoning',
    collection: 'racks/rack$$$invalid',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Unbounded Member Array',
    collection: 'warehouses/wh-1',
    payload: { memberUids: Array.from({ length: 26 }, (_, i) => `u${i}`) },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'PII Blanket Read',
    collection: 'users/otherUid/private/info',
    auth: { uid: 'viewerUid', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Timestamp Forgery',
    collection: 'racks/rack-1',
    payload: { createdAt: '2026-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Negative Rack Capacity',
    collection: 'racks/rack-1',
    payload: { usedCapacity: -5 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Movement Identity Spoofing',
    collection: 'movements/mov-1',
    auth: { uid: 'u1', email_verified: true },
    payload: { createdByUid: 'someoneElse' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Viewer Mutation Attempt',
    collection: 'settings/set-1',
    auth: { uid: 'viewerUid', role: 'VIEWER' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Immutable Movement Update',
    collection: 'movements/mov-1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Blanket List Scraping',
    collection: 'movements',
    operation: 'list',
    queryWithoutMemberFilter: true,
    expected: 'PERMISSION_DENIED',
  },
];

assert.equal(dirtyDozenCases.length, 12);
