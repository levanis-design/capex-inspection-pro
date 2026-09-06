# Test Plan — Capex Inspection Pro

**Status: DRAFT.** No application code exists yet, so nothing below is
implemented or tested. This file tracks the minimum acceptance tests that
must pass before each phase is considered complete. A feature is not marked
"done" anywhere in this project until its corresponding test here is checked
off.

## Multi-tenancy and security

- [ ] One organization cannot access another organization's data (RLS test)
- [ ] An inspector cannot perform administrator actions
- [ ] Row Level Security is enforced at the database level, not just the UI
- [ ] `properties` and `devices` tables reject direct client inserts (RLS
      `insert` policy is `false`) — the only path is the transactional
      function/Edge Function

## Plan entitlement (server-enforced)

- [ ] A Free-plan organization cannot create a second property, even by
      calling the insert endpoint directly instead of the UI
- [ ] **Concurrency test:** two simultaneous requests to create a second
      property under a Free-plan org result in exactly one success and one
      rejection, never two successes (proves the row lock in
      `create_property()` works)
- [ ] Archiving a property does not free its slot; only administrator
      permanent deletion does
- [ ] A Free-plan organization cannot invite a teammate (server-enforced,
      not just a hidden button)
- [ ] Reinstalling the app restores the same account/organization/property
      and does not create a new property or consume an extra slot

## Device registration and security

- [ ] Only the HMAC fingerprint is ever persisted — the raw app-scoped
      identifier is not present anywhere in the database or logs
- [ ] A rejected Play Integrity verdict blocks device registration, and the
      verdict is verified server-side (a forged/omitted client-side verdict
      does not pass)
- [ ] A second device registration attempt under a Free-plan org is
      rejected (device-slot concurrency test, same pattern as properties)
- [ ] Device replacement (including the reinstall path) revokes the old
      device, registers the new one, sends a security-notification email,
      and writes both a `security_events` and `audit_log` entry
- [ ] A device that already has one Free-plan account is **not** blocked
      from registering when accepting a legitimate invite to a different,
      paid-plan organization
- [ ] Administrator MFA is required and enforced for admin-only actions
- [ ] Signup, sign-in, and password-recovery endpoints are rate-limited and
      require CAPTCHA/bot-protection challenge
- [ ] Supabase Storage buckets are private; direct (non-signed) URLs to
      photos/reports are not accessible
- [ ] Signed URLs expire after their configured short lifetime
- [ ] A session/device can be forcibly revoked by an org admin and the
      revoked device is immediately unable to sync
- [ ] Local SQLite inspection data and cached photos are encrypted at rest
      on the device
- [ ] Backup restoration is tested end-to-end at least once (not just
      "backups run on schedule")

## Location-driven checklist generation

- [ ] Guided property setup never auto-activates a suggested component
      without explicit user confirmation
- [ ] The checklist generator never produces a duplicate
      (location, component, check) combination on the same property or
      inspection (uniqueness-constraint test)
- [ ] A critical check cannot be permanently removed via an ordinary
      template edit; deactivation requires a reason and admin approval,
      and is recorded in the audit log
- [ ] Each inspection type resolves to the correct scope (e.g. a "roof"
      inspection only includes roof-typed locations; a "follow-up"
      inspection pulls from prior open findings, not a fresh area sweep)
- [ ] Marking a location skipped/inaccessible/not-applicable without a
      reason is rejected
- [ ] The final review screen lists every uninspected/inaccessible
      location before an inspection can be submitted

## Templates and inspections

- [ ] Property checklist edits affect future inspections only
- [ ] Completed inspection snapshots do not change after template edits
- [ ] Required deficiency information is enforced (e.g. comment required on deficiency)

## Offline and sync

- [ ] Photographs survive an offline app closure/reopen
- [ ] Failed uploads retry safely without data loss
- [ ] Synchronization does not create duplicate findings
- [ ] Restored sessions resume at the correct location/section

## Records and lifecycle

- [ ] Archived properties retain their inspection history
- [ ] Completed inspections cannot be casually/permanently deleted by ordinary users

## Reports

- [ ] PDF reports match the stored inspection information exactly

## Platform

- [ ] Android permission denial (camera/storage) does not crash the app
- [ ] Application works correctly on a small phone and on a tablet
