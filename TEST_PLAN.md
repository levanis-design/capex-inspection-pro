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

- [x] Only the HMAC fingerprint is ever persisted — the raw app-scoped
      identifier is not present anywhere in the database or logs (confirmed
      by reading `register_or_replace_device()`'s and
      `register-device/index.ts`'s code: the app-scoped id is HMAC'd
      immediately and never included in any insert/update/log call)
- [ ] A rejected Play Integrity verdict blocks device registration, and the
      verdict is verified server-side (a forged/omitted client-side verdict
      does not pass) — **not applicable yet**: Play Integrity ships in a
      bypass mode this phase (see CHANGELOG.md's Phase 10 entry); this
      item is only meaningful once a Google Cloud project is linked to
      Play Console and `PLAY_INTEGRITY_MODE` is flipped to `enforce`
- [x] A second device registration attempt under a Free-plan org (device
      limit 1) is rejected — verified against local Postgres 16 as the
      real `service_role`/`authenticated` roles (not yet a true
      concurrency/race test with two simultaneous requests, unlike
      `create_property()`'s — worth adding if this becomes a priority)
- [x] Device replacement (including the reinstall path, since both use
      the identical `register_or_replace_device()` branch) revokes the
      old device, registers the new one, and writes both a
      `security_events` and `audit_log` entry — verified against local
      Postgres 16. The "sends a security-notification email" part is
      **not yet implemented** (no transactional email provider chosen
      yet, per PRODUCT_SPEC.md's decision log)
- [ ] A device that already has one Free-plan account is **not** blocked
      from registering when accepting a legitimate invite to a different,
      paid-plan organization — **not testable yet**: there is no
      teammate-invite flow built in this project yet (paid plans only,
      still a later phase)
- [x] Administrator MFA is required before an org_admin can reach the
      rest of the app (see the "MFA enrollment & challenge" section
      below) — this gates _reaching the app at all_ as an org_admin.
      **Phase 17 follow-up:** per-action `aal2` enforcement at the RLS/
      function layer, for the specific access points that are
      org_admin-exclusive, is now also built and locally verified — see
      the new "Phase 17" section below and CHANGELOG.md's Phase 17 entry
      for exactly which access points and why the broader
      org_admin/portfolio_manager/supervisor management set was
      deliberately left out
- [ ] Signup, sign-in, and password-recovery endpoints are rate-limited and
      require CAPTCHA/bot-protection challenge — Supabase Auth platform
      configuration, not app code; confirm this is actually turned on in
      your project's Auth settings
- [ ] Supabase Storage buckets are private; direct (non-signed) URLs to
      photos/reports are not accessible — covered by Phase 5B-ext/Phase 7's
      own test sections, not re-tested here
- [ ] Signed URLs expire after their configured short lifetime — same as
      above
- [x] A session/device can be forcibly revoked by an org admin
      (`revoke_device()`, verified against local Postgres 16: admin-only,
      cross-org-blocked). **Phase 17 follow-up:** the app now actively
      checks for its own device's revocation (on every sync attempt, on
      "Sync now," and via a 45-second poll while online) and signs out
      with an explanatory message when it finds it — see the new "Phase
      17" section below. This is a client-side check, not an RLS-level
      one: the underlying session token itself isn't invalidated, so a
      direct API call with the raw token would still succeed. A true
      database-level block would need every table's RLS to join out to
      `devices.status`, deliberately left as a further follow-up rather
      than done here.
- [ ] Local SQLite inspection data and cached photos are encrypted at rest
      on the device — covered by Phase 5C's own test section, not
      re-tested here
- [ ] Backup restoration is tested end-to-end at least once (not just
      "backups run on schedule") — a Supabase-project operational task,
      not app code

## MFA enrollment & challenge (Phase 10, src/lib/mfa.ts, mfa-setup.tsx/mfa-challenge.tsx)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with the MFA screens and
      the root layout's new routing.
- [x] On a physical device: sign in as a brand-new org_admin (no MFA
      enrolled yet) and confirm you're routed straight to "Set up
      two-factor authentication" with no way to skip it — confirmed
      2026-09-11.
- [x] Enter the shown secret into a real authenticator app (Google
      Authenticator, Authy, 1Password, etc.), enter the resulting 6-digit
      code, and confirm setup completes and you land in the app —
      confirmed 2026-09-11.
- [ ] Sign out and sign back in as that same admin — confirm you're now
      routed to the "Enter your two-factor code" challenge screen (not
      setup again), and that entering the current code from your
      authenticator app gets you into the app
- [ ] Entering a wrong/expired code on either screen shows an error and
      does not let you through
- [ ] "Sign out instead" on both screens actually signs out rather than
      leaving you stuck
- [ ] A non-admin role (inspector/viewer/etc.) signing in is never routed
      to either MFA screen, with or without a factor enrolled
- [ ] After enrolling, `Settings → Devices & Security → Recent security
events` shows an "Enabled two-factor authentication" ("mfa_enrolled")
      entry for that admin

## Device registration (Phase 10, migration 0022, register-device Edge Function)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with `device-registration.ts`
      and the new Edge Function.
- [x] Local Postgres 16, both `service_role` and `authenticated` roles,
      RLS enforced: a brand-new device registers and consumes a slot; the
      same fingerprint re-registering is idempotent (no new row, no
      double-counted slot); a different fingerprint for an already-active
      user replaces it (old revoked and linked via
      `replaced_by_device_id`, slot count unchanged); a brand-new user in
      an org already at its device limit is rejected
      (`device_slot_limit_reached`); `register_or_replace_device()` is
      unreachable by the plain `authenticated` role (only `service_role`);
      `devices` RLS shows a user their own device(s), an org_admin every
      device in the org, and nothing across organizations.
- [x] **Before any real-device test:** migration `0022` has been run in
      the Supabase SQL Editor, and `supabase/functions/register-device`
      has been deployed via the Supabase Dashboard's Edge Functions
      editor with a `DEVICE_HMAC_SECRET` project secret set — see
      CHANGELOG.md's Phase 10 entry. Without both, device registration
      fails silently in the background (nothing to call yet) with no
      visible error, since it's designed to be silent unless it fails.
      Confirmed 2026-09-11 — this took a few rounds of live debugging to
      get right (see CHANGELOG.md's Phase 10 notes for the Edge Function
      name-vs-slug gotcha that was the actual root cause).
- [x] On a physical device, first sign-in after this ships: confirm the
      app doesn't show the blocking "Couldn't register this device"
      screen — confirmed 2026-09-11 (full app, including
      Dashboard/Properties/Inspections/Corrective Actions/Settings,
      loaded normally with no blocking screen). **Correction, same day:**
      "no blocking screen" is not the same as "registration succeeded" —
      a follow-up DB check found zero rows in `devices`, because the
      deployed Edge Function was still Supabase's unreplaced default
      boilerplate template, which returns `200` (so the app sees success
      and never shows the blocking screen) without touching the database
      at all. See CHANGELOG.md's Phase 10 correction entry. The real
      `index.ts` was pasted in to fix this, but that fix was **not
      re-confirmed** afterward — re-check `Settings → Devices & Security`
      (your device should appear, with its integrity-check note showing
      the bypass reason) or re-run the `devices` row-count query next
      time you're on-device, and flip this note once confirmed either way.
- [ ] Reinstall the app (or clear its storage) and sign back in — confirm
      your previous device row shows as revoked (with `replaced_by_device_id`
      pointing at the new one) and the new one is active, with no change
      to your organization's property/device-slot usage
- [ ] Deliberately break registration (e.g. temporarily rename/disable the
      deployed Edge Function) and confirm the app shows the blocking
      error screen with working "Try again"/"Sign out" buttons, and that
      normal app usage otherwise wasn't disrupted before that point
- [ ] As an org_admin, open `Settings → Devices & Security`, confirm you
      can see every device in the organization (not just your own), and
      that revoking someone else's active device succeeds and moves it
      to the "revoked" state with a reason shown
- [ ] As a non-admin, confirm `Settings → Devices & Security` shows only
      your own device, no "Every device in your organization" section,
      and no "Recent security events" section

## Phase 11 (interim): report emailing, property deletion, start-inspection areas, multi-select add-area

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with all four changes.
- [x] Report screen: tap "Email / share report" on an approved report,
      confirm the native share sheet opens with the PDF and includes
      Mail/Gmail as a destination — device-tested, confirmed working.
      The navigation path to this screen (Inspections → an inspection →
      "Review & submit" → "View report →" once already submitted) was
      confusing for an already-completed inspection, since the entry
      button kept saying "Review & submit" even though nothing was left
      to submit — see the Phase 20 entry below for the small relabel
      fix that came out of walking through this.
- [ ] Property detail: "Archive property" moves an active property to
      archived (confirm it disappears from wherever only-active
      properties are expected, and shows "(archived)" in the properties
      list); "Restore property" reverses it
- [ ] Property detail: "Delete permanently" on a property with zero
      inspections removes it entirely (confirm its areas/components are
      also gone, and that it frees a plan slot on the properties list's
      usage count); attempting it on a property that has at least one
      inspection shows the friendly `property_has_inspections` error and
      does not delete anything
- [ ] Property detail: "Delete permanently" as a non-org_admin
      (portfolio_manager, supervisor, inspector) is rejected with the
      friendly `insufficient_permission` message
- [ ] ~~Start Inspection: areas load read-only until a location-selecting
      type is picked~~ — **superseded same-day by Phase 12** (areas are
      now always interactive, no type gating at all) — see that section
      below instead.
- [ ] Add Area modal (property setup): select several area types via
      checkbox, confirm the submit button reads "Add N areas", and
      submitting creates one `property_locations` row per selected type
      named after its area type
- [ ] Add Area modal: select exactly one area type (not Apartment/Unit),
      confirm the "Name this area" field appears and a custom name is
      honored on submit

## Phase 12: no-click checklist generation, area-first Start Inspection, apartment bedroom breakdown

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with all three changes.
- [ ] Property setup: add a single area (e.g. "Roof"), confirm no
      "confirm components" screen ever appears, and the setup screen's
      summary line updates automatically (no button tapped) to show an
      active-check count greater than zero
- [ ] Property setup: confirm the area row's "N components included"
      count matches the full standard component count for that area
      type (e.g. Roof shows 12), not a partial/manually-picked number
- [ ] Property setup: "Refresh checklist" on a property with only
      newly-added areas is a safe no-op (summary count doesn't change);
      on a property with an older area added before this shipped
      (0 components confirmed), it backfills that area's components and
      the active-check count increases accordingly
- [ ] Add Area modal: select only "Apartment/Unit", confirm the "Unit
      name" field and bedroom stepper appear (not the plain "Name this
      area" field), set bedrooms to e.g. 2, confirm the submit button
      reads "Add unit (5 rooms)", and submitting creates exactly 5
      `property_locations` rows (`<name> — Bedroom 1`, `— Bedroom 2`,
      `— Kitchen`, `— Bathroom`, `— Living Room`), each auto-confirmed
      with the full Apartment/Unit component set
- [ ] Add Area modal: select "Apartment/Unit" together with another
      type (e.g. "Storage Room") — confirm it falls back to the plain
      multi-select behavior (one row per type, no bedroom stepper),
      since the bedroom breakdown only triggers when Apartment/Unit is
      the sole selection
- [ ] Start Inspection: pick a property, confirm no inspection-type list
      is visible until then, and its areas appear immediately as an
      always-interactive checkbox list (no read-only state, regardless
      of what's picked elsewhere)
- [ ] Start Inspection: check one or more areas, confirm the "Start
      inspection (N areas)" button becomes enabled and starting it
      succeeds (inspection type stored as `custom`)
- [ ] Start Inspection: with zero areas checked, tap one of the 5 "Or
      start a quick inspection" rows (e.g. Comprehensive) and confirm it
      starts immediately with no separate submit step
- [ ] Start Inspection: confirm `apartment_unit` and `custom` inspection
      types no longer appear anywhere in this screen's UI (only in
      `src/lib/inspection-types.ts` and the database, where they're
      still valid/supported)

## Phase 13: preventive-maintenance checklist content (migration 0024)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass (no app code changed —
      this phase is a data-only migration, so this is a re-confirmation
      that adding a `.sql` file alone doesn't break anything).
- [x] Locally, against a disposable Postgres 16 database replaying the
      full migration chain from scratch: `0024` applies with each of
      its 4 `INSERT` statements returning the exactly-expected row count
      (16 / 33 / 7 / 4); afterward `inspection_check_library` holds 67
      rows and `check_applicability_rules` holds 74; a left-join query
      confirms zero checks with no applicability rule and zero rules
      missing both `area_type_id` and `component_type_id`.
- [ ] After running `0024` against the real Supabase project: on an
      existing property with a Boiler Room (or any area type that
      gained new component types — Basement, Elevator Room, Yard,
      Parking Area, Electrical Room, Hallway), tap "Refresh checklist"
      and confirm the active-check count increases and the new checks
      (e.g. "Inspect hot water heater for rust, discharge, or
      pressure-relief issues") appear in the property's checklist
- [ ] Add a brand-new area of one of those types on a property and
      confirm the new checks are included automatically (no manual
      refresh needed), consistent with Phase 12's no-click generation
- [ ] Start a walkthrough that includes one of the new checks and
      confirm it behaves identically to any pre-existing check: status
      can be set, a comment can be typed into `observation`, and a
      camera photo can be attached — no special-casing anywhere
- [ ] Confirm no checklist item appears twice for any single area (the
      specific risk this migration's drafting caught and fixed: two
      checks that started out with identical wording across two
      area/component pairs, which would have double-linked via the
      seeding SQL's name-based join if left unfixed)
- [ ] Confirm the two component types that reuse an existing check by
      name (Fire Extinguisher under Boiler Room/Electrical Room/
      Hallway/Basement; GFCIs and Smoke/CO Detectors under Hallway/
      Basement) show that check exactly once per area, not zero times
      and not duplicated
- [ ] Confirm nothing from the source checklist's "Compliance &
      Documentation" section (certificate expirations, FISP/LL11,
      log/vendor-report review) appears anywhere in the generated
      checklist — that section was deliberately excluded from this
      migration and is scoped as a separate future feature

## Phase 14: Compliance Documents (migration 0025)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with the new screen,
      modal, and lib modules.
- [x] Locally, a dedicated positive/negative RLS test suite against a
      disposable Postgres 16 database confirmed: org_admin can insert,
      update (with `updated_at` trigger firing), and delete a document;
      a portfolio_manager can insert; a plain `inspector` role's insert
      is rejected by RLS and its update is silently a no-op (0 rows
      affected, not an error); select is org-wide (inspector can see
      what admin created) but cross-org select returns zero rows; an
      insert stamping the caller's own organization_id but a property_id
      belonging to a different org is rejected; an invalid
      `document_type` or `status` value is rejected by its check
      constraint.
- [ ] After running `0025` against the real Supabase project: as an
      org_admin/portfolio_manager/supervisor, open a property's new
      "Compliance documents" screen from the property detail screen and
      add a document of each type (boiler certificate, elevator
      certificate, fire safety permit, FISP/LL11 filing, other) with a
      title, issuing authority, and expiration date
- [ ] Set one document's expiration date in the past, one within 30
      days, and one more than 30 days out — confirm they display as
      "Expired" (red), "Expiring soon" (amber), and "Valid" (green)
      respectively, with no manual status edit needed
- [ ] Set a document's status to "Renewal in progress" and confirm it
      displays that way regardless of its expiration date; set another
      to "Not applicable" (e.g. an elevator certificate on a property
      with no elevator) and confirm the same
- [ ] Attach a photo via "Take photo" and via "Choose from library" on
      two different documents; confirm both display a thumbnail on the
      list afterward and that the thumbnail still loads after leaving
      and returning to the screen (the signed URL is re-fetched on load,
      not cached indefinitely)
- [ ] Edit an existing document's fields and confirm the changes persist
      after navigating away and back
- [ ] Delete a document and confirm it's removed from the list
      immediately
- [ ] Sign in as a plain inspector (or viewer) role: confirm the
      "Compliance documents" entry on the property detail screen still
      shows the document list (read is portfolio-wide) but with no "Add
      compliance document" button and no edit/delete/photo controls on
      any row
- [ ] Confirm the property detail screen's "Compliance documents" row
      shows a red count badge equal to the number of documents that are
      expired or expiring within 30 days, and shows no badge when none
      are
- [ ] Confirm a document with no expiration date set at all displays as
      "Valid" (not "Expired" or blank) and never affects the attention
      count
- [ ] Android permission denial for camera or photo library access when
      attaching a photo shows a friendly message and does not crash the
      screen

## Phase 15: Compliance Tasks (migration 0026)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with the new screen,
      modals, and lib modules.
- [x] Locally, a dedicated positive/negative RLS test suite against a
      disposable Postgres 16 database confirmed: org_admin and
      portfolio_manager can insert a task of each type (including
      vendor_report_review with a vendor_id); any role can insert a
      completion and read the task/completion lists (inspector included);
      a plain `inspector` role's task insert/update/delete is rejected by
      RLS; an insert stamping the caller's own organization_id but a
      property_id or vendor_id belonging to a different org is rejected
      on both tables; a `vendor_id` set on a non-vendor_report_review task
      (and a vendor_report_review task with no `vendor_id`) is rejected by
      the check constraints in both directions; cross-org select on both
      tables returns zero rows; the `updated_at` trigger fires on task
      update; there is no update policy on `compliance_task_completions`
      at all (history rows are append-only).
- [ ] After running `0026` against the real Supabase project: as an
      org_admin/portfolio_manager/supervisor, open a property's new
      "Compliance tasks" screen from the property detail screen and add
      a task of each type (log review, vendor report review with a vendor
      picked from the active vendor list, other) with a title,
      description, and frequency
- [ ] Confirm the vendor picker only appears for "Vendor report review"
      tasks, shows a "no active vendors yet" hint when the property's
      organization has none, and that "Add compliance task" is disabled
      until a vendor is picked for that task type
- [ ] Record a completion (with and without notes) on a task and confirm
      it immediately shows "Last reviewed today" on the list and appears
      at the top of that task's review history
- [ ] Add a second, third completion over time (or backdate by adjusting
      the frequency/window) and confirm the due-status badge transitions
      correctly: "Never reviewed" before any completion, "OK" just after
      a completion, "Due soon" as the next due date (last completion +
      frequency) approaches within 7 days, and "Overdue" once it passes
- [ ] Edit an existing task's fields (including switching task type
      to/from vendor_report_review) and confirm the changes, and the
      vendor link's presence/absence, persist after navigating away and
      back
- [ ] Delete a task and confirm it and its full completion history
      disappear from the list immediately (cascade delete)
- [ ] Sign in as a plain inspector (or viewer) role: confirm the
      "Compliance tasks" entry on the property detail screen still shows
      the task list and due-status badges (read is portfolio-wide) and
      that the "record a completion" control still works, but there is no
      "Add compliance task" button and no edit/delete controls on any row
- [ ] Confirm the property detail screen's "Compliance tasks" row shows a
      red count badge equal to the number of tasks that are due soon,
      overdue, or never reviewed, and shows no badge when none are
- [ ] Android permission/network-error paths (recording a completion or
      loading history while offline) show a friendly message and do not
      crash the screen

## Phase 4 database layer (migrations 0007-0009)

- [x] Migrations `0007`, `0008`, `0009` each run successfully (in order) in
      the Supabase SQL Editor with no errors — confirmed 2026-09-06 (all
      tables visible in Table Editor).
- [x] `inspection_check_library` has 30 rows and `check_applicability_rules`
      has 30 rows after `0008` — confirmed 2026-09-06.
- [x] RLS is enabled (no "Unrestricted" badge) on `audit_log`,
      `inspection_check_library`, `check_applicability_rules`,
      `property_check_assignments`, and `property_template_versions` —
      confirmed 2026-09-06.
- [x] Verified against a local Postgres 16 instance (not the live Supabase
      project) 2026-09-06: full sign-up → property → building/locations/
      components → `generate_property_checklist()` scenario, including
      re-generation idempotency and the `set_inspection_check_status()`
      cross-tenant safeguard — see `CHANGELOG.md` for the exact scenario.

## Phase 4 wizard UI (add area / confirm components / generate checklist)

- [x] Tapping a property in the Properties list opens its detail screen
      with no crash — confirmed 2026-09-06.
- [x] "Set up buildings & areas" opens the wizard; "+ Add area" lets you
      pick an area type, name the instance, and it appears in the list —
      confirmed 2026-09-06.
- [x] Tapping an added area opens the components modal with every
      component for that area type shown, all starting unchecked —
      confirmed 2026-09-06.
- [x] Checking a component persists after closing and reopening the modal
      — confirmed 2026-09-06 (required migration `0010`, which initially
      hit the same "pasted the filename instead of its contents" mistake
      as `0006` — resolved by pasting the actual SQL).
- [x] Un-checking a mistakenly-confirmed component works and persists —
      confirmed 2026-09-06.
- [x] "Generate checklist" shows a count of newly added checks — confirmed
      2026-09-06 (added Boiler Room, confirmed its components, generate
      correctly reported 2 new checks, matching the 2 seeded Boiler Room
      checks). "Running it again with nothing new confirmed shows 0
      added" specifically wasn't retested on the live app this round
      (only against the local Postgres scenario in the delivery notes) —
      worth a quick spot-check next time you're in the wizard.
- [ ] The property detail screen's "active checks" count updates after
      generating (still not explicitly confirmed — you moved on to Phase
      5 before answering this one; worth a quick spot-check next time
      you're in the app)

## Phase 5A database layer (migrations 0011-0012)

- [x] Migrations `0011` and `0012` applied successfully in sequence
      against a local Postgres 16 instance — confirmed 2026-09-06 (not
      yet applied to the live Supabase project).
- [x] `start_inspection()` resolves the correct location/item scope for
      `comprehensive`, `roof`, `mechanical`, `common_area`, and
      `fire_life_safety` (including the critical-check-only filter
      correctly excluding a location whose only confirmed check isn't
      critical) — confirmed 2026-09-06 against a local Postgres scenario.
- [x] `apartment_unit`/`custom` correctly require an explicit location
      selection (`location_selection_required` when omitted) and
      correctly use it when supplied — confirmed 2026-09-06.
- [x] Deferred inspection types (`seasonal`, `follow_up`, etc.) and an
      invalid type each raise their own named error rather than silently
      doing nothing or guessing a scope — confirmed 2026-09-06.
- [x] An inspection's frozen snapshot does not change after the
      property's checklist is edited/regenerated, while a new inspection
      started afterward correctly picks up the change — confirmed
      2026-09-06 against a local Postgres scenario (this is the direct
      local-harness version of "Completed inspection snapshots do not
      change after template edits" below; still worth reconfirming
      against the live app once Phase 5B's UI exists).
- [x] Direct client inserts on `inspections`, `inspection_snapshots`,
      `inspection_snapshot_locations`, and `inspection_snapshot_items`
      are rejected by RLS (tested as the `authenticated` role with RLS
      actually enforced, not bypassed by a superuser) — confirmed
      2026-09-06.
- [x] `0011` and `0012` ran successfully in the Supabase SQL Editor with
      no errors — confirmed 2026-09-06. (The Table Editor's "Unrestricted"
      badge on the four new tables specifically wasn't checked this
      round — worth a quick glance next time you're in the dashboard.)
- [ ] Exercised from the actual app now that Phase 5B's walkthrough UI
      exists — see the "Phase 5B walkthrough UI" section below.

## Phase 5B walkthrough UI (start inspection / walkthrough / review)

Nothing in this section is confirmed on a device yet — this is the list
for your next round in the app.

- [ ] "Start inspection" lets you pick a property, an inspection type,
      and (for Apartment/unit or Custom) specific areas, and successfully
      starts one
- [ ] The Inspections list shows the new inspection with the right
      property, type, and status
- [ ] Opening a scheduled inspection flips it to "In progress"
- [ ] The walkthrough shows one area at a time with Prev/Next, in the
      expected route order
- [ ] Marking an item Satisfactory/Deficiency/N/A persists after leaving
      and reopening the inspection
- [ ] Marking an item Deficiency shows the observation field, and typing
      an observation and leaving the field saves it
- [ ] "Mark area complete" advances to the next area and the area's
      status updates
- [ ] Skip/Inaccessible/N/A on an area requires a reason and rejects an
      empty one
- [ ] The review screen correctly lists any area that isn't complete
      (with its reason) and every recorded deficiency
- [ ] A fully-recorded inspection's review screen offers a plain "Submit
      inspection" button; an incomplete one offers "Submit anyway"
      instead, with the warnings visible above it
- [ ] Submitting sets the inspection to "Completed" and it shows that way
      back on the list
- [ ] Opening a completed inspection shows the walkthrough read-only (no
      status buttons work, no area-marking actions shown)

## Phase 5B-ext database layer (migrations 0013-0014)

- [x] Migrations `0013` and `0014` applied successfully in sequence
      against a local Postgres 16 instance — confirmed 2026-09-06 (not
      yet applied to the live Supabase project).
- [x] Deactivating a `property_check_assignment` with a reason persists,
      and regenerating the property's checklist afterward correctly does
      NOT resurrect it — confirmed 2026-09-06 against a local Postgres
      scenario (this was an actual bug in the original generator, fixed
      as part of this migration — see `CHANGELOG.md`).
- [x] A critical check's assignment requires an org_admin to deactivate
      (a portfolio_manager is correctly rejected); reason-required,
      invalid-priority, and unknown-assignment rejections all confirmed
      — confirmed 2026-09-06.
- [x] `photos` and the Storage object-path policies correctly scope by
      organization under RLS (tested as the `authenticated` role against
      a local stand-in for the `storage` schema, not the real thing —
      see `DATABASE_SCHEMA.md` for the caveat) — confirmed 2026-09-06.
- [ ] Applied to the live Supabase project (SQL Editor, same as every
      prior migration) — including confirming the `inspection-photos`
      bucket actually appears in Storage
- [ ] The real Supabase Storage bucket/policies work from the app itself
      (this is the part the local harness can't fully prove)

## Phase 5B-ext app UI (checklist management + photo capture)

Nothing in this section is confirmed on a device yet.

- [ ] The property detail screen's "Active checks" card opens a list of
      every checklist item for that property, grouped by area
- [ ] Tapping an item opens an editor; changing its status to
      Inactive/Not applicable/Superseded requires a reason and rejects a
      blank one
- [ ] Deactivating a critical check as a non-admin is rejected with a
      clear message; the same change works for an org_admin
- [ ] Setting a priority/department override saves and displays
      correctly; picking "Use default" clears an existing override
- [ ] Regenerating the property's checklist after deactivating an item
      does not bring it back
- [ ] In the inspection walkthrough, an item whose check requires a
      photo (e.g. Roof Drains) shows a note and its Satisfactory/
      Deficiency buttons are disabled until a photo is attached; an item
      that doesn't require one (e.g. Entrance Doors) has no such gate
- [ ] Tapping "+ Photo" opens the camera, and a captured photo appears as
      a thumbnail after upload
- [ ] Denying camera permission shows a friendly message rather than
      crashing the app
- [ ] After a photo is attached, the previously-disabled status buttons
      become available

## Phase 5B-ext2 database layer (migration 0015)

- [x] Migration `0015` applied successfully against a local Postgres 16
      instance — confirmed 2026-09-06 (not yet applied to the live
      Supabase project).
- [x] An uninvolved inspector cannot void or delete a `scheduled`
      inspection they're not assigned to; the actually-assigned inspector
      can, while it's still scheduled — confirmed 2026-09-06.
- [x] A blank reason is rejected for both voiding and deleting — confirmed
      2026-09-06.
- [x] Once an inspection is `completed` (or otherwise past `scheduled`),
      only an org_admin can void or delete it — the assigned inspector is
      correctly rejected, and an org_admin correctly succeeds — confirmed
      2026-09-06.
- [x] A direct client update can never set `status = 'voided'` — tested
      as the actual `authenticated` role (not the postgres superuser,
      which bypasses RLS) — confirmed 2026-09-06.
- [x] Hard-deleting an inspection cascades away its snapshot/locations/
      items — confirmed 2026-09-06.
- [x] A foreign-org inspection id is reported identically to nonexistent
      for both `set_inspection_status()` and `delete_inspection()` —
      confirmed 2026-09-06.
- [ ] Applied to the live Supabase project (SQL Editor, same as every
      prior migration)

## Phase 5B-ext2 app UI (edit/void/delete an inspection)

Nothing in this section is confirmed on a device yet.

- [ ] The `⋮` button on an inspections-list row opens the manage screen
- [ ] The `⋮` button in the inspection walkthrough screen's header also
      opens the same manage screen (requires a full app reload, not just
      fast refresh, to pick up — see note in chat)
- [ ] Changing the scheduled date and/or assigned inspector and tapping
      "Save changes" persists and is reflected back on the list
- [ ] Entering an invalid date format shows a friendly validation message
      rather than a raw database error
- [ ] "Void inspection" requires a reason and, after confirming, the
      inspection shows as Voided (with the reason visible) both on this
      screen and in the inspections list
- [ ] "Delete inspection" requires a reason and, after confirming,
      navigates back to the inspections list with the inspection gone
      entirely
- [ ] As a non-admin assigned inspector, voiding/deleting a still-
      scheduled inspection works, but attempting either on an in-progress
      or completed inspection shows a clear "only an organization admin"
      message
- [ ] Once an inspection is voided, the scheduling fields are no longer
      editable on the manage screen

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

## Properties screen (Phase 3 UI)

- [x] Signing in with a fresh (or existing) account shows the Properties tab
      with no crash, either an empty state or the account's existing
      properties — verified 2026-09-06 on a physical Android device: a
      brand-new sign-up automatically got an organization/profile via the
      `handle_new_user()` trigger, no manual database steps needed.
- [x] "Add property" creates a property with just a name (other fields
      optional) and it appears in the list immediately after returning from
      the form — verified 2026-09-06 on a physical Android device.
- [ ] Attempting to add a second property on a Free-plan account shows the
      friendly "reached your plan's property limit" message (not a raw
      Postgres error) and does not create the row
- [ ] Leaving the property name blank and submitting shows "Property name is
      required" without a round trip to the server
- [ ] Settings screen shows the correct organization name and "Free plan · up
      to 1 property" for a Free-plan account
- [ ] Pull-to-refresh on the Properties list re-fetches without error

## Templates and inspections

- [ ] Property checklist edits affect future inspections only
- [ ] Completed inspection snapshots do not change after template edits
- [ ] Required deficiency information is enforced (e.g. comment required on deficiency)

## Offline and sync

### Phase 5C foundation (local-crypto.ts, offline-db.ts, connectivity.ts)

- [x] base64/UTF-8 codec round-trips (ascii, accented, CJK, emoji) —
      verified via standalone Node script
- [x] Full encrypt/decrypt round trip via tweetnacl secretbox
- [x] Tampered ciphertext correctly fails to decrypt (authentication)
- [x] Wrong key correctly fails to decrypt
- [x] Binary payload (simulated photo bytes) round-trips through
      encrypt/decrypt
- [x] Local SQLite schema + queries replayed against `node:sqlite` —
      INSERT OR IGNORE doesn't clobber an existing (locally-dirty) row,
      dynamic partial-field updates work, dirty-flag join query stays
      scoped to one inspection, cross-inspection rows stay isolated
- [x] `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass with the new
      expo-sqlite/expo-file-system/expo-crypto/expo-network/tweetnacl
      dependencies actually resolving through Metro (bundle size grew
      3.9MB → 4.1MB)
- [ ] On a physical device: opening an inspection while online actually
      writes rows into the local SQLite mirror (not yet a UI-visible
      behavior — would need a debug view or `resetLocalMirror()` call to
      inspect)
- [ ] Encryption key persists across app restarts (same key is reused,
      not regenerated) — not yet device-tested

### Walkthrough routed through the local mirror (`[id]/index.tsx`)

- [x] `load()` is network-first with a local-mirror fallback; code review + `tsc`/lint/format/`expo export --platform android` all pass
- [x] `handleItemStatus`, `handleSaveObservation`, `handleMarkComplete`,
      `handleConfirmMark` rewritten to local-write-first,
      network-best-effort — local SQLite write always happens, Supabase
      write only attempted when online, no UI revert on network failure
- [ ] On a physical device with airplane mode on: an already-opened
      inspection loads from the local mirror, shows the offline banner,
      and every write (status/observation/mark complete/mark
      skipped-inaccessible-N/A) is retained after closing and reopening
      the app
- [ ] Reconnecting after offline edits leaves the edited rows `dirty`
      until a sync engine (not yet built) drains them — no data loss, no
      silent overwrite by stale server data
- [ ] Opening an inspection that was never opened while online shows the
      "no offline copy yet" message rather than a blank/broken screen

### Offline photo capture (`offline-photos.ts`, `offline-db.ts` local_photos)

- [x] `capturePhotoOffline()` writes an encrypted file to
      `Paths.document/offline-photos` and indexes it in `local_photos`
      regardless of connectivity; code review + `tsc`/lint/format/
      `expo export --platform android` all pass
- [x] `resolveLocalPhotoDisplayUri()` decrypts on demand into
      `Paths.cache` rather than persisting decrypted bytes
- [x] Encrypt/decrypt of binary photo-sized payloads already verified via
      the local-crypto.ts standalone Node test (5000-byte round trip) —
      `encryptBytesForStorage`/`decryptBytesFromStorage` are the exact
      functions this module calls
- [x] Newly-captured local photos merge into the walkthrough's photo grid
      immediately (`refreshItemPhotos`) and on every subsequent load,
      online or offline (`mergeLocalPendingPhotos` /
      `loadWalkthroughFromLocalMirror`), without duplicating a photo
      that's since finished uploading
- [ ] On a physical device: taking a photo in airplane mode writes the
      encrypted file and shows the thumbnail with no network at all
- [ ] Photographs survive an offline app closure/reopen (the encrypted
      file + `local_photos` row + decrypted display cache all persist
      correctly across a full app restart)
- [ ] An online capture's immediate upload attempt actually lands the row
      in Supabase's `photos` table and the bucket, end to end, on a real
      device
- [ ] A capture made while offline, then later synced (once the sync
      engine exists), does not create a duplicate photo record

### Sync engine (`offline-sync.ts`, migration 0016)

- [x] Migration 0016 applied against a local Postgres 16 instance: the
      `set_updated_at()` trigger bumps `updated_at` on every update and
      overrides a client-supplied value (proving a client can't spoof
      the conflict check); a duplicate `photos.client_uuid` insert is
      rejected while multiple pre-migration `NULL` values stay allowed
      — confirmed 2026-09-07
- [x] `ensureColumn()` (the additive local-SQLite migration helper for
      `local_locations.conflict`/`local_items.conflict`/
      `local_photos.client_uuid`) verified against `node:sqlite`: adds a
      missing column once, is a no-op on a second call, and is a no-op
      against a table that already has the column — confirmed 2026-09-07
- [x] `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass with the sync engine
      wired into `[id]/index.tsx`
- [ ] On a physical device: edit several items/areas offline, reconnect,
      confirm every dirty row actually lands in Supabase and its local
      `dirty` flag clears
- [x] Synchronization does not create a duplicate `photos` row on a
      retried sync (idempotent via `client_uuid`) — the Postgres-level
      constraint is verified above, and this specifically (no duplicate
      row) held up correctly on the real-device retry-loop bug found
      2026-09-09 below: it was the Storage _upload_ step, not the
      `photos` row, that wasn't retry-safe
- [ ] A genuine conflict (server row changed by someone else while a
      local dirty edit also exists) is flagged `conflict` and shown in
      the walkthrough's conflict banner, not silently overwritten in
      either direction, on a real multi-device/multi-session scenario
- [x] **Bug found on a real device (2026-09-09, first standalone-build
      field test):** an interrupted sync run (uploaded to Storage, then
      didn't get to record the `photos` row/`markPhotoUploaded`) left a
      photo stuck retrying forever with
      `StorageApiError: The resource already exists` on every attempt —
      the Storage `.upload()` call was missing `{ upsert: true }`, so a
      retry to the same deterministic path was rejected outright instead
      of treated as a no-op. Fixed in both `offline-sync.ts` and
      `offline-photos.ts`; existing stuck rows self-heal on their next
      sync attempt with no manual step needed. `npm run lint`,
      `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass.
- [x] **Follow-on bug found on the same real device (2026-09-09), same two
      photo ids:** after the `upsert: true` fix above shipped, the two
      already-stuck photos hit a new error instead —
      `StorageApiError: new row violates row-level security policy`.
      Root cause: `upsert: true` takes an UPDATE path internally when the
      object already exists in Storage, and migration `0014` never
      granted an `update` RLS policy on `storage.objects` for the
      `inspection-photos` bucket (only select/insert/delete). Fixed by
      migration `0018` adding the missing
      `inspection_photos_update_own_org` policy. Verified against local
      Postgres 16 as the `authenticated` role: an update to an existing
      object under the caller's own org now succeeds where it previously
      matched 0 rows and raised the RLS error, and a second org's
      `authenticated` user still matches 0 rows against the same object
      (cross-org isolation intact). `npm run lint`,
      `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass (no app code changed —
      this is a database migration that must be applied to the live
      Supabase project's SQL Editor to take effect).
- [x] **Third bug in the same chain, found once migrations `0016`/`0017`
      were finally applied live (2026-09-09):** every photo upload —
      not just retries — failed at the `photos` insert step with a
      Postgres `42P10` error ("no unique or exclusion constraint matching
      the ON CONFLICT specification"). Root cause: `photos.client_uuid`'s
      unique index (migration `0016`) was declared _partial_
      (`where client_uuid is not null`), which Postgres cannot use as an
      `ON CONFLICT` inference target for the plain `on_conflict=`
      PostgREST generates. Fixed by migration `0019`, replacing it (and
      the identically-shaped `inspection_snapshot_items` one from `0011`)
      with a plain unique index — verified this doesn't weaken anything,
      since Postgres already treats NULL as never equal to another NULL
      for uniqueness. Verified end-to-end against local Postgres 16 as
      the real `authenticated` role: first insert succeeds, an identical
      retry no-ops instead of erroring, a second genuinely different
      photo still inserts normally, and a real duplicate without
      `ON CONFLICT` is still correctly rejected. `npm run lint`,
      `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass (no app code changed —
      another database migration that must be applied live).
- [ ] Re-verify on a physical device: an upload deliberately interrupted
      mid-transfer (e.g. toggling airplane mode mid-upload, or force-kill
      right after the Storage upload lands) now actually recovers and
      completes on the next sync, rather than looping the same error

### Resume mid-inspection + app-wide sync indicators (`inspections/index.tsx`, `(app)/_layout.tsx`)

- [x] `getAllLocalInspectionHeaders()`/`getSyncOverview()` SQL (header
      ordering, dirty/conflict-excluding pending counts, the two-subquery
      conflict total) verified against `node:sqlite` with seeded rows —
      confirmed 2026-09-07
- [x] `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass with the Inspections list
      and root tab layout wired to the local mirror/sync overview
- [ ] On a physical device, airplane mode: cold-start the app (not just
      reopen an already-loaded inspection) with a previously-mirrored
      in-progress inspection on the device — it appears in the Inspections
      list, opens, and resumes at the correct location/section
- [ ] The Inspections list's "manage" (⋮) button is correctly hidden while
      showing the offline/local-mirror fallback, and reappears once back
      online
- [ ] The root tab layout's "Offline" strip and the Inspections tab's
      pending-sync badge appear within one poll interval (15s) of actually
      going offline / a change becoming dirty, and clear again once synced
- [ ] A property/inspection never mirrored locally (never opened while
      online on this device) correctly does _not_ appear in the offline
      fallback list, and the "no offline copy yet" message is shown
      instead when the list is otherwise empty offline

### Conflict resolution UI (`[id]/conflicts.tsx`)

- [x] The four new SQL shapes (`getConflictedLocationsForInspection`/
      `getConflictedItemsForInspection`'s listings, the server-overwrite
      update, the keep-local-and-clear update) verified against
      `node:sqlite` with seeded rows, including confirming a "keep mine"
      resolution's row correctly reappears in the ordinary
      dirty-and-eligible-to-sync query afterward — confirmed 2026-09-07
- [x] `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass with the conflicts screen
      wired into the Inspections stack and the walkthrough screen's
      conflict banner
- [ ] On a physical device: create a genuine conflict (edit the same
      location/item from two sessions while one is offline, then bring it
      back online) and confirm it actually appears in this screen with
      both versions shown correctly
- [ ] "Keep mine" removes the row from the list, the change lands in
      Supabase shortly after (best-effort immediate sync), and the row's
      `dirty`/`conflict` flags clear correctly in the local mirror
- [ ] "Keep server's" removes the row from the list and the local mirror
      correctly reflects the server's content afterward (re-opening the
      walkthrough shows the server's version, not the discarded local
      edit)
- [ ] Resolving a conflict while offline (the "server version" fetch
      fails) shows a clear retry-able error and leaves the conflict
      flagged rather than silently losing it
- [ ] The walkthrough screen's conflict banner is tappable and opens this
      screen scoped to the correct inspection; the Inspections list's own
      conflict banner text (which spans multiple inspections) correctly
      does not attempt the same deep link

### Not yet built (remaining Phase 5C work)

- [x] ~~An actual resolution UI for a flagged conflict~~ — done above.
      Phase 5C is otherwise feature-complete against PRODUCT_SPEC.md
      section 9; everything remaining in this file for Phase 5C is
      real-device verification, not new app code.

## Phase 5D: deficiencies & corrective actions (migration 0017)

- [x] Marking an item `deficiency` auto-creates exactly one `findings`
      row and one `corrective_actions` row (status `open`), even when the
      caller is a plain inspector with no insert grant on either table —
      confirmed against a local Postgres 16 instance as the actual
      `authenticated` role, not the postgres superuser
- [x] Toggling an item `deficiency` → `satisfactory` → `deficiency` again
      does not create a second finding/corrective_action (idempotent via
      the partial unique index on `inspection_snapshot_item_id`)
- [x] An inspector's direct write to `findings`/`corrective_actions`
      matches zero rows under RLS (no insert/update policy exists at
      all); an inspector or viewer calling any of the four SECURITY
      DEFINER functions is rejected with `insufficient_permission`, while
      a viewer can still read every row (select has no role gate)
- [x] A portfolio manager can escalate a finding, create a vendor inline,
      and walk a corrective action through
      vendor_required → scheduled → in_progress → completed → verified
      → voided, with `findings.current_status` staying in sync at every
      step and one `audit_log` row per transition
- [x] `verified` is rejected (`must_be_completed_first`) unless the
      corrective action is currently `completed`; `voided` is rejected
      (`status_reason_required`) without a reason
- [x] Full cross-org isolation: a second org cannot see or modify the
      first org's findings/vendors/corrective_actions — a
      cross-org id is reported identically to a nonexistent one
- [x] Hard-deleting the inspection that raised a finding
      (`delete_inspection()`) does **not** delete the finding —
      `inspection_id`/`inspection_snapshot_item_id` are cleanly nulled
      out instead, confirming the deliberate `on delete set null` (not
      cascade) choice actually protects the compliance record
- [x] `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass with the Corrective
      Actions tab wired in
- [ ] On a physical device: mark a real item deficient during a
      walkthrough, confirm it shows up on the Corrective Actions board
      immediately, and walk it through the full board/detail UI (not
      just the RPCs directly)
- [ ] The "escalation due" indicator actually appears once a P1/P2
      finding has been open past its threshold, and disappears once
      escalated or resolved
- [ ] The final-review screen's deficiency cards correctly link to the
      matching deficiency detail screen
- [ ] Confirm role-gated UI: an inspector/viewer signed in on-device sees
      the board and detail screen read-only (no Manage/Escalate/priority
      controls), matching what the server already enforces

## Advisor hardening and RLS performance (migration 0020)

- [x] `set_updated_at()` gets `set search_path = public`, matching every
      other function in the schema
- [x] Every RLS policy flagged by the pasted `auth_rls_initplan` finding
      rewritten to `(select auth.uid())` / `(select
current_organization_id())` form — verified against local Postgres
      16 (`authenticated` role, RLS fully enforced) after applying the
      full migration chain through `0020`: an org's own admin still sees
      exactly their own property (not zero, not another org's), and a
      second org's admin sees zero rows against the first org's data
- [x] `profiles_update_self` + `profiles_update_by_admin` consolidated
      into one `profiles_update_self_or_admin` policy — verified a user
      can still update their own row and an org admin can still update
      another profile in their own org
- [x] **Found and fixed a real, previously-latent bug while writing this
      migration's own regression tests, unrelated to the pasted advisor
      output:** the old `profiles_update_by_admin` policy's admin check
      read `profiles` from a subquery inside `profiles`' own policy —
      Postgres raised "infinite recursion detected in policy for relation
      profiles" the moment ANY update touched the table, including a
      plain self-update that should only have needed the other policy.
      Confirmed this reproduces with the original, unwrapped `auth.uid()`
      too, so it's a live bug since migration `0001`, not something this
      migration's rewrite introduced — it just happened to be the first
      time anyone tried an actual `UPDATE` against `profiles` in this
      project's testing. Fixed with a new `current_user_is_org_admin()`
      `SECURITY DEFINER` helper (same pattern as
      `current_organization_id()`), which bypasses `profiles`' RLS on its
      internal read instead of re-entering it
- [x] Cross-org isolation still holds after the fix: an org B admin's
      `UPDATE` against an org A profile affects 0 rows, and the org A
      profile's value is confirmed unchanged afterward
- [x] Spot-checked two other rewritten policies end-to-end, not just the
      profiles one: an inspector can still reschedule their own assigned
      inspection (`inspections_update_own_org`'s
      `assigned_inspector_id = (select auth.uid())` branch), an org admin
      can still insert a vendor, and a plain inspector's vendor insert is
      still correctly rejected by RLS — plus a full rerun of the existing
      photos on-conflict end-to-end test to confirm the photos policies'
      initplan rewrite didn't change upload behavior
- [x] `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
      `expo export --platform android` all pass (no app code changed —
      this is a database migration that must be applied to the live
      Supabase project's SQL Editor to take effect)
- [ ] Once applied live, re-run the Security Advisor / Performance
      Advisor scan and confirm `function_search_path_mutable`,
      `auth_rls_initplan`, and the `profiles` `multiple_permissive_policies`
      finding are all gone
- [ ] If the advisor still shows `anon`/`authenticated`
      `security_definer_function_executable` warnings after `0020` is
      applied, run the diagnostic grant-check query (see chat) rather
      than assuming there's a real gap — every RPC function already has
      an explicit `revoke`/`grant` pair in its migration, so this most
      likely means one of those statements was never actually applied
      live, the same class of issue as `0016`/`0017`

## Sync Status screen (settings/sync-status.tsx)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with the new screen,
      the `sync_attempts`/`last_sync_error` local-DB columns, and
      `offline-sync.ts`'s failure-recording wired into every push path.
- [ ] On a physical device: capture a photo while offline, confirm it
      shows up under "Pending photos" with a 0 failure count, then bring
      the device back online and confirm it either disappears (synced)
      or shows a failure count + error message if the sync attempt fails
- [ ] "Sync now" while online actually triggers a sync pass and updates
      the counts/list afterward without needing to leave and reopen the
      screen
- [ ] "Sync now" while offline is disabled and shows "Can't sync while
      offline" rather than silently doing nothing
- [x] Discarding a pending photo removes it from the list immediately and
      the sync error clears — confirmed 2026-09-10 on-device: the 7
      photos stuck since before migration `0019` (leftover debris from
      the schema-cache/on-conflict debugging period, ultimately rejected
      by `photos_insert_own_org`'s RLS check — almost certainly because
      the inspection/item they pointed at was voided, deleted, or
      reassigned sometime during that debugging window) were discarded
      via this screen and the `42501` errors stopped appearing on the
      next sync pass. Not separately re-confirmed on this pass: that the
      on-disk encrypted file is actually deleted (not just the DB row)
      and that a discarded photo stays gone after a full app restart —
      both should still hold per `discardPendingPhoto()`'s implementation,
      worth a quick spot-check next time.
- [ ] A pending area/item shows its failure count and last error message
      after a sync attempt fails, and there is no discard control offered
      for either (by design — see CHANGELOG.md's entry for why)
- [ ] The summary counts at the top of this screen match the app-wide
      "Offline, N changes pending" strip and Inspections tab badge at the
      same moment

## Build version in Settings

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with `app.json`'s new
      `android.versionCode`/`ios.buildNumber` fields and the Settings
      screen reading them via `expo-constants`.
- [ ] On a physical device, confirm Settings shows "Version 1.0.0 (build
      1)" (or whatever `app.json` currently has) rather than "unknown"

## Records and lifecycle

- [ ] Archived properties retain their inspection history
- [ ] Completed inspections cannot be casually/permanently deleted by ordinary users

## Reports (Phase 7, migration 0021, inspections/[id]/report.tsx)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with `reports.ts`, the
      new report screen, and the `expo-print`/`expo-sharing`
      dependencies.
- [x] Local Postgres 16, real `authenticated` role, RLS enforced: an
      inspector cannot call `approve_report()` (`insufficient_permission`),
      an admin cannot approve a still-in-progress inspection
      (`inspection_not_completed`), a cross-org admin cannot approve or
      even see another org's completed inspection
      (`inspection_not_found`), a valid approval succeeds and records the
      row, a second approval attempt on the same inspection is rejected
      (`report_already_approved`), an inspector (read-only role) can
      still `select` the approved row, a cross-org member cannot, and the
      Storage bucket's own insert policy independently rejects both a
      non-admin upload and an admin uploading under a different org's
      folder path.
- [ ] On a physical device: submit an inspection, open its report screen
      as an inspector/viewer, and confirm it shows the "waiting for
      approval" message with no Preview/Approve buttons
- [ ] As an org_admin/portfolio_manager/supervisor, tap "Preview" and
      confirm the share sheet opens with a PDF that actually renders
      (cover header, scope summary, findings section with photos, full
      checklist appendix) — this is the first real-device exercise of
      `expo-print`, not yet confirmed to work outside local typecheck/lint
- [ ] Tap "Approve & finalize", confirm the inline confirm step, and
      confirm the screen updates to show "Report approved" with the
      correct approver name/date afterward
- [ ] A second visit to the same report screen (or a fresh app
      cold-start) shows the same approved state, not a re-offer to
      approve again
- [ ] "Open / share report" on an already-approved report successfully
      downloads and opens the share sheet with the correct PDF
- [ ] PDF reports match the stored inspection information exactly —
      spot-check a report against its inspection's actual locations/
      items/findings, especially that skipped/inaccessible areas show
      their required reason and that photos actually appear (photos are
      pulled by signed URL at render time, so this also implicitly
      checks that signed URLs resolve correctly on-device)
- [ ] A deficiency item's corrective-action status shown in the report
      matches its state as of the approval moment, and does not change
      retroactively if the corrective action's status changes afterward
- [ ] Confirm role-gated UI end-to-end on-device: an inspector/viewer
      never sees an Approve button anywhere in this flow, matching what
      `approve_report()` already enforces server-side

## Dashboard & Analytics (Phase 8, src/lib/dashboard.ts, app/(app)/index.tsx)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with `dashboard.ts` and
      the new Dashboard screen.
- [ ] On a physical device: the Dashboard tab loads with "All properties"
      selected by default and shows a property slot usage row, an
      Inspections section (scheduled/in progress/completed/postponed/
      overdue), an Open findings section (P1-P4, escalated, total open),
      and a Corrective actions section (open, overdue)
- [ ] Every count on the Dashboard matches what you'd get by manually
      counting the same thing on the Properties/Inspections/Corrective
      Actions tabs — spot-check at least one number from each section
      against its source screen
- [ ] Tapping the property slot usage row navigates to Properties;
      tapping any Inspections row navigates to Inspections; tapping any
      Open findings or Corrective actions row navigates to Corrective
      Actions
- [ ] Selecting a specific property in the filter row narrows the
      Inspections, Open findings, and Corrective actions sections to that
      property only (and hides the property slot usage row, since that
      metric is always portfolio-wide) — confirm against a property with
      at least one inspection, one open finding, and one open corrective
      action
- [ ] The property-filtered corrective-actions counts in particular are
      correct — this is the one query in the app that filters
      `corrective_actions` by joining out to `findings` for
      `property_id`, a new pattern not used elsewhere in this codebase,
      so it's worth extra scrutiny (e.g. temporarily void/complete a
      corrective action on the filtered property and confirm the "Open"
      count drops accordingly)
- [ ] A P1 finding, an escalated finding, an overdue inspection, and an
      overdue corrective action each visually stand out (highlighted
      text) from the rest of their section
- [ ] An organization with zero properties/inspections/findings/
      corrective actions shows all-zero counts rather than an error or a
      blank screen
- [ ] Pull-to-refresh on the Dashboard reloads all counts

## Phase 16: Dashboard Compliance Rollup (src/lib/dashboard.ts, app/(app)/index.tsx)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with the updated
      `dashboard.ts` and Dashboard screen.
- [ ] On a physical device: the Dashboard tab shows a new "Compliance"
      section below Corrective actions, with "Documents needing
      attention" and "Tasks needing attention" rows
- [ ] With "All properties" selected, the two counts match the sum of
      every property's own attention badges (Compliance documents /
      Compliance tasks rows on each property's detail screen) — spot
      check by adding across at least two properties
- [ ] Selecting a specific property in the filter narrows both counts to
      match that property's own attention badges exactly
- [ ] Tapping either row while a specific property is selected opens that
      property's "Compliance documents" or "Compliance tasks" screen
      directly (not a list of properties)
- [ ] Tapping either row while "All properties" is selected opens the
      Properties tab instead (there's no portfolio-wide compliance list
      screen to jump to)
- [ ] Either count is highlighted (matching the Overdue/Escalated/P1
      highlight treatment elsewhere on this screen) whenever it's greater
      than zero, and not highlighted at zero
- [ ] An organization with zero compliance documents and zero compliance
      tasks anywhere shows both counts as zero rather than an error
- [ ] Pull-to-refresh on the Dashboard reloads both compliance counts
      along with everything else

## Phase 17: Phase 10 security-roadmap follow-up (migration 0027, aal2 hardening + revoked-device check)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass with
      `device-registration.ts`, `offline-sync.ts`,
      `settings/sync-status.tsx`, and `(app)/_layout.tsx` updated.
- [x] Locally verified against a disposable Postgres 16 database
      replaying the full migration chain from scratch (`/tmp/pgtest6`
      convention, same as prior phases): a dedicated test script
      confirmed, at `aal1`, that each of the eight hardened access points
      is rejected with its specific new error
      (`aal2_required`/`critical_check_requires_admin`/
      `admin_required_past_scheduled` as appropriate) — organization
      settings update, the admin branch of profile editing, the org-wide
      branch of the devices view, `security_events` view,
      `revoke_device()`, `set_inspection_check_status()`'s and
      `set_property_check_assignment_status()`'s critical-deactivation
      branch, `set_inspection_status()`'s and `delete_inspection()`'s
      past-scheduled admin branch, and `delete_property()` — and that
      every one of them succeeds at `aal2`. Also confirmed the
      self-service branches (a user editing their own profile, viewing
      their own device) are completely unaffected by aal at either level.
      The full pre-existing Phase 10/14/15 device and compliance-document/
      compliance-task test suites were re-run against this same database
      with migration 0027 applied and show zero regressions.
- [ ] **Before any real-device test:** migration `0027` has been run in
      the Supabase SQL Editor against your live project (along with the
      still-pending migration `0026` from Phase 15, if you haven't run
      that one yet either).
- [ ] As an org_admin who has completed MFA sign-in this session (i.e.
      currently at aal2), confirm every admin-only action this migration
      touches still works normally: edit organization name, edit another
      user's profile, view every device in the org, view recent security
      events, revoke a device, deactivate a critical inspection check or
      critical property-check-assignment, void or delete a
      past-scheduled inspection, and delete a property.
- [ ] This one is hard to trigger honestly on a real device today (aal
      level comes from Supabase Auth's own session state, not something
      the app can easily force down without waiting out the actual
      session/token lifetime), so treat it as **best-effort**: if you can
      get a live org_admin session to sit at aal1 (e.g. immediately after
      a fresh password-only sign-in, before completing the MFA challenge,
      if your test flow allows reaching that state at all), confirm one
      of the actions above is rejected rather than silently succeeding.
      If this isn't practically reachable on-device, the local Postgres
      verification above is the authoritative check for this phase.
- [ ] Revoke your own test device as a second org_admin (or directly via
      SQL), then on the revoked device: confirm the next foreground poll
      (within ~45 seconds) shows the "Device revoked" alert and signs you
      out on "OK"
- [ ] Repeat the same revocation, but instead of waiting for the poll,
      trigger a sync attempt (e.g. "Sync now" on the Sync Status screen)
      — confirm it shows the "This device has been revoked…" message and
      signs out immediately, rather than attempting the sync
- [ ] Confirm signing back in on a genuinely different (non-revoked)
      device for the same account still works normally and is unaffected
      by the other device's revoked status

## Phase 18: field-derived checklist expansion (migration 0028)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass (no app code changed —
      this phase is a data-only migration like 0024's, so this is a
      re-confirmation that adding a `.sql` file alone doesn't break
      anything).
- [x] Locally, against a disposable Postgres 16 database replaying the
      full migration chain from scratch through `0028`: each of its
      `INSERT` statements returns the exactly-expected row count (4 area
      types / 23 component types / 25 component-level checks / 4 extra
      applicability links for the fire-extinguisher tag check / 11
      area-level checks); afterward `area_types` holds 24 rows,
      `component_types` holds 165, `inspection_check_library` holds 103,
      and `check_applicability_rules` holds 114 (all platform-standard,
      `organization_id is null`).
- [x] A dedicated smoke test actually called `generate_property_checklist()`
      (not just checked the library rows exist): created a test property
      with a Gas Meter Room, an Amenity Space (gym), a Sidewalk, and a
      Boiler Room location, confirmed one component in each, and
      generated the checklist — confirmed the new gas-meters
      component-level check, the new gas-meter-room area-level check,
      the new gym-equipment check, and the new sidewalk-elevator/vault
      check all appear correctly assigned; separately confirmed the new
      fire-extinguisher tag-currency check resolves at a second location
      (Boiler Room) it was only _linked_ to, not the location it was
      directly inserted against (Storage Room) — proving the Part 3
      cross-linking pattern actually works, not just that the SQL ran.
- [x] The Phase 17 aal2-hardening test suite (`200_aal2_hardening.sql`)
      was re-run against the same rebuilt database with zero
      regressions, confirming this purely-additive migration doesn't
      disturb anything access-control-related.
- [ ] After running `0028` against the real Supabase project: on an
      existing property, add a new location of one of the 4 new area
      types (Gas Meter Room, Telecom/IT Room, Amenity Space, Office),
      confirm its available components include the new ones, and confirm
      generating/refreshing the checklist picks up the new checks
      automatically
- [ ] Add one of the new component types under an _existing_ area type
      that gained one this phase (e.g. Fire Alarm Panel under an existing
      Lobby, Pull Station under an existing Hallway or Stairwell,
      Backflow Preventer/RPZ or Ejector Pit/Pump under an existing
      Basement) and confirm the matching new check appears without
      needing a brand-new location
- [ ] Confirm the fire-extinguisher tag-currency check and the standpipe
      tag-currency check behave identically to any other check in the
      walkthrough UI — status, `observation` comment, and camera photo
      all work with no special-casing
- [ ] Confirm the 11 new area-level checks (utility-room storage misuse,
      egress-corridor/stairwell obstruction, unsafe temporary wiring,
      photoluminescent stair markings, apartment door jamb markings) each
      show up exactly once per matching location, not duplicated and not
      missing
- [ ] Confirm nothing from the Building Equipment Inventory / Capital
      Improvement Project Estimates templates (age/condition/remaining-
      useful-life, multi-year $ budget rows) appears anywhere in the
      generated checklist — deliberately out of scope for this migration,
      scoped as a separate future feature instead

## Phase 19: fix area-level checklist duplication bug (migration 0029 + 2 live-data cleanup scripts)

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass (no app code changed —
      this is a pure SQL fix, like 0028's, so this is a re-confirmation
      that it doesn't break anything).
- [x] Reproduced the pre-existing bug locally, deterministically: a
      disposable Postgres 16 database replaying the full migration chain
      through `0028` (function unfixed), a Stairwell location with 3
      confirmed components (Treads, Railings, Pull Station) generated
      exactly **3** duplicate rows for each of the two Stairwell
      area-level checks, while every component-level check at that same
      location correctly generated exactly 1 row — isolating the bug
      precisely to the area-level matching branch, as diagnosed from the
      user's own pasted live-data query results.
- [x] Applied `0029` within that same continuous session (so the
      repro → fix → verify sequence couldn't get confused with itself —
      an earlier attempt that mixed sessions produced a misleading
      result and was deliberately redone from a fresh rebuild) and
      confirmed a brand-new Stairwell location with the same 3 confirmed
      components now generates every check — including both area-level
      ones — at exactly row_count 1.
- [x] Confirmed the fix does not retroactively repair already-corrupted
      data: re-running `generate_property_checklist()` on the
      already-duplicated Stairwell location left its pre-existing
      duplicates in place. Also confirmed a wrinkle worth knowing before
      running this live: that re-run isn't a true no-op either — it adds
      **one** additional, correctly-shaped (`location_component_id =
null`) row alongside the old duplicates (3 old → 4 total), because
      the old rows' non-null `location_component_id` is a different key
      under the partial unique index than the correct shape. It then
      stabilizes there.
- [x] Re-ran the Phase 17 aal2-hardening suite (`200_aal2_hardening.sql`)
      and the Phase 18 field-expansion smoke test
      (`201_field_expansion_smoketest.sql`) against the same rebuilt,
      `0029`-applied database with zero regressions.
- [x] Both one-time live-data cleanup scripts
      (`scratch_duplicate_snapshot_item_cleanup.sql` for duplicate line
      items inside a still-open inspection, and
      `scratch_duplicate_assignment_cleanup.sql` for the underlying
      `property_check_assignments` template) were verified locally
      against 7 constructed scenarios, run in the recommended order
      (item-level cleanup first, then assignment-level): - Plain duplicates with no inspection yet → automatically
      collapsed to 1 correctly-shaped row. - A location already re-generated once post-fix (2 old-shaped rows + 1 new correctly-shaped row coexisting) → automatically
      collapsed to the 1 correct row. - A location whose only pre-existing inspection had snapshotted
      just one of the eventual duplicates (the other 2 were added to
      the template afterward, so never got snapshotted) → the
      snapshotted row kept and corrected in place, the 2 unsnapshotted
      ones deleted. - Two separate inspections each independently referencing a
      different one of 2 duplicate rows → left completely untouched,
      reported as needing manual review (a genuine, irreducible
      conflict). - All 3 duplicates frozen into one single inspection at once (the
      realistic, common case — matches the user's actual reported
      symptom) → duplicate line items collapsed to 1 by the item-level
      script first (none had recorded data yet), which then freed the
      assignment-level script to also collapse its own group on a
      second pass. - Two items in one inspection both already carrying real recorded
      data (different observations an inspector had already entered on
      each, not realizing they were duplicates) → left completely
      untouched by the item-level script, reported as needing manual
      review. - One item with a photo attached, its duplicate sibling with
      nothing recorded → the photo'd item kept (and its photo
      confirmed intact afterward, not cascaded away), the empty
      duplicate deleted. - Both cleanup scripts confirmed idempotent (a second run finds
      nothing left to do, reports 0 newly-cleaned groups, and leaves
      the still-flagged conflict groups exactly as they were).
- [x] Ran `0029` against the real Supabase project (`0026`/`0027`/`0028`
      were already applied first), then both cleanup scripts in their
      documented order. Confirmed via `scratch_verify_no_duplicates.sql`:
      no area-level check is duplicated anywhere, in either the live
      checklist template or any still-open inspection's line items.
- [x] Neither cleanup script reported any group needing manual review on
      this run — nothing left to reconcile by hand.
- [x] Added a new Stairwell area to an existing property (auto-confirming
      all 3 standard components — Treads, Railings, Pull Station — at
      once, the same condition that used to trigger the bug), started a
      Common Area inspection over it, and confirmed both Stairwell
      area-level checks (photoluminescent egress markings, stairwell
      clear of debris) appear exactly once in the walkthrough, not
      duplicated. Test inspection deleted afterward via
      `delete_inspection()` — confirmed working. Also re-confirmed the
      Phase 20 report mailing flow while in there — still works.

Phase 19 is fully closed out: fix live, both cleanup scripts run with
nothing left needing manual review, and the live regression test
confirms new checklist generation no longer duplicates area-level
checks.

## Phase 20: report-screen entry-button relabel

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass.
- [x] Inspections → an already-`completed` inspection: the walkthrough
      screen's footer button now reads "View report" instead of "Review &
      submit," and tapping it still correctly reaches the review screen's
      "View report →" link and then the Report screen. An
      in-progress inspection's footer button still reads "Review &
      submit," unchanged.
- [x] Report screen: "Email / share report" on an approved report opens
      the native share sheet with the PDF, including Mail/Gmail as a
      destination — device-tested, confirmed working.

## Phase 21: weekly compliance-task due-soon boundary fix

Found by an external, independent verification pass (a separate AI tool
run against a sibling snapshot of this project — see Phase 23's own
section below for the full context on that pass and what else it
found) and confirmed directly against this project's actual source; see
CHANGELOG.md's Phase 21 entry for the full root-cause writeup.

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass.
- [x] Verified locally with a standalone Node test harness running the
      real, unmodified `computeTaskDueStatus()`: a weekly task completed
      just now now reads `ok` (was `due_soon` — the bug); at 4/5/6/8
      days after completion it reads `ok`/`due_soon`/`due_soon`/
      `overdue`, confirming the new 2-day due-soon window's edges;
      monthly/quarterly/annual completed just now are unaffected,
      still `ok`. 10/10 cases passed.
- [ ] On-device: a Log review / Vendor report review compliance task
      set to Weekly frequency, marked reviewed today, shows "OK" on the
      property's Compliance tasks screen — not "Due soon." Re-check the same
      task 5-6 days later (or with the device clock adjusted) and
      confirm it does show "Due soon" before its actual due date.

## Phase 22: silent device-registration failure fix

Also found by the same external verification pass, and confirmed
directly against this project's actual source; see CHANGELOG.md's
Phase 22 entry for the full root-cause writeup.

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass.
- [x] Verified locally with a standalone Node test harness running the
      real, unmodified `registerThisDevice()`, with the mocked
      `supabase.functions.invoke()` response scripted per case: all 4
      malformed-response
      shapes the verification pass's own harness had flagged (`null`,
      `{}`, an unrelated object, `{ device: {} }`) now correctly surface
      as an error and persist no device id (previously: silently
      reported success with nothing persisted); a genuine valid
      response, an explicit server rejection, and a transport error all
      still behave exactly as before. 7/7 cases passed.
- [ ] On-device: this isn't reproducible from the real app without a
      deliberately misconfigured Edge Function response, so there's
      nothing new to manually exercise here beyond confirming a normal
      sign-in still registers the device without error (should already
      be covered by existing sign-in test coverage above) — flagging
      this as a documentation/no-action item rather than leaving an
      unchecked box with nothing to actually do.

## Phase 23: offline cross-organization tenant-isolation fix

Also found by the same external verification pass; see CHANGELOG.md's
Phase 23 entry for the full root-cause writeup, including why this was
two independent bugs (a missing query filter, and `signOut()` never
clearing the local mirror) rather than one.

- [x] `npx tsc --noEmit`, lint, `format:check`, and
      `expo export --platform android` all pass.
- [x] Verified locally with a standalone Node test harness (Node's
      built-in `node:sqlite` standing in for the native `expo-sqlite`
      driver) running the real, unmodified `offline-db.ts` query
      functions: an org-A-scoped offline list contains only org A's
      mirrored inspection; an org-B-scoped list excludes org A's
      (previously: both were returned regardless of which was asked
      for); an organization with nothing mirrored gets an empty list,
      not everything; the sync engine's own unscoped sweep still sees
      every organization's rows (so draining sync isn't affected); and
      `resetLocalMirror()` now actually drops and empties
      `local_inspection_headers` (previously: that table was never
      dropped at all, so a "reset" left every header behind
      indefinitely). 6/6 cases passed.
- [ ] On-device, the actual leak scenario: sign in as an org A user,
      open/start an inspection so it mirrors locally, sign out (with no
      unsynced changes — should sign out immediately, no prompt), sign
      in as a different org's user on the _same device_, go offline (or
      force the offline-fallback path), open Inspections. Confirm the
      list is empty (or shows only this org's own mirrored data), never
      org A's inspection.
- [ ] On-device: with at least one unsynced offline change pending
      (e.g. an offline-captured photo not yet uploaded), tap "Sign out"
      from Settings. Confirm an alert appears naming how many changes
      are unsynced, with "Cancel" (stays signed in, nothing lost) and
      "Sign out anyway" (actually signs out and discards the local
      mirror). Confirm "Cancel" truly does nothing — the pending change
      is still there afterward.
- [ ] On-device: with zero unsynced changes, tap "Sign out" from
      Settings. Confirm it signs out immediately with no alert, same as
      before this phase.
- [ ] On-device: confirm the device-revoked auto sign-out
      ((app)/_layout.tsx's periodic check) and the "Sign out instead"
      buttons on the MFA challenge/setup screens still sign out
      immediately with no unsynced-changes prompt, even if there
      happens to be pending offline data — these are meant to bypass
      the prompt (`{ force: true }`), not surface it.

## Platform

- [ ] Android permission denial (camera/storage) does not crash the app
- [ ] Application works correctly on a small phone and on a tablet
