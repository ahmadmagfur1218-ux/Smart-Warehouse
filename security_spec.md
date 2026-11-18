# Security Specification & Payload-First TDD (`Smart Warehouse Inventory`)

## 1. Data Invariants
1. **Master Gate & Membership**: Every warehouse resource (`warehouses`, `zones`, `gates`, `racks`, `items`, `item_tags`, `devices`, `rack_stock`, `movements`, `alerts`, `settings`) is scoped to `ownerUid` and a bounded `memberUids` list (`size <= 25`), preventing unauthorized cross-tenant reads/lists without `get()`/`exists()` inside `allow list`.
2. **RBAC Integrity (Anti-Self-Elevation)**: Newly authenticated users creating `/users/{userId}` cannot assign themselves `ADMIN` or `OPERATOR` roles unless they match the verified bootstrapped admin email. Only `isAdmin()` may modify `role` or `status`.
3. **PII Isolation**: User email addresses are stored exclusively in `/users/{userId}/private/info`, readable only by the owner or `isAdmin()`.
4. **Immutable Audit Trail**: `movements` records cannot be forged with another user's `createdByUid` and are immutable once recorded (only `isAdmin()` can delete for cleanup).
5. **Temporal Integrity**: `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
6. **Non-Negative Capacity**: `rack.usedCapacity >= 0` and `rack.maxCapacity > 0` enforced in rules.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Email Write**: Authenticated token with `email_verified: false` attempting `create` on `/racks/rack-1` -> `PERMISSION_DENIED`.
2. **Self-Role Escalation**: Non-admin user creating `/users/{uid}` with `role: "ADMIN"` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection (Ghost Field)**: Valid rack payload plus `isBypassed: true` -> `PERMISSION_DENIED` via `keys().hasOnly(...)`.
4. **ID Poisoning**: Document ID > 128 chars or containing `$` / `/` (`rack$$$bad`) -> `PERMISSION_DENIED` via `isValidId()`.
5. **Unbounded Member Array**: `memberUids` with 26+ elements or first element not a string -> `PERMISSION_DENIED`.
6. **PII Blanket Read**: Non-owner Viewer reading `/users/otherUid/private/info` -> `PERMISSION_DENIED`.
7. **Timestamp Forgery**: `createdAt` set to client ISO string or past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
8. **Negative Rack Capacity**: Updating `/racks/rack-1` with `usedCapacity: -5` -> `PERMISSION_DENIED`.
9. **Movement Identity Spoofing**: Creating `/movements/mov-1` with `createdByUid != request.auth.uid` -> `PERMISSION_DENIED`.
10. **Viewer Mutation Attempt**: User with `role: "VIEWER"` attempting to update `/settings/set-1` -> `PERMISSION_DENIED`.
11. **Immutable Field Tampering**: Updating `/movements/mov-1` or changing `ownerUid` / `createdAt` on `/racks/rack-1` -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: Querying `/movements` without `memberUids` membership or bootstrapped admin claim -> `PERMISSION_DENIED`.
