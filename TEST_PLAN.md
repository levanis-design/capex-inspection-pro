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
