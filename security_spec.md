# Security Specification for Firestore Rules

## 1. Data Invariants
- A `guilds/{guildId}` document contains guild configurations.
- `user_levels/{userId}` documents store leveling progress.
- `tickets/{channelId}` documents track support ticket states.
- `afk/{userId}` documents record member AFK status.
- `kv_data/{key}` documents hold arbitrary key-value items.

## 2. Dirty Dozen Payloads (Security Edge Cases)
1. Unauthorized anonymous document creation in `/guilds/{guildId}`
2. Updating `userId` in `user_levels` payload
3. Injecting 2MB string payload into `AFK` reason
4. Setting negative `xp` or negative `level` in leveling data
5. Malformed key injection with slashes into `kv_data`
6. Overwriting system settings with non-admin auth token
7. Creating tickets without a valid `channelId`
8. Writing `expiresAt` in the past to corrupt cache eviction
9. Accessing another guild's ticket data without permissions
10. Spoofing owner identity on leveling record updates
11. Injecting invalid data types (e.g. array instead of map for data)
12. Unauthenticated list queries on user levels

## 3. Test Runner
See `firestore.rules.test.ts` for automated security validation assertions.
