# Security Specification — Japanese Language School Portal

## 1. Data Invariants
1. Every document write requires a verified Google Auth account (`request.auth != null && request.auth.token.email_verified == true`).
2. Self-privilege escalation is impossible: users creating their own `/users/{uid}` profile cannot set `role: 'head'` or `status: 'active'` unless their verified email is the bootstrapped Head email (`magghialifviandra@gmail.com`) or they have a matching verified `staffInvites` document.
3. Staff email PII is isolated in `/users/{userId}/private/info` (readable only by the owner or Head) and `/staffInvites/{inviteId}` (listable only by Head or the invited user matching `resource.data.email`).
4. All document IDs match `^[a-zA-Z0-9_\-]+$` (max 128 chars).
5. All string fields enforce explicit `.size()` boundaries matching `firebase-blueprint.json`.
6. All `createdAt` and `updatedAt` timestamps must equal `request.time` (immutable `createdAt` and owner/author UIDs on updates).
7. Every `update` block begins with `isValid[Entity](incoming())` and uses action-based `affectedKeys().hasOnly(...)` allowlists plus an `isHead()` escape hatch.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Promote to Head**: Unprivileged user creates `/users/{uid}` with `role: 'head'`, `status: 'active'`. -> `PERMISSION_DENIED`.
2. **Shadow Field Injection**: User creates `/dailyReports/{id}` with all valid fields plus `isApproved: true`. -> `PERMISSION_DENIED` (`hasOnly` rejects).
3. **Spoofed Unverified Email**: Request claims `email: 'magghialifviandra@gmail.com'` with `email_verified: false`. -> `PERMISSION_DENIED`.
4. **PII Leak Attempt**: Teacher attempts `get` on `/users/{otherUid}/private/info`. -> `PERMISSION_DENIED`.
5. **Blanket Invite Scraping**: Teacher attempts `list` on `/staffInvites` without filtering by own email. -> `PERMISSION_DENIED`.
6. **Impersonated Report Author**: Teacher creates `/dailyReports/{id}` with `teacherUid: 'other_uid'`. -> `PERMISSION_DENIED`.
7. **Forged Timestamp**: Client sends `createdAt: '2020-01-01'` instead of `request.time`. -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Client writes to `/students/invalid$id!with@chars` or >128 chars. -> `PERMISSION_DENIED`.
9. **Score Out-of-Bounds**: Client submits `/testResults/{id}` with `scorePercent: 999` or negative `earnedScore`. -> `PERMISSION_DENIED`.
10. **Unauthenticated Read**: Anonymous client attempts to read `/students/{id}` or `/questions/{id}`. -> `PERMISSION_DENIED`.
11. **Non-Head Student Deletion**: Pending or unapproved user attempts to delete `/students/{id}`. -> `PERMISSION_DENIED`.
12. **Immutable Owner Mutation**: Teacher updates `/dailyReports/{id}` trying to change `teacherUid` or `createdAt`. -> `PERMISSION_DENIED`.
