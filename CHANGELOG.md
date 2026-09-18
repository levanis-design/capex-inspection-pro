# Changelog

All notable changes to this project are documented here. Loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Initial repository structure: `README.md`, `.gitignore`, `.env.example`,
  `PRODUCT_SPEC.md`, `DATABASE_SCHEMA.md`, `TEST_PLAN.md`, `CHANGELOG.md`.
- GitHub repository created: `capex-inspection-pro`.
- Supabase project created (authentication, database, storage) — connection
  details to be wired into the app in Phase 2.

- Drafted full `PRODUCT_SPEC.md` v0.1 (MVP scope, roles/permissions,
  user journeys, screens, checklist model, offline strategy, priority and
  responsibility models, reports, dashboard, retention/audit).
- Drafted full `DATABASE_SCHEMA.md` v0.1 (entity list, ER diagram, RLS
  policy pattern) as the companion technical design.

- Revised `PRODUCT_SPEC.md` to v0.2: made Free-plan entitlement
  (1 user/org/property/device), server-side device registration
  (HMAC fingerprinting + Play Integrity), controlled device replacement,
  and a location-driven area/component/inspection-check checklist
  hierarchy part of the MVP rather than deferred/flat.
- Revised `DATABASE_SCHEMA.md` to v0.2: added `devices`, `security_events`,
  entitlement columns on `organizations`, the transactional
  `create_property()` / device-registration Edge Function design, and the
  full area_types / component_types / property_locations /
  location_components / inspection_check_library /
  check_applicability_rules / property_check_assignments /
  property_template_versions / inspection_snapshots /
  inspection_snapshot_locations / inspection_snapshot_items structure.
- Expanded `TEST_PLAN.md` with entitlement-concurrency tests, device
  registration/security tests, and location-driven checklist-generation
  tests.

- Scaffolded the Expo + TypeScript + Expo Router project (SDK 57),
  stripped to a clean starter (demo/decorative template code and unused
  iOS-only packages removed).
- Added the design system (`src/theme`): colors, spacing, typography per
  `PRODUCT_SPEC.md`'s UX requirements (high contrast, large touch targets,
  never color-alone for status).
- Added environment configuration (`src/lib/env.ts`) with fail-fast
  validation of required Supabase variables.
- Added the Supabase client (`src/lib/supabase.ts`) using a custom
  Keystore/Keychain-backed secure storage adapter
  (`src/lib/secure-storage.ts`) for the auth session, instead of
  plain-file storage, with automatic chunking for values over the
  platform's per-item size limit.
- Added the authentication shell: `src/lib/auth-context.tsx`
  (session state, sign-in/sign-up/sign-out), sign-in and sign-up screens,
  and route protection between a `(auth)` group and an `(app)` group using
  Expo Router's `Stack.Protected`.
- Added a global error boundary (`src/components/error-boundary.tsx`) and
  a structured logger (`src/lib/logger.ts`) with a `redact()` helper to
  keep secrets out of logs.
- Added placeholder screens for Dashboard, Properties, and Inspections
  (each names the phase that replaces it) and a functional Settings
  screen (shows the signed-in user, sign-out).
- Configured ESLint (flat config, `eslint-config-expo` + Prettier
  compatibility) and Prettier; both pass clean, and `tsc --noEmit` passes
  clean under strict TypeScript.
- Verified the whole module graph builds via `expo export --platform
android` (1368 modules bundled successfully) as a build smoke test.
- Removed the Expo starter template's own `LICENSE` (MIT, Expo copyright)
  as inappropriate for this private, proprietary application.

- Verified on a physical Android device via Expo Go over LAN: sign-up,
  email/session handling, protected routing into the tab navigator,
  Dashboard/Properties/Inspections placeholders, Settings showing the
  signed-in user, and sign-out back to the sign-in screen — all working
  end to end.
- Added Phase 3 database migrations (`supabase/migrations/0001`-`0006`):
  `organizations`, `profiles`, the sign-up trigger, `properties` with the
  transactional `create_property()` entitlement function, the
  `buildings`/`area_types`/`component_types`/`property_locations`/
  `systems_assets`/`location_components` hierarchy, the seeded standard
  area/component library, and RLS on every table. Applied manually via
  the Supabase SQL Editor rather than the Supabase CLI (decision recorded
  2026-09-06, to avoid adding a Docker/CLI dependency on top of the
  environment issues already worked through in Phase 2).
- `devices` / `security_events` (device registration, Play Integrity)
  deliberately deferred to their own phase, before Phase 10 — see
  `DATABASE_SCHEMA.md` Migration History.
- Database migrations `0001`-`0005` (plus optional `0006`) confirmed applied
  successfully in the Supabase dashboard, Row Level Security confirmed
  enabled on every new table, and the seeded library confirmed present.
- Replaced the Properties placeholder with a real Properties tab: a list
  screen (`src/app/(app)/properties/index.tsx`) reading the `properties`
  table (RLS-scoped to the caller's org), and a "New Property" form
  (`src/app/(app)/properties/new.tsx`) wired to the `create_property()`
  RPC, with friendly messages for the Free-plan limit, missing name, and
  permission errors instead of raw Postgres error text. The Properties tab
  is now its own nested stack (list → new-property form) instead of a
  single flat screen.
- Added `src/lib/use-current-organization.ts`, a small hook reading the
  signed-in user's role and organization (name, plan tier, property slot
  limit) via the `profiles` → `organizations` relationship. Wired it into
  both the Properties list (usage/limit display) and the Settings screen
  (organization name and plan tier, replacing the earlier "arrives in a
  later phase" placeholder text for that specific piece).
- Verified end-to-end on a physical Android device: a brand-new sign-up
  automatically receives an organization and `org_admin` profile via the
  `handle_new_user()` trigger (0002) with no manual database steps, and
  "Add property" successfully creates a row via `create_property()` and
  it appears in the list. (One earlier sign-up during testing didn't get
  a profile; a clean repeat sign-up confirmed the trigger itself works —
  that first instance is treated as a one-off, not a recurring bug.)
- Tightened the `create_property()` error-message mapping in
  `src/app/(app)/properties/new.tsx`: `not_authenticated` no longer says
  "your session expired" (misleading — that error also fires when the
  account has no organization/profile row, which is not a session
  problem) in favor of message accurate to both causes.

- **Phase 4, database layer (checklist library, applicability rules, and
  the checklist generator):** added `supabase/migrations/0007`-`0009`.
  - `0007_checklist_library_and_audit.sql`: `audit_log` (+
    `log_audit_event()`, the only way anything writes to it),
    `inspection_check_library`, `check_applicability_rules`,
    `property_check_assignments`, `property_template_versions`, all with
    RLS. The checklist tables deny direct client insert/update entirely —
    the only write path is the generator function in `0009`, same pattern
    as `create_property()`.
  - `0008_seed_inspection_check_library.sql`: a representative starter
    library — one meaningful check per standard area type, with
    life-safety items (fire extinguishers, emergency lighting,
    self-closing stairwell doors, smoke/CO detectors, elevator equipment,
    boiler safety controls, dryer vent lint buildup, etc.) marked
    `critical` — plus the applicability rules linking each check to its
    component type. Deliberately not exhaustive; per PRODUCT_SPEC.md
    section 7 this is meant to grow as a data change, not an app release.
  - `0009_checklist_generation_and_governance.sql`:
    `generate_property_checklist(property_id)`, which evaluates
    applicability rules against a property's confirmed
    locations/components and populates `property_check_assignments`
    (duplicate-proof via a partial unique index, idempotent across
    repeated calls, and freezes a `property_template_versions` snapshot
    only when something actually changed); `set_inspection_check_status()`,
    the critical-check governance function (any non-`active` transition
    requires a reason; a `critical` check additionally requires an
    org-admin; every change is audit-logged). That governance function is
    scoped to only ever touch an organization's own custom checks, never
    the shared platform-standard library — so no tenant's admin can
    deactivate a check for every other tenant (there's no "add a custom
    check" UI yet, so nothing calls it successfully today; the safeguard
    is there before that feature ships, not after).
  - Verified end-to-end against a local Postgres 16 instance before
    delivery (not just eyeballed): applied all 9 migrations in sequence
    against a stubbed `auth` schema, then ran a full scenario — sign-up
    trigger → property creation → entitlement rejection on a second
    property → building + two locations (Roof, Boiler Room) → confirming
    3 of 4 available components → `generate_property_checklist()`
    correctly created exactly the 3 expected checks (and correctly did
    _not_ generate a check for the unconfirmed Boiler Room "Controls"
    component) → a repeat call correctly created 0 new rows and did not
    duplicate the template version → confirming the 4th component and
    regenerating correctly added exactly 1 new row and froze version 2 →
    `set_inspection_check_status()` correctly refused to touch a
    platform-standard check → the audit log correctly recorded all three
    generation attempts.

- **Phase 4, guided setup wizard UI:** added `supabase/migrations/0010`
  (a unique index on `location_components(property_location_id,
component_type_id)`, so the wizard can `upsert` a component's confirmed
  state in one round trip). Properties list rows are now tappable, opening
  a new property detail screen (`properties/[id]/index.tsx` — name/address,
  a count of areas set up and active checks, and a button into setup) and
  the wizard itself (`properties/[id]/setup.tsx`): add an area (pick a
  standard area type, name the instance — a property can have more than
  one of the same type, e.g. two stairwells), tap into it to confirm which
  components are actually present (`src/components/manage-components-modal.tsx`,
  every component starts unchecked per PRODUCT_SPEC.md section 7's "never
  auto-activates without confirmation"), then "Generate checklist" calls
  `generate_property_checklist()` and shows how many checks were added.
  Reopening setup and generating again only ever adds what's new.
  - **Scope note:** buildings aren't part of the wizard UI yet — every
    area is added directly to the property (`building_id` stays null,
    which the schema already supports for property-wide areas like a
    yard or parking lot). This doesn't limit checklist generation, which
    is location/component-driven, not building-driven; multi-building
    management is a natural follow-up once a real multi-building property
    is being set up.
  - Verified: `npm run lint`, `npm run format:check`, and `npx tsc --noEmit`
    all pass clean on every new/changed file.

- **Phase 5A, inspection scheduling and scope-resolution database layer:**
  added `supabase/migrations/0011`-`0012`.
  - `0011_inspections.sql`: `inspections` (the scheduling/header record —
    type, assigned inspector, status, resolved `scope_selection`), and
    the immutable `inspection_snapshots` / `inspection_snapshot_locations`
    / `inspection_snapshot_items` that freeze a copy of a property's
    checklist the moment an inspection starts. All four deny direct
    client insert — same "SECURITY DEFINER function is the only write
    path" pattern as `create_property()` and
    `generate_property_checklist()`.
  - `0012_start_inspection.sql`: `start_inspection()`, which validates the
    caller's role and the property's org, resolves scope per
    PRODUCT_SPEC.md section 8's inspection-type table
    (`comprehensive` = every active location; `roof` = locations typed
    Roof; `mechanical` = Boiler Room/Mechanical Room; `common_area` =
    Entrance/Lobby/Hallway/Stairwell; `fire_life_safety` = any location
    with at least one active `critical` check, filtered to just those
    critical checks; `apartment_unit`/`custom` = caller-supplied location
    IDs, required), then freezes the snapshot. Deliberately rejects
    `preventive_maintenance`, `follow_up`, `seasonal`,
    `exterior_grounds`, `move_in`, `move_out`, and `capital_planning`
    with `inspection_type_not_yet_supported` rather than guessing at a
    scope rule the spec doesn't pin down yet (or, for the first two,
    that this schema doesn't have the underlying data for).
  - **Caught and fixed before delivery:** `0011`'s `inspection_type`
    check constraint was missing `'roof'` — a real inspection type per
    PRODUCT_SPEC.md section 8's table — which would have made every
    `start_inspection(..., 'roof')` call fail its own table's
    constraint. Found while writing `0012`, fixed in `0011` before either
    file was ever applied anywhere.
  - Verified end-to-end against a local Postgres 16 instance before
    delivery: applied all 12 migrations in sequence, then a property with
    four locations (Roof, Boiler Room, Hallway, Entrance) exercising
    every supported scope branch — `comprehensive` correctly resolved all
    4 locations/6 items; `roof`, `mechanical`, and `common_area` each
    correctly resolved their expected subset; `fire_life_safety`
    correctly resolved 3 of the 4 locations (excluding Entrance, whose
    only confirmed check isn't critical) and exactly the critical items
    at each; `apartment_unit` correctly required an explicit location
    selection and then correctly used it; `seasonal`, `follow_up`, and a
    bogus type all correctly raised their named errors. Confirmed
    immutability directly: after an inspection was started, confirming a
    new component and regenerating the property's checklist left that
    inspection's existing snapshot item count unchanged, while a second,
    newly-started `comprehensive` inspection correctly picked up the new
    item. Separately re-ran the read/write checks as the `authenticated`
    role with RLS actually enforced (not bypassed by a superuser, unlike
    the rest of this scenario) to confirm selects are correctly
    organization-scoped and a direct client insert on any of the four new
    tables is rejected.

- **Phase 5B, basic online-only inspection walkthrough UI:** replaced the
  Inspections placeholder with a real tab — its own nested stack (list →
  start-inspection picker → walkthrough → final review), mirroring the
  Properties tab's structure.
  - `src/lib/inspection-types.ts`: the single source of truth for which
    inspection types the app offers (kept in lockstep with what
    `start_inspection()` actually supports) plus shared status labels, so
    the picker, list, walkthrough, and review screens can't drift out of
    sync with each other or with the database.
  - `src/app/(app)/inspections/index.tsx`: list of the org's inspections
    (property, type, status — status is always paired with a text label,
    never color alone, per PRODUCT_SPEC.md's UX requirements) and the
    entry point into starting a new one.
  - `src/app/(app)/inspections/new.tsx`: pick a property, pick a
    supported inspection type, and — for `apartment_unit`/`custom` — pick
    the specific area(s), then call `start_inspection()`, with friendly
    messages for every error it can raise.
  - `src/app/(app)/inspections/[id]/index.tsx`: the walkthrough itself.
    Per PRODUCT_SPEC.md section 8, shows one area's checklist at a time
    (Prev/Next moves between snapshot locations in their frozen route
    order) rather than the whole property at once. Each item gets a
    Satisfactory/Deficiency/N/A status (an observation field appears,
    required for a deficiency); a location can be marked complete, or
    skipped/inaccessible/not-applicable through a modal that requires a
    reason (enforced at the database level by 0011's check constraint).
    Opening the walkthrough promotes a `scheduled` inspection to
    `in_progress`; recording an item promotes its area from `pending` to
    `in_progress`. Nothing here hard-blocks moving between areas —
    that's deliberately the review screen's job, not this one's.
  - `src/app/(app)/inspections/[id]/review.tsx`: the final-review gate
    from PRODUCT_SPEC.md section 8 — surfaces every area that isn't
    `complete` (with its reason, if it has one) and every recorded
    deficiency with its observation, before submission. A fully-recorded
    inspection gets a single "Submit inspection" button; an incomplete
    one gets a warning list and a distinctly-labeled "Submit anyway"
    instead — surfaced, not blocked, since PRODUCT_SPEC.md only requires
    the former. Submitting sets the inspection to `completed`.
  - All four screens write directly to `inspections` /
    `inspection_snapshot_locations` / `inspection_snapshot_items` through
    their existing RLS `update` policies (see 0011) — no new database
    function was needed for 5B, since none of these transitions are
    entitlement-limited or touch the immutable snapshot-generation step
    that `start_inspection()` alone owns.
  - Verified: `npm run lint`, `npm run format:check`, `npx tsc --noEmit`,
    and `expo export --platform android` (module graph still bundles
    clean, 1381 modules) all pass. Not yet exercised on a physical
    device — that's next.

- **Phase 5B-ext, checklist management + mandatory photo capture:**
  requested after you tried the walkthrough — you wanted a way to
  view/edit/deactivate individual checklist items from "Set up areas",
  and to require a photo before marking an item's condition.
  - `supabase/migrations/0013_property_check_assignment_management.sql`:
    `set_property_check_assignment_status()` — the only way to change a
    `property_check_assignment`'s status (Active/Inactive/Not
    applicable/Superseded) or its priority/department override.
    Deactivating requires a reason; a critical check additionally
    requires an org_admin (same governance shape as
    `set_inspection_check_status()`). Also fixes a real gap in
    `generate_property_checklist()`: previously, deactivating an
    assignment and then regenerating the checklist could silently
    recreate it, because the idempotency check only looked at active
    rows. Now any existing row (regardless of status) blocks a fresh
    insert for the same combo, so a manual deactivation actually sticks.
  - `src/app/(app)/properties/[id]/checklist.tsx` (new screen, opened
    from the property detail's "Active checks" stat card, which is now
    tappable): every checklist item for the property, grouped and
    listed with its status/priority/department, tap to edit via
    `src/components/edit-check-assignment-modal.tsx`. "Delete" here
    means deactivating with a reason, not a hard row delete — consistent
    with this project's existing status-column convention (see
    `DATABASE_SCHEMA.md` conventions) and with the critical-check
    protection that's already in place for the check library itself.
  - `supabase/migrations/0014_inspection_photos.sql`: a `photos` table
    and a private `inspection-photos` Storage bucket (RLS-scoped by an
    `{organization_id}/...` path prefix, the Storage equivalent of every
    table's RLS). Added `expo-image-picker` (camera capture) and
    `src/lib/inspection-photos.ts` (capture → upload → record, and
    batch-fetch signed URLs for display — the bucket is private, so
    there's no public URL). The walkthrough
    (`src/app/(app)/inspections/[id]/index.tsx`) now shows a thumbnail
    row and "+ Photo" button per item, and — using the `photo_required`
    flag already seeded per check back in `0008` (not every check needs
    one — e.g. Roof Drains does, Entrance Doors doesn't) — disables the
    Satisfactory/Deficiency buttons until a required photo is attached.
    This is the online-only "capture and upload" slice of what was
    scoped as Phase 5C; offline queuing, local caching, and
    encryption-at-rest for a photo taken with no signal are still
    Phase 5C proper, not included here.
  - Verified: `0013` and `0014` both applied and functionally tested
    against a local Postgres 16 instance (0014 against a lightweight
    stand-in for the `storage` schema, since this harness can't fully
    replicate real Supabase Storage — see `DATABASE_SCHEMA.md` for what
    that does and doesn't prove). `npm run lint`, `npm run format:check`,
    `npx tsc --noEmit`, and `expo export --platform android` (1400
    modules) all pass, and `npx expo config` confirms the new
    `expo-image-picker` config plugin resolves cleanly. Not yet tried on
    a physical device.

- Added the ability to edit or delete an inspection itself (Phase
  5B-ext2), distinct from editing/deactivating a checklist item within
  one (already covered by Phase 5B-ext above).
  - `supabase/migrations/0015_inspection_lifecycle_management.sql`: adds
    `inspections.status_reason`; tightens the direct-update RLS policy so
    a client can never set `status = 'voided'` on its own; adds
    `set_inspection_status(id, 'voided', reason)` (void — keeps the
    record, with a reason) and `delete_inspection(id, reason)` (true hard
    delete, cascades away the snapshot/locations/items). Both require a
    non-blank reason, and both use the same governance gate: while an
    inspection is still `scheduled`, the assigned inspector or an
    admin/portfolio_manager/supervisor may act on it; once it's
    `in_progress`, `completed`, or `postponed`, only an `org_admin` may.
    Deliberately did **not** allow editing `inspection_type`/property/
    location scope anywhere — those are frozen into the snapshot the
    moment `start_inspection()` runs.
  - `src/app/(app)/inspections/[id]/manage.tsx` (new screen, reached via
    a `⋮` button added to each inspections-list row): reschedule/reassign
    (still a plain direct update, RLS-gated exactly as before), plus a
    "Danger zone" with Void and Delete, each behind
    `src/components/inspection-lifecycle-modal.tsx` — a shared
    reason-required confirmation modal that surfaces whichever
    governance error the database raises (e.g. "only an organization
    admin can void or delete it now" once the inspection is past
    scheduled).
  - Verified: `0015` functionally tested end-to-end against a local
    Postgres 16 instance across the full governance matrix (uninvolved
    inspector rejected, assigned inspector allowed while scheduled,
    blank reason rejected, non-admin rejected once completed, org_admin
    allowed, direct client update to `voided` confirmed blocked by RLS
    when tested as the actual `authenticated` role, hard delete cascading
    correctly, foreign-org id rejected identically to nonexistent,
    unsupported status value rejected). `npm run lint`,
    `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` all pass. Applied successfully to
    the live Supabase project. Not yet tried on a physical device.
  - Follow-up after the initial ship: the `⋮` on each inspections-list
    row wasn't a discoverable enough entry point on its own, so the
    walkthrough screen (`[id]/index.tsx`) now also gets a header-right
    `⋮` button (via `Stack.Screen options={{ headerRight }}`, the first
    use of that pattern in this app) that opens the same manage screen —
    visible the moment you open an inspection, not just from the list.

- **Phase 5C, started: offline capture/local SQLite mirror.** Flagged
  release-blocking per PRODUCT_SPEC.md section 9. Architecture decided
  and documented (PRODUCT_SPEC.md's Open Decisions Log, 2026-09-07):
  `expo-sqlite` for the local mirror, application-layer encryption via
  `tweetnacl` secretbox rather than a SQLCipher-style fully-encrypted
  database file (would require ejecting from Expo Go — see the decision
  log for the full reasoning).
  - Added dependencies: `expo-sqlite`, `expo-file-system`, `expo-crypto`,
    `expo-network`, `tweetnacl` — all either official `expo-*` modules or
    pure-JS with zero native code, so everything still runs in Expo Go,
    no custom dev client needed.
  - `src/lib/local-crypto.ts` (new): key generation/storage via
    `expo-secure-store`, `encryptText`/`decryptText` for free-text fields
    (observations, status reasons, photo captions), and
    `encryptBytesForStorage`/`decryptBytesFromStorage` for photo bytes.
    Self-contained base64/UTF-8 codecs rather than relying on `btoa`/
    `TextEncoder` globals (not polyfilled anywhere in the installed
    `react-native` package, and not confirmable as a Hermes built-in
    without a device). Verified with a standalone Node script: base64 and
    UTF-8 round-trips (ascii, accented, CJK, emoji), a full encrypt/
    decrypt round trip, tamper detection, wrong-key rejection, and a
    5000-byte binary payload round trip.
  - `src/lib/offline-db.ts` (new): the local schema (`local_locations`,
    `local_items`, `local_photos`, `sync_queue`) and typed read/write
    helpers, `INSERT OR IGNORE` on every seed so a location/item already
    edited offline is never clobbered by a re-fetch. Verified by replaying
    the schema and every query against Node's built-in `node:sqlite`
    (same SQLite dialect) — INSERT OR IGNORE semantics, dynamic
    partial-field updates, the dirty-flag join query, and cross-inspection
    isolation all confirmed.
  - `src/lib/connectivity.ts` (new): `useConnectivity()` hook and
    `isCurrentlyOnline()`, wrapping `expo-network` (an official module,
    chosen over the community `@react-native-community/netinfo` package
    specifically for guaranteed Expo Go compatibility).
  - `[id]/index.tsx`: every successful online fetch now also mirrors the
    snapshot into the local DB (fire-and-forget, never blocks or fails the
    online screen) — the "warm the cache while online" half of this
    phase. `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` (bundle size grew from 3.9MB to
    4.1MB, confirming the new native-module dependencies actually resolve
    through Metro, not just typecheck) all pass.
  - **Reading and writing checklist items through the local mirror**
    (`[id]/index.tsx`): `load()` is now network-first with a local-mirror
    fallback — it only reads from `offline-db.ts` (via the new
    `loadWalkthroughFromLocalMirror()`) when genuinely offline or when an
    online fetch still fails, so the existing online behavior (freshest
    data, live photos) is completely unchanged whenever there's a
    connection. A new `isOfflineMirror` banner tells the inspector when
    they're looking at a locally-saved copy. The four write handlers
    (`handleItemStatus`, `handleSaveObservation`, `handleMarkComplete`,
    `handleConfirmMark`) are now **local-write-first, network-best-effort**:
    every write goes to the local SQLite mirror unconditionally (this
    always succeeds and is now what "did this action happen" means), and
    only attempts the Supabase write when currently online — marking the
    row synced on success, or simply leaving it dirty (queued) on failure
    or while offline. The UI is no longer reverted on a network failure,
    since the local write already succeeded. `npm run lint`,
    `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` (1455 modules bundled) all pass.
  - **Offline photo capture with encrypted local storage**
    (`src/lib/offline-photos.ts`, new): `capturePhotoOffline()` replaces
    the old online-only `captureAndUploadPhoto()` (removed). The camera
    capture itself never touches the network — the photo bytes are
    encrypted with `local-crypto.ts`'s `encryptBytesForStorage()` (the
    same tweetnacl secretbox scheme used for free-text fields) and
    written to a persistent file under `Paths.document` via
    `expo-file-system`'s SDK 57 `File`/`Directory` API, then indexed in
    the local mirror's new `local_photos` CRUD (`insertLocalPhoto`,
    `getPhotosForItem`, `markPhotoUploaded`, `getPendingPhotosForInspection`
    in `offline-db.ts`) — that local write always succeeds and is what
    "the photo was taken" means now. Only if currently online is the real
    Supabase Storage upload + `photos` insert also attempted right away
    (best-effort, same pattern as the other write handlers); offline or a
    failed upload just leaves the row `uploaded = 0` for the sync engine
    to drain later, never surfaced as a capture error.
    `resolveLocalPhotoDisplayUri()` decrypts a local photo into a
    throwaway `Paths.cache` file on demand so `<Image>` can show it
    without ever holding decrypted bytes on disk longer than needed.
    `[id]/index.tsx` now merges these locally-captured, not-yet-uploaded
    photos into whatever a network fetch/local-mirror load already knows,
    both right after a capture and on every load (online or offline), so
    a photo taken with no signal shows up immediately and stops being a
    separate entry once it's actually synced. `npm run lint`,
    `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` (bundle grew 4.1MB → 4.2MB) all pass.
  - **Sync engine** (`src/lib/offline-sync.ts`, new;
    `supabase/migrations/0016_offline_sync.sql`, new): drains everything
    the local mirror has queued for one inspection -- dirty locations,
    dirty items, pending photos -- once the device is back online.
    Migration 0016 adds what this needed that didn't exist yet:
    `inspection_snapshot_locations.updated_at` (it never had one, unlike
    `inspection_snapshot_items`), a `set_updated_at()` trigger on both
    tables so `updated_at` is bumped by the database itself on every
    update rather than trusted from the client (this also fixes
    `inspection_snapshot_items.updated_at`, which existed since 0011 but
    was never actually bumped by anything), and `photos.client_uuid`
    (unique-when-set, mirroring `inspection_snapshot_items`' existing
    one) for idempotent photo uploads. Verified against a local
    Postgres 16 instance: the trigger overrides a client-supplied
    `updated_at` on every update, and a duplicate `client_uuid` insert is
    correctly rejected while multiple pre-migration `NULL` values remain
    allowed. **Idempotency:** location/item pushes are plain
    `UPDATE ... WHERE id = ...` (naturally idempotent); photo uploads go
    through `.upsert(..., { onConflict: 'client_uuid', ignoreDuplicates:
true })` keyed on a UUID (`expo-crypto`'s `Crypto.randomUUID()`,
    verified as a genuine native export from the installed package's own
    type declarations) generated once at capture time
    (`offline-photos.ts`), so a retried sync can never create a duplicate
    row. **Conflict detection:** before pushing a dirty location/item, the
    engine re-reads the server's current `updated_at` and compares it
    against `server_updated_at` (now actually read back from the local
    mirror -- it was written on every sync but never read back until now,
    a gap fixed as part of this). A newer server `updated_at` than what we
    last saw means the row was edited elsewhere while we were offline
    too -- flagged `conflict` (new `local_locations`/`local_items` column,
    added additively via a new `ensureColumn()` helper so it doesn't break
    an already-provisioned device's existing local database -- verified
    against `node:sqlite`) and left dirty rather than pushed, never
    silently overwritten in either direction. `[id]/index.tsx` triggers a
    sync opportunistically -- right after a successful online load, and
    again on an offline→online reconnect while the screen stays open
    (`useConnectivity()`) -- and shows a banner with a running conflict
    count when any exist. `npm run lint`, `npm run format:check`,
    `npx tsc --noEmit`, and `expo export --platform android` (4.2MB) all
    pass.
  - **Resume mid-inspection + app-wide connectivity/sync indicators**
    (`src/lib/offline-db.ts`, `src/lib/offline-sync.ts`,
    `inspections/index.tsx`, `(app)/_layout.tsx`): the Inspections list was
    the one remaining screen that was still 100% network-only -- a cold
    app start with no signal rendered it empty even when the local SQLite
    mirror already had an in-progress inspection sitting on the device,
    meaning a person could resume an _already-open_ inspection offline
    (task 43) but couldn't get back to it from the list in the first
    place. Fixed with the same network-first/local-mirror-fallback pattern
    already used by `[id]/index.tsx` (including its `loadRef`
    self-reference trick, to reload after an opportunistic sync without
    tripping `react-hooks/immutability`): a new
    `getAllLocalInspectionHeaders()` reads every locally-mirrored
    inspection, most-recently-touched first, and the list falls back to it
    whenever the network fetch is skipped (offline) or fails. A new
    `syncAllInspections()` (`offline-sync.ts`) loops that same header list
    and drains each one through the existing per-inspection
    `syncInspection()`, run opportunistically on every successful online
    list load. While showing the local-mirror fallback, the list's "manage"
    (⋮) button — reschedule/reassign/void, all of which need the network —
    is hidden per row, since there's nothing it could actually do offline.
    Separately, a new `getSyncOverview()` (`offline-db.ts`) gives
    _global_ pending-location/item/photo and conflict counts across every
    locally-mirrored inspection, not just one — this is what now powers
    both the Inspections list's own banners and a persistent app-wide
    "Offline" strip plus a pending-sync-count badge on the Inspections tab
    itself, added to `(app)/_layout.tsx` (polling `getSyncOverview()` every
    15s and on every online/offline transition, since there's no
    cross-screen event bus in this app for "the local mirror just
    changed"). All three new SQL query shapes (`ORDER BY updated_at DESC`
    over local headers; the dirty/conflict-excluding pending counts; the
    two-subquery conflict total) verified against `node:sqlite` with
    seeded rows before being trusted. `npm run lint`, `npm run
format:check`, `npx tsc --noEmit`, and `expo export --platform
android` all pass.
  - **Conflict resolution UI** (`src/app/(app)/inspections/[id]/conflicts.tsx`,
    new; `offline-db.ts`/`offline-sync.ts` extended): the last open item
    from Phase 5C's original scope. Every location/item offline-sync.ts
    has flagged `conflict` is now something a person can actually act on,
    not just see. New `offline-db.ts` reads/writes:
    `getConflictedLocationsForInspection()`/`getConflictedItemsForInspection()`
    list the flagged rows for one inspection; `overwriteLocationFromServer()`/
    `overwriteItemFromServer()` pull the server's current content into the
    local mirror and clear both `dirty`/`conflict` (the "keep server's"
    path); `clearLocationConflictKeepLocal()`/`clearItemConflictKeepLocal()`
    leave the local edit itself untouched but clear `conflict` and refresh
    `server_updated_at` (the "keep mine" path), so the _next_ ordinary
    `syncInspection()` push sends it as a ordinary clean update instead of
    re-detecting the same conflict. New `offline-sync.ts` exports:
    `fetchServerLocationSnapshot()`/`fetchServerItemSnapshot()` (a
    read-only peek at the server's current content, for the screen to
    show side by side with the local copy -- deliberately separate from
    the push/conflict-detection path) and `resolveLocationConflict()`/
    `resolveItemConflict()` (the two resolution paths above, keyed on a
    new `ConflictResolution = 'keep_local' | 'keep_server'` type). The
    screen itself lists every conflicted row with both versions
    side-by-side, lets a person resolve one at a time (removing it from
    the list immediately), and best-effort triggers an immediate
    `syncInspection()` after a "keep mine" resolution so the row doesn't
    sit visibly pending until the next ordinary sync happens on its own.
    Reached by tapping the (now tappable) conflict banner on the
    walkthrough screen; the Inspections list's own conflict banner text
    was updated to point at it ("open the affected inspection") now that
    there's actually something to open. All four new SQL shapes (the two
    conflicted-row listings, the server-overwrite update, the
    keep-local-and-clear update) verified against `node:sqlite` with
    seeded rows, including confirming a resolved "keep mine" row
    correctly reappears in the ordinary dirty-and-eligible-to-sync query
    afterward. `npm run lint`, `npm run format:check`, `npx tsc --noEmit`,
    and `expo export --platform android` all pass.
  - **Phase 5C is now feature-complete** against PRODUCT_SPEC.md section
    9's offline-capture requirements: local mirroring, offline writes,
    offline photo capture, background sync with idempotent uploads,
    conflict detection, resume-mid-inspection from a cold start, app-wide
    connectivity/pending-sync visibility, and now conflict resolution.
    What's left is real-device verification (see TEST_PLAN.md's unchecked
    items throughout this phase) rather than any more app code.

- **EAS Build configuration**, so the app can be installed as a standalone
  APK and actually tested away from the dev machine's LAN (the missing
  piece behind "why does the phone need to be on the same wifi as my
  laptop" -- Expo Go's live-reload connection to the local Metro bundler
  only works on the same network; a standalone build has no such
  dependency and only ever needs to reach Supabase, which per Phase 5C it
  mostly doesn't even need to do in real time). New `eas.json` with three
  profiles: `development` (a debug dev-client build, still connects to a
  Metro server, now via `expo-dev-client` -- added as a dependency at the
  exact SDK-57-bundled version `~57.0.18`, per `expo/bundledNativeModules.json`,
  after `npx expo install` itself failed here on a sandboxed proxy
  restriction unrelated to the package itself); `preview` (a standalone,
  installable APK with the JS bundled in -- no Metro connection at all,
  this is the one that actually answers "away from home internet");
  `production` (an `.aab` app bundle, for an eventual Play Store
  submission). `app.json` gained the required `android.package`
  (`com.capexinspectionpro.app` -- confirmed as the correct field via
  `docs.expo.dev/versions/v57.0.0/config/app`, since this value is
  effectively permanent once first submitted to the Play Store). Each
  eas.json profile references a named `environment` (`development`/
  `preview`/`production`) rather than hardcoding the `EXPO_PUBLIC_*`
  Supabase values directly in the file, per EAS's own current guidance
  (`docs.expo.dev/build-reference/variables`) -- confirmed via each
  profile's `environment` field, means those two values need to be
  registered once per environment with `eas env:create` (see README/
  TEST_PLAN for the exact commands) rather than committed to eas.json.
  Added `build:android:preview`/`build:android:production`/
  `build:android:dev-client` npm scripts as thin wrappers. **This step
  needs the project owner's own Expo/EAS account** (`eas login`) --
  nothing in this repo change actually triggers a build; verified only
  that `app.json` still parses correctly (`expo config --type public`),
  and that `tsc`/lint/`format:check`/`expo export --platform android`
  all still pass with `expo-dev-client` installed.
- **Phase 5D: deficiencies & corrective actions** (PRODUCT_SPEC.md
  section 10), the last feature phase blocking full-cycle "spot a
  deficiency → track it to closed" support. `inspection_snapshot_items`
  already captured every deficiency _field_ at inspection time (Phase
  5B); what was missing was the part that outlives a single inspection --
  a corrective action's own lifecycle, tracked independently of (and
  surviving the hard-deletion of) the inspection that raised it.
  New migration `0017_findings_corrective_actions.sql` adds three tables
  (`vendors`, `findings`, `corrective_actions` -- see DATABASE_SCHEMA.md
  Part B for the full shape) and five functions. A finding and its first
  corrective_action now open **automatically** the instant an inspector
  marks an item `deficiency` during a walkthrough (a SECURITY DEFINER
  trigger, so it works regardless of the inspector's own limited
  permissions) -- nobody has to remember to "file" a deficiency
  separately. From there, an org_admin/portfolio_manager/supervisor
  manages the remediation from a new **Corrective Actions** tab: a
  filterable board (open/assigned/vendor_required/scheduled/in_progress/
  .../verified/closed/voided -- the full 12-state lifecycle from the
  spec) and a deficiency detail screen showing the original observation,
  photos, priority, resident-access flag, manual escalation (with an
  "escalation due" indicator once a P1/P2 finding has been open longer
  than the spec's 2-hour/24-hour response window), and the corrective
  action itself (assignee, vendor -- addable inline -- schedule, cost,
  completion notes, supervisor verification). Every status transition is
  audit-logged; `verified` is blocked until `completed` is actually
  reached, and `voided` requires a reason, both enforced in the same
  function that does the writing, not just in the UI. The final-review
  screen's deficiency cards now link straight into this flow when a
  finding exists for that item. Deliberately deferred (documented in
  0017's own header comment so it isn't mistaken for an oversight):
  automatic time-based escalation (no scheduled-job infrastructure in
  this project yet -- the "escalation due" indicator is a client-side
  computation, not a server-side timer), completion-evidence photos on a
  corrective action (text notes only for now), a dedicated vendor
  management screen, and follow-up inspections resolving their scope
  from open findings (blocked on `follow_up` itself still being a
  deferred inspection type). Verified against a local Postgres 16
  instance as the actual `authenticated` role across two orgs and every
  permission tier -- auto-creation and its idempotency, direct-write
  RLS blocking, cross-org isolation, the verified/voided integrity
  gates, and a finding surviving a hard-deleted inspection. `npx tsc
--noEmit`, lint, `format:check`, and `expo export --platform android`
  all pass.

### Fixed

- `src/lib/secure-storage.ts` was throwing
  `TypeError: ExpoSecureStore.default.getValueWithKeyAsync is not a
function` on a repeating ~30s timer (Supabase's auth auto-refresh
  tick). Root cause: `expo-secure-store` has no web implementation at all
  (its web build is a literal `{}`), so every native call on web was
  guaranteed to throw — this isn't an `expo-secure-store` version bug,
  it's expected behavior for a module that's native-only, and this app's
  shipped target is mobile (web only comes up as an Expo dev-server
  preview). The adapter now checks `expo-secure-store`'s own
  `isAvailableAsync()` (also treating `Platform.OS === 'web'` as
  unavailable up front) and falls back to an in-memory, non-persistent
  store when the native module isn't there, instead of throwing on every
  call. Deliberately did **not** fall back to `localStorage` on web,
  since that would silently weaken the "secure storage only" contract
  this adapter exists to guarantee (PRODUCT_SPEC.md section 3.6) —
  sessions just won't survive a full reload on web, which is fine since
  web isn't a supported surface for this app. This also defensively
  covers any platform where the native module fails to link for some
  other reason, logging one warning instead of erroring on a loop.
  `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
  `expo export --platform android` all pass.
- Ran `npx expo install --check` and brought every flagged package up to
  the version Expo's SDK 57 compatibility check expects: `expo`
  (57.0.14 → 57.0.20), `expo-constants` (57.0.12 → 57.0.17), `expo-font`
  (57.0.1 → 57.0.3), `expo-image` (57.0.3 → 57.0.4), `expo-linking`
  (57.0.6 → 57.0.9), `expo-router` (57.0.14 → 57.0.19),
  `expo-secure-store` (57.0.1 → 57.0.3), `expo-splash-screen`
  (57.0.7 → 57.0.8), `expo-system-ui` (57.0.2 → 57.0.3), `react-native`
  (0.86.2 → 0.86.3), and `eslint-config-expo` (57.0.1 → 57.0.2). This is
  routine SDK-57 patch-level maintenance, not a fix for the
  `ExpoSecureStore` error above (that one's root cause is web having no
  native module at all, not a stale patch version), but it's good
  hygiene and was flagged in your terminal output. `npm run lint`,
  `npm run format:check`, `npx tsc --noEmit`, and
  `expo export --platform android` (1409 modules) all pass after the
  bump.
- **Photo sync stuck in a permanent retry loop** with
  `StorageApiError: The resource already exists`, caught on a real device
  during the first standalone-build field test (2026-09-09) -- the first
  real bug this project's offline-sync design has actually hit in
  practice. Root cause: `offline-sync.ts`'s `pushPendingPhoto()` and
  `offline-photos.ts`'s online-capture upload both called Supabase
  Storage's `.upload()` without `{ upsert: true }`. The idempotency design
  (task 43's CHANGELOG entry) only ever made the _`photos` table row_
  retry-safe (`.upsert(..., { onConflict: 'client_uuid', ignoreDuplicates:
true })`) -- the _Storage upload_ half of the same two-step write was
  never actually made idempotent, even though both steps write to the
  same deterministic, `client_uuid`-keyed path and both can be the one a
  retry lands on. Concretely: a sync run got the file into Storage
  successfully, then was interrupted (connection drop, app backgrounded,
  etc.) before the `photos` upsert or `markPhotoUploaded` ran, so the
  local row stayed `uploaded = 0`; every later retry re-attempted the
  identical upload to the identical path and hit Storage's default
  behavior of rejecting a second write to an existing path outright --
  confirmed directly from the installed `@supabase/storage-js` package's
  own `FileOptions` type comment ("an error is thrown if the object
  already exists. Defaults to false"), not assumed. Fixed by adding
  `upsert: true` to both call sites: since the path is content-addressed
  by a UUID generated once at capture time, a retry is always
  byte-identical, so overwriting is a correct no-op rather than a
  permanent error. No manual cleanup needed for photos already stuck in
  this state -- the very next sync attempt after this fix ships
  succeeds all the way through (upload no-ops, `photos` upsert no-ops if
  it had actually gotten there before, `markPhotoUploaded` finally runs)
  and self-heals. `npm run lint`, `npm run format:check`,
  `npx tsc --noEmit`, and `expo export --platform android` all pass.
- Your terminal flagged `expo` (57.0.20 → 57.0.21) plus "1 other package"
  needing an update. `npx expo install --check` can't reach Expo's API from
  this sandboxed environment (`HTTP Proxy Network Error: Forbidden`), so
  confirmed `57.0.21` is genuinely current via `npm view expo dist-tags`
  and installed it directly. Cross-checked the rest of `package.json`
  against the newly-installed `expo`'s own
  `node_modules/expo/bundledNativeModules.json` (the authoritative
  SDK-57-compatible-version list) to find the "1 other package": it was
  `expo-router`, at `57.0.19` when the manifest now expects `57.0.20`.
  Bumped both: `expo` (57.0.20 → 57.0.21), `expo-router`
  (57.0.19 → 57.0.20). Routine SDK-57 patch-level maintenance, same as the
  earlier `expo install --check` bump above. `npm run lint`,
  `npm run format:check`, `npx tsc --noEmit`, and
  `expo export --platform android` all pass after the bump.
- **Retried photo upload rejected with `StorageApiError: new row violates
row-level security policy`** (migration `0018`), caught in the field
  (2026-09-09) on the exact same two photo ids that hit the earlier
  "resource already exists" bug -- confirming this is a direct follow-on
  of that fix, not a new independent issue. Root cause: adding
  `{ upsert: true }` to both Storage `.upload()` call sites correctly
  fixed a brand-new retry, but Supabase Storage's `upsert: true` takes an
  UPDATE path internally (not a plain INSERT) when an object already
  exists at the target path -- and migration `0014` only ever granted
  `select`/`insert`/`delete` RLS policies on `storage.objects` for the
  `inspection-photos` bucket, with no `update` policy at all. So for the
  two photos that had already landed in Storage once before their sync
  run was interrupted, every retried upload's internal UPDATE was
  rejected by RLS's default-deny. Fixed by adding the missing
  `inspection_photos_update_own_org` policy, scoped identically to the
  existing insert/select/delete policies (same
  `(storage.foldername(name))[1] = organization_id` check). Verified
  against a local Postgres 16 instance as the `authenticated` role: an
  update to an existing object under the caller's own org now succeeds
  (previously blocked), and a second org's `authenticated` user still
  matches 0 rows against that same object (cross-org isolation intact).
  No manual data cleanup needed -- the two already-stuck photos self-heal
  on their next sync attempt once this policy is in place, same
  self-healing behavior as the original `upsert: true` fix. **This is a
  database migration**
  (`supabase/migrations/0018_inspection_photos_storage_upsert.sql`) and
  must be run against the live Supabase project's SQL Editor for the fix
  to take effect -- delivering the file to the repo alone does not apply
  it. `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
  `expo export --platform android` all pass (no app code changed).

### Added

- **Sync Status screen**, linked from Settings: a diagnostics + control
  screen for the offline sync engine, requested after the recent string
  of photo-sync bugs made it clear there was no way to actually see
  what was stuck or why. Shows global pending counts (areas, items,
  photos, conflicts — same numbers as the app-wide "Offline, N changes
  pending" strip, just broken out), a manual "Sync now" button, and a
  list of every pending photo/area/item with its failure count and most
  recent error message. Added `sync_attempts`/`last_sync_error` columns
  to the local SQLite mirror's `local_locations`/`local_items`/
  `local_photos` tables (`offline-db.ts`'s `ensureColumn` — no migration
  needed, this is local-device schema, not Supabase) and wired
  `offline-sync.ts`'s every failure path to record them, resetting on a
  successful push. Photos get a real "Discard" action (with an inline
  confirm, matching the deficiency detail screen's escalation-confirm
  pattern rather than a native `Alert`) that deletes the local database
  row and the encrypted file on disk — safe because discarding a photo
  can't misrepresent an inspection finding (the checklist item's actual
  observation/status is untouched) and it can always be recaptured.
  Deliberately did **not** add a discard action for pending areas/items:
  per PRODUCT_SPEC.md section 9's conflict philosophy, a local edit is
  never silently thrown away, even a stuck one — those are shown
  read-only (name, failure count, error) so a person can at least see
  what's stuck and why, without a path to accidentally lose an
  inspector's actual finding. This also fixed a latent, previously
  invisible bug in passing: a dirty location/item whose inspection was
  voided/deleted server-side (`pushDirtyLocation`/`pushDirtyItem`'s
  `!serverRow` case) would retry forever with no way to ever succeed —
  now at least visible with a clear explanation instead of silently
  looping in the background.
- **App version shown in Settings**, reading `app.json`'s `version` field
  plus a platform build number (`android.versionCode` /
  `ios.buildNumber`, both added to `app.json` this round, starting at 1)
  via `expo-constants` — so a build can be identified at a glance without
  needing to check the repo. `npm run lint`, `npm run format:check`,
  `npx tsc --noEmit`, and `expo export --platform android` all pass.

### Fixed

- **Every photo upload was actually failing at the database step** with
  `42P10: there is no unique or exclusion constraint matching the ON
CONFLICT specification` (migration `0019`) — found while diagnosing why
  the `client_uuid` schema-cache errors persisted even after confirming
  migrations `0016`/`0017` were applied live (they'd never actually been
  run against the live Supabase project until this point; separately,
  once they were, this deeper bug surfaced). Root cause: migration
  `0016`'s `photos.client_uuid` unique index (and `0011`'s identically-
  shaped one on `inspection_snapshot_items`) was declared _partial_
  (`where client_uuid is not null`) — but Postgres can only use a partial
  unique index as an `ON CONFLICT` inference target when the insert's own
  `ON CONFLICT` clause repeats the exact same `WHERE` predicate, and
  PostgREST's `on_conflict=` query parameter (what `.upsert(...,
{ onConflict: 'client_uuid' })` generates) has no way to express that.
  Reproduced directly against a scratch table with the identical partial-
  index shape (confirmed the exact same `42P10` error), then confirmed
  the fix — dropping the partial predicate in favor of a plain unique
  index — resolves it while a plain unique index was never actually less
  strict for this table's purposes: Postgres already treats NULL as never
  equal to another NULL for uniqueness, so every photo captured before
  this migration (`client_uuid` null) was always going to coexist fine
  regardless of the predicate. Verified end-to-end against a local
  Postgres 16 instance as the real `authenticated` role (RLS fully
  enforced): first insert succeeds, an identical retry correctly no-ops
  instead of erroring, a second genuinely different photo still inserts
  normally, and a real duplicate (no `ON CONFLICT`) is still correctly
  rejected as a unique violation. This has been silently broken since
  Phase 5C first shipped `client_uuid`-based photo idempotency — nothing
  in this project's Postgres-only verification methodology (direct SQL
  via `psql`, never through an actual PostgREST layer) could have caught
  an HTTP/PostgREST-specific `ON CONFLICT` inference restriction, which is
  worth remembering for future migrations that add a partial unique index
  intended for use with a client-side `.upsert()`. **This is a database
  migration** (`supabase/migrations/0019_client_uuid_index_on_conflict_fix.sql`)
  and must be run against the live Supabase project's SQL Editor — every
  currently-stuck photo (there is no cap on how many, since this bug
  affected every photo upload attempt, not just retries) self-heals on
  its next sync attempt once this is applied, no manual data cleanup
  needed. `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
  `expo export --platform android` all pass (no app code changed).

- Triaged the Supabase Security Advisor / Performance Advisor findings you
  pasted (snapshot taken before `0019`, which doesn't change any of them —
  it only touched two indexes). Two are fixed in migration `0020`; the
  rest are deliberate no-migration decisions, listed below.
  - **Fixed:** `function_search_path_mutable` on `set_updated_at()` — the
    one function in the schema missing `set search_path = public`; every
    other function already has it since it's required for `SECURITY
DEFINER` correctness, this trigger function just isn't one and got
    skipped.
  - **Fixed:** `auth_rls_initplan` (every flagged table) and the
    `multiple_permissive_policies` finding on `profiles` UPDATE —
    mechanical rewrite of every policy's `auth.uid()` /
    `current_organization_id()` calls to `(select ...)` form so Postgres
    evaluates them once per query instead of once per row, plus
    consolidating `profiles_update_self` + `profiles_update_by_admin`
    into one policy. Also applied the same initplan fix to the
    `storage.objects` inspection-photos policies from `0014`/`0018`,
    which have the identical shape even though the advisor output didn't
    call out `storage` by name.
  - **Found and fixed a real, currently-live bug while writing this
    migration's regression tests, unrelated to anything in the pasted
    advisor output:** `profiles_update_by_admin`'s admin-role check was a
    subquery reading `profiles` from inside `profiles`' own policy — the
    exact self-referencing shape `current_organization_id()` was
    originally written specifically to avoid (see its comment in
    migration `0001`), just not applied consistently to this one check.
    The moment ANY update touches `profiles` — even a user updating their
    own row through the unrelated `profiles_update_self` policy — Postgres
    still evaluates every permissive policy to `OR` them together, which
    re-enters `profiles`' own row-security machinery and fails with
    `infinite recursion detected in policy for relation "profiles"`
    instead of looping forever. Confirmed this reproduces with the
    original, unwrapped `auth.uid()` too, so it isn't something the
    initplan rewrite introduced — it's been live since migration `0001`.
    It has never actually fired because nothing in the app issues an
    `UPDATE` against `profiles` yet (every current read is a plain
    `.select()`), but it would have broken the first "edit my name" or
    "change this person's role" feature outright. Fixed by moving the
    admin check into a new `current_user_is_org_admin()` `SECURITY
DEFINER` helper — same pattern as `current_organization_id()` — so
    the inner read bypasses `profiles`' RLS entirely instead of
    re-entering it. Verified against a local Postgres 16 instance as the
    real `authenticated` role: a user can still update their own profile,
    an org admin can still update another profile in their org, a
    cross-org admin is still correctly blocked (0 rows affected), and the
    same admin-update-a-vendor / inspector-updates-their-assigned-
    inspection paths on other tables still work after their own initplan
    rewrite.
  - **Not fixed, by design — dashboard setting, not code:**
    `auth_leaked_password_protection`. This is a one-click toggle under
    Supabase's Auth settings (Authentication → Policies → Password), not
    something a migration can turn on.
  - **Not fixed, low priority at current scale:** the `INFO`-level
    `unindexed_foreign_keys` and `unused_index` findings. The unused
    indexes most likely just reflect real-world usage — a fresh project
    with a handful of test users hasn't run enough queries to exercise
    them yet — and adding indexes for foreign keys with no query pattern
    that needs them yet would be speculative. Worth revisiting once
    there's real usage data to look at.
  - **Reviewed, not acted on:** `anon_security_definer_function_executable`
    / `authenticated_security_definer_function_executable` on every
    `SECURITY DEFINER` function. Checked every one of them — every RPC
    function already has an explicit `revoke all ... from public` +
    `grant execute ... to authenticated` immediately after its
    `create or replace function` (confirmed via a repo-wide grep), so
    `anon` genuinely cannot call any of them; the remaining three
    (`handle_new_user`, `sync_finding_status_from_corrective_action`,
    `handle_item_deficiency`) are trigger functions (`returns trigger`),
    which Postgres refuses to execute outside trigger context regardless
    of grants. If the advisor is still flagging these as anon-executable
    on the live project, that most likely means the `revoke`/`grant`
    statements in one of the earlier migrations were never actually run
    live — the same "migration file delivered, but never applied"
    pattern as `0016`/`0017` — worth running the diagnostic query below
    to check what's actually live before assuming there's a real gap.
    `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` all pass (no app code changed).

- **Closing out the photo-sync bug chain from `0016` through `0019`:**
  after `0019` was applied live, the schema-cache and `ON CONFLICT`
  errors were gone, but the 7 photos that had been stuck in the local
  queue since before `0019` (accumulated during the whole
  0016/0017/0019 debugging period) started failing instead with `42501`
  ("new row violates row-level security policy for table photos") —
  a genuine `photos_insert_own_org` rejection, not a schema or index
  problem. Most likely explanation: whatever inspection/item those 7
  specific photos pointed at was voided, deleted, or reassigned to a
  different inspector sometime during that debugging window, so they
  no longer satisfy the policy's assigned-inspector/admin check. This
  is exactly the "permanently stuck for a reason the client can't fix"
  case the Sync Status screen's per-photo Discard button was built for
  — confirmed 2026-09-10 on-device: discarding all 7 immediately
  cleared the errors from the sync log with no further retries. No code
  change; this entry exists to close the loop for anyone reading this
  file top-to-bottom wondering whether the `42501` errors indicate
  `0019`/`0020` didn't actually fix anything (they did — this was old
  debris, not a new failure mode). Still worth doing on your end: capture
  a **brand-new** photo on a currently-open inspection and confirm it
  syncs cleanly, as the actual end-to-end confirmation that fresh photo
  capture now works all the way through.

### Added

- **Phase 7: reports.** PRODUCT_SPEC.md section 11 only ever said
  "branded PDF report, generated client-side, immutable once approved" —
  the actual data model and content were never spelled out (v0.1's
  detail behind that line was never carried into v0.2), so this phase
  designed and built it from scratch. See `PRODUCT_SPEC.md` section 11
  and `DATABASE_SCHEMA.md`'s "reports" entry for the full design;
  summary:
  - `supabase/migrations/0021_inspection_reports.sql`: a `reports` table
    (one row per inspection, append-only — no update/delete policy at
    all, same immutable-freeze pattern as `inspection_snapshots`), a new
    private `inspection-reports` Storage bucket (same
    `{organization_id}/...` path-prefix RLS as `inspection-photos`), and
    `approve_report()`, a `SECURITY DEFINER` function restricted to
    org_admin/portfolio_manager/supervisor that only accepts a
    `completed` inspection with no existing report. Verified against
    local Postgres 16 as the real `authenticated` role: role gating,
    completed-only gating, one-report-per-inspection,
    cross-org isolation on both the table and the Storage bucket, and
    storage-path forgery are all covered.
  - `src/lib/reports.ts`: assembles a report's content from an
    inspection's frozen snapshot (scope summary with skipped/
    inaccessible reasons, findings sorted P1-first with photos and
    current corrective-action status, full item-by-item appendix),
    renders it to a PDF on-device via the new `expo-print` dependency,
    and either opens it in the device's share sheet for preview
    (`previewReport()`, nothing recorded) or uploads it and calls
    `approve_report()` to finalize (`approveReport()`). A separate
    `getApprovedReport()`/`shareApprovedReport()` pair (using the new
    `expo-sharing` dependency) lets anyone in the org view/re-share an
    already-approved report via a signed URL.
  - New `inspections/[id]/report.tsx` screen (Report preview / PDF
    viewer, per PRODUCT_SPEC.md section 6): shows a "waiting for
    approval" message to inspector/viewer roles, Preview + Approve
    buttons (with an inline confirm before the irreversible approval,
    same pattern as the Sync Status screen's photo-discard confirm) to
    org_admin/portfolio_manager/supervisor, or the approved report's
    approver/date + an open/share button once one exists. Reached via a
    new "View report →" link on the review screen once an inspection is
    submitted.
  - `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` all pass.

- **Phase 8: dashboard & analytics.** PRODUCT_SPEC.md section 12 had the
  same problem section 11 had before Phase 7: only a one-line summary
  ("Portfolio-level counts, filters, aging") survived from v0.1, with no
  real metric list. This phase designed and built it from scratch — see
  `PRODUCT_SPEC.md` section 12 for the full writeup; summary:
  - No new migration — every metric is a plain read-only count over
    tables that already exist and are already RLS-scoped to the caller's
    own organization (`properties`, `inspections`, `findings`,
    `corrective_actions`).
  - `src/lib/dashboard.ts`: `fetchDashboardProperties()` (active
    properties, for the filter dropdown) and `fetchDashboardMetrics()`
    (property slot usage; inspection counts by status plus a derived
    "overdue" count for anything still scheduled/in-progress past its
    scheduled date; open findings by priority P1-P4 plus an escalated
    count; corrective-action open/overdue counts), every count using
    `.select('id', { count: 'exact', head: true })` rather than fetching
    rows. Accepts an optional single-property filter — when set, the two
    corrective-action metrics join out to `findings` for its
    `property_id` via PostgREST's embedded-resource filter
    (`findings!inner(property_id)` + `.eq('findings.property_id', ...)`),
    since `corrective_actions` itself only denormalizes
    `organization_id`, not `property_id`.
  - Replaced the Dashboard tab's placeholder with a real screen
    (`src/app/(app)/index.tsx`): a horizontally scrollable property
    filter ("All properties" plus each active property), then
    Properties/Inspections/Open findings/Corrective actions sections of
    tappable stat rows (P1 findings, overdue inspections, escalated
    findings, and overdue corrective actions are visually highlighted),
    each row navigating to the tab that actually manages that data.
    Every stat here is informational only, per the spec's own
    "remaining-slot indicators (informational only)" framing — nothing
    on this screen writes anything.
  - `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` all pass.

- **Phase 10: device registration & security.** Unlike Reports/Dashboard,
  PRODUCT_SPEC.md section 3 and DATABASE_SCHEMA.md Part A had already
  fully designed this back in Phase 1 (v0.2) — this phase implements
  that existing design rather than redesigning it. One real scope
  decision made with the user before writing any code: real Google Play
  Integrity verification needs a native Android module this Expo-managed
  app can't call without a custom dev client, plus a Google Cloud
  project linked to Play Console that PRODUCT_SPEC.md's own decision log
  already deferred to "Phase 12 lead-up" — so everything except that one
  piece is fully real; Play Integrity itself ships in a clearly-marked
  bypass mode. Summary:
  - `supabase/migrations/0022_devices_and_security_events.sql`: new
    `devices` and `security_events` tables (RLS: a user sees their own
    device(s), an org_admin sees every device/event in the org — see
    DATABASE_SCHEMA.md's entries for the full column list).
    `register_or_replace_device()` — the same row-locked
    check-then-write transaction shape as `create_property()` — is the
    only way `devices` ever gets a new active row, callable only by
    `service_role` (i.e. only the register-device Edge Function below).
    `revoke_device()` lets an org_admin revoke a device directly.
    `log_login_success()`/`log_mfa_enrolled()` are small
    `authenticated`-callable functions the client calls at the right
    moment, deliberately used instead of triggers on `auth.sessions`/
    `auth.mfa_factors` — this project has never touched those tables
    before and isn't confident enough of their exact shape on the live
    project to trigger on them sight-unseen. `handle_new_user()` (0002)
    is extended to also log a `signup` event, and a new trigger on
    `auth.users` logs `email_verified` — both safe extensions of the
    already-proven `auth.users`-trigger pattern. Verified against local
    Postgres 16 as both `service_role` and `authenticated`: new
    registration, idempotent same-fingerprint re-registration,
    reinstall/device-swap replacement (old revoked and linked, no extra
    slot consumed), the device-limit rejection path, `revoke_device()`'s
    admin-only + cross-org-blocked behavior, and every RLS policy's
    own-row-vs-admin-sees-all-vs-cross-org-blocked shape.
  - `supabase/functions/register-device/index.ts`: a new Supabase Edge
    Function (Deno) — the first in this project. Verifies the caller's
    JWT, computes the HMAC-SHA256 fingerprint server-side (the raw
    app-scoped identifier is never stored), and calls
    `register_or_replace_device()` via the service role. Deploy this via
    the Supabase Dashboard's Edge Functions editor (paste `index.ts`),
    not the CLI — same "avoid a Docker/CLI dependency" decision already
    made for migrations — and set a `DEVICE_HMAC_SECRET` project secret
    (see the function's own header comment for how). `tsconfig.json` and
    `eslint.config.js` both now exclude `supabase/functions/**` — it's
    Deno code, a different runtime from the rest of this Expo/RN project.
  - `src/lib/device-registration.ts`: generates a random app-scoped id
    once per install (stored in `expo-secure-store`, so it naturally
    resets on uninstall/reinstall, per PRODUCT_SPEC.md 3.2) and calls the
    Edge Function.
  - `src/lib/mfa.ts` + new `mfa-setup.tsx`/`mfa-challenge.tsx` screens:
    mandatory TOTP two-factor for org_admin, built entirely on Supabase
    Auth's own MFA support (`supabase.auth.mfa.*`) — no custom backend
    code needed here. Enrollment shows the manual-entry secret as text
    rather than a QR code, to avoid adding an SVG-rendering dependency
    for one screen.
  - `src/app/_layout.tsx`: the root navigator now gates on session **and**
    MFA status (challenge-required / setup-required / satisfied) before
    routing into `(app)`, and shows a blocking error screen if device
    registration fails — the one case PRODUCT_SPEC.md's screens table
    allows it to interrupt the app, since registration is otherwise
    silent.
  - New `src/app/(app)/settings/devices.tsx` ("Devices & Security," per
    the screens table): your own device, and for an org_admin, every
    device in the organization (with revoke) plus the recent security
    events log.
  - Deliberately not implemented this phase (called out here so it isn't
    mistaken for an oversight): `login_failed`, `mfa_challenge_failed`,
    `captcha_failed`, and `rate_limit_triggered` security events — none
    of these leave a row in any table this project can trigger on;
    capturing them needs Supabase Auth Hooks (a dashboard-configured
    webhook), a separate piece of infrastructure to set up, not a
    migration.
  - `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
    `expo export --platform android` all pass.

### Notes

- Phase 0 (discovery and environment setup): complete.
- Phase 1 (product specification): approved.
- Phase 2 (application foundation): complete and verified on a physical
  Android device.
- Phase 3 (organization and property management): complete and verified
  on a physical Android device — migrations applied, RLS confirmed
  enabled, sign-up trigger confirmed working, and Properties list/create
  UI working end-to-end. Remaining `TEST_PLAN.md` items under "Properties
  screen (Phase 3 UI)" (plan-limit message, blank-name validation,
  Settings org display, pull-to-refresh) are still open for you to
  spot-check when convenient, but nothing left is blocking Phase 4.
- Phase 4 (guided setup wizard, checklist generation): complete and
  verified on a physical Android device — database layer, wizard UI
  (add area, confirm/un-confirm components, generate checklist and its
  added-count message) all confirmed working end-to-end. Still open in
  `TEST_PLAN.md`: the property detail screen's active-check count
  updating after generating — not yet explicitly confirmed, worth a
  quick spot-check next time you're in the app.
- Phase 5A (inspection scheduling + scope-resolution database layer):
  complete. Migrations `0011`-`0012` verified against a local Postgres 16
  instance (see above) and confirmed applied successfully in the Supabase
  SQL Editor 2026-09-06.
- Phase 5B (basic online-only inspection walkthrough UI), its follow-up
  Phase 5B-ext (checklist management + mandatory photo capture), and
  Phase 5B-ext2 (edit/void/delete an inspection itself): all built and
  quality-checked (lint/format/typecheck/bundle all clean). Migration
  `0015` (Phase 5B-ext2) is confirmed applied to the live Supabase
  project. None of this has been tried on a physical device yet — that's
  the next thing to do.
- Phase 5C (offline capture/local SQLite mirror, flagged release-blocking
  per PRODUCT_SPEC.md): **complete and confirmed working end-to-end on a
  physical Android device (2026-09-10)**, including the full offline
  photo-capture-and-sync path. This took several rounds to actually land:
  a schema-cache error traced to migrations `0016`/`0017` never having
  been applied live, then a genuinely new bug once they were (`0019`,
  partial-index/`ON CONFLICT` incompatibility), and finally a batch of
  photos left over from that whole debugging period that were correctly
  rejected by RLS because their underlying inspection/item had changed
  in the meantime — cleared via the Sync Status screen's discard action.
  With all of that resolved: capture a photo offline, bring the device
  back online, and it uploads and records successfully with no manual
  intervention.
- Phase 5D (deficiencies & corrective actions, migration `0017`): complete
  — findings/corrective-actions board, escalation, vendor assignment, and
  role-gated read-only views all built and quality-checked. Real-device
  walkthrough of the board/detail UI (as opposed to the RPCs directly)
  still open in `TEST_PLAN.md`.
- Also since Phase 5C/5D: added a Sync Status screen
  (`settings/sync-status.tsx`) for visibility into and manual recovery
  from stuck syncs, an app build-version display in Settings, and
  migration `0020` (Security/Performance Advisor hardening — initplan
  performance fixes on every RLS policy, a `search_path` fix, and a real
  pre-existing `profiles` RLS infinite-recursion bug found and fixed
  along the way). `0020` is a database migration delivered to the repo —
  confirm with yourself whether it's been run in the Supabase SQL Editor
  yet, separately from the `0016`-`0019` chain above.
- Phase 7 (reports, migration `0021`): built and quality-checked
  (lint/format/typecheck/bundle all clean, RLS/role gating verified
  against local Postgres 16). Not yet tried on a physical device — that
  real-device pass (preview a report, approve one, confirm role gating,
  confirm the approved PDF actually renders/shares correctly on-device)
  is the next thing to do, along with running `0021` in the Supabase SQL
  Editor.
- Phase 8 (dashboard & analytics): built and quality-checked
  (lint/format/typecheck/bundle all clean). No migration to run — this
  phase only reads existing tables. Not yet tried on a physical device;
  worth confirming the counts match what you'd expect by eye (including
  with the property filter applied), and that the property-filtered
  corrective-actions counts in particular are correct, since that's the
  one metric using a new join-based query pattern in this codebase.
- Phase 10 (device registration & security, migration `0022` +
  `register-device` Edge Function): **complete and confirmed working
  end-to-end on a physical Android device (2026-09-11)** — migration
  `0022` applied, the Edge Function deployed and reachable, MFA
  enrollment completed for the org_admin account, and device
  registration succeeding silently in the background as designed. Play
  Integrity itself is intentionally still in bypass mode — see this
  phase's `### Added` entry above and PRODUCT_SPEC.md section 3.2 for
  why, and what has to be true before that changes.
  - Getting here surfaced a real Supabase Dashboard gotcha worth
    recording for the next Edge Function this project deploys: the
    dashboard's "Deploy a new function" flow defaults to an
    auto-generated placeholder name (e.g. `quick-processor`) unless you
    explicitly type the intended name into the slug field on that very
    first screen. Renaming a function afterward (via its Settings) only
    changes the display label shown in the functions list — it does
    **not** change the actual routing slug in its URL
    (`.../functions/v1/<slug>`), which is what `supabase.functions.invoke()`
    actually calls. A mismatch here shows up as the client getting a
    generic `FunctionsHttpError`/non-2xx with nothing useful in any log,
    while a direct request to the function's URL (e.g. via `curl`) shows
    the real reason plainly (`404 NOT_FOUND` for a slug mismatch,
    `{"error":"server_misconfigured"}` for a missing secret, etc.) — a
    fast, unambiguous way to diagnose this class of problem instead of
    guessing from dashboard log filters. Fix was to deploy a fresh
    function with the correct slug entered at creation time and delete
    the mis-slugged one, rather than trying to rename in place.
  - Also confirmed while debugging this: migration `0022` is safe to
    accidentally re-run — Postgres treats the whole pasted script as one
    implicit transaction, so a second run failing on `relation "devices"
already exists` at the first statement means nothing from that
    second run was applied (or lost); it's a no-op, not a partial-state
    risk.
  - **Correction, same day:** the "complete and confirmed working"
    status above was written after an early "it is working" report, but
    a follow-up check found zero rows in `devices`/`security_events`
    despite the app showing success. Root cause: the function deployed
    under the `register-device` slug was still Supabase's own default
    boilerplate template (`withSupabase(...)` "Hello {name}!" sample),
    never replaced with this project's actual `index.ts` — it happily
    returns `200` for any well-formed request without touching the
    database, which is indistinguishable from a working function unless
    you check the database directly. The real `index.ts` content was
    given to paste over it, but that final fix was **not re-confirmed
    working** before other work took priority — re-check the Devices &
    Security screen (or re-run the `devices`/`security_events` row-count
    query) next time you're testing on-device to confirm registration
    now actually persists a row, and correct this entry again if not.

### Phase 11 (interim): report emailing, property deletion, start-inspection area display, multi-select add-area

Four small, unrelated fixes/additions requested directly on top of the
built app, ahead of any bigger Regional Configuration / monetization
work (see below). No new migration is needed for the first and third;
one new migration (`0023`) backs the second.

- **Email a completed report**: already fully supported — no code
  change was needed. The report screen's "Email / share report" button
  (relabeled from "Open / share report" for discoverability) opens the
  native OS share sheet via `expo-sharing`, which includes Mail/Gmail
  alongside any other app that can accept a PDF.
- **Delete a property**: `properties.status` already supported
  `'active'/'archived'`, and the existing `properties_update_own_org`
  RLS policy already let an org_admin/portfolio_manager toggle it — so
  archiving needed no new server-side code, just wiring. Added an
  "Archive property" / "Restore property" button (confirmed via a
  native `Alert`) to the property detail screen using a direct
  `update()` call. True hard deletion is new: migration `0023` adds
  `delete_property()`, restricted to `org_admin` and gated on the
  property having **zero** inspections ever recorded against it (an
  inspection's existence means real history that a cascading delete
  would either destroy or orphan) — wired to a "Delete permanently"
  (danger-styled, confirmed) button on the same screen. Deleting does
  free a Free-plan property slot; archiving deliberately does not (see
  PRODUCT_SPEC.md section 13 and `create_property()`'s slot-limit
  count in migration `0003`).
- **Start Inspection screen — show this property's areas**: previously
  the "Areas" section only appeared, and only fetched, once you'd also
  picked an inspection type that requires manual area selection
  (`apartment_unit`/`custom`) — for the other five types (comprehensive,
  roof, mechanical, common_area, fire_life_safety, which resolve their
  own scope server-side) nothing about the property's actual areas was
  ever shown. Now, as soon as a property is picked, its active areas
  load and display immediately under an "Areas at this property"
  heading — informational (read-only) for the five auto-scoping types,
  and the same interactive checkbox picker as before for
  `apartment_unit`/`custom`.
- **Add Area modal — multi-select**: reworked from a single-select radio
  list (`selectedAreaType: AreaType | null`, one "Add area" per type) to
  a checkbox multi-select (`selectedAreaTypes: AreaType[]`). Submitting
  inserts one `property_locations` row per selected type in a single
  batch insert, each named after its area type. The "Name this area"
  field still appears (and still lets you customize the name) only when
  exactly one type is selected, since a single shared name field can't
  meaningfully apply to several different area types at once — adding
  a second instance of the same type with a custom name (e.g. a second
  stairwell) still works by adding it alone.

### Phase 12: no-click checklist generation, area-first Start Inspection, apartment bedroom breakdown

A same-day follow-up to Phase 11, reworking the setup wizard and Start
Inspection screen based on direct feedback that the manual "confirm
components" step and "Generate checklist" button added friction without
adding real control (the platform-standard component library isn't
something most users will ever want to hand-pick per area), and that
Start Inspection buried area selection behind a type choice instead of
the other way around. No new migration — everything below is
application-level; `generate_property_checklist()` (migration `0009`)
is unchanged, just called automatically instead of from a button.

- **Areas auto-include everything, no manual step**: adding an area
  (`src/app/(app)/properties/[id]/setup.tsx`) now auto-inserts a
  `location_components` row (`confirmed: true`) for every standard
  component type under that area's area type, in the same action that
  creates the `property_locations` row. The `ManageComponentsModal`
  "check off what's present" screen is no longer wired into the setup
  flow (the component file itself is untouched, just unused, in case a
  future phase wants an opt-in fine-tuning path again).
- **Checklist generates itself**: `generate_property_checklist()` now
  runs automatically right after an area is added (or after "Refresh
  checklist" backfills older areas — see below) — there is no "Generate
  checklist" button anymore. The setup screen shows a live summary
  ("N active checks on this property") that updates after every add.
  "Refresh checklist" (secondary button) stays only as a safety net: it
  first backfills full component confirmation onto any area that has
  zero confirmed components (i.e. one added before this shipped, or one
  that somehow never got auto-confirmed), then regenerates — covers
  both legacy data and any future rule/library change.
- **Apartment/Unit bedroom breakdown**: selecting only "Apartment/Unit"
  in the Add Area modal now swaps the plain name field for a "Unit name"
  field plus a bedroom-count stepper (1–10). Submitting creates
  `Bedroom 1..N` plus a `Kitchen`, `Bathroom`, and `Living Room` — 3 + N
  `property_locations` rows in one batch, all still typed as
  `Apartment/Unit` (no new area type/component library needed; the
  existing Apartment/Unit component set — smoke/CO detectors, GFCIs,
  supply valves, etc. — applies to each). A closet, storage room, or
  mechanical room can still be added as its own area afterward using
  the existing "Storage Room"/"Mechanical Room" area types (already in
  the platform-standard library, migration `0005`) or "Custom Area"
  (also already seeded) for anything else, like a literal closet.
- **Start Inspection — area-first**: reworked
  `src/app/(app)/inspections/new.tsx` again. The Inspection Type list is
  gone from the primary flow entirely. Tapping a property now shows its
  areas as an always-interactive checkbox picker (previously this was
  read-only unless `apartment_unit`/`custom` had already been picked
  below — the exact friction flagged: "you have to go down to inspection
  type and select there"). A "Start inspection" button under the area
  list starts immediately once at least one area is checked, always
  calling `start_inspection()` with type `custom` — confirmed
  functionally identical to `apartment_unit` in migration `0012` (both
  branches just use whatever `p_location_ids` they're given), so
  dropping the type choice for this path loses nothing. The 5 types that
  resolve their own scope server-side (Comprehensive, Roof, Mechanical,
  Common area, Fire & life safety) remain reachable underneath as
  "Or start a quick inspection," each one starting immediately on tap —
  no separate submit step for those, since they need no additional
  input beyond the property already picked.

### Phase 13: preventive-maintenance checklist content

The user shared a broader preventive-maintenance checklist (8 sections:
building exterior, MEP, fire/life safety, interior common areas,
basement/service areas, site/grounds, pest prevention, compliance &
documentation) they'd been evaluating against a different tool, asking
that Capex Inspection Pro cover the same ground. No new inspection
type, no schema change, and no app code change was needed for this —
the inspection walkthrough screen already gives every checklist item a
status (checkbox-equivalent), a comment (`observation`), and a camera
photo, generically, for whatever's in the checklist. The only gap was
content.

- **New migration, pure data**: `0024_preventive_maintenance_checklist_
content.sql` adds 16 `component_types` (e.g. Water Heater, Sprinkler
  System, Standpipe/Fire Hose, Fire Pump, Sump Pump, Elevator Cab,
  Security Cameras, GFCIs, Smoke/CO Detectors — under area types that
  already existed) and 37 new `inspection_check_library` checks with
  their `check_applicability_rules` (33 tied to a specific
  area/component pair, 4 area-level checks that apply to a whole area
  regardless of which components are confirmed there). See
  `DATABASE_SCHEMA.md`'s Migration History for the full breakdown and
  local verification counts.
- **Gap-checked against the existing library first**: every item in the
  source checklist was compared against migrations `0005`/`0008` before
  writing anything new, so nothing already covered (e.g. most Roof,
  Hallway, Electrical Room, and general Apartment/Unit checks) was
  duplicated — only genuine gaps were added.
- **"Compliance & Documentation" section deliberately deferred**:
  certificate expirations (boiler, elevator, fire safety), FISP/LL11
  status, and log/vendor-report review are property-level document and
  date tracking, not a physical checkbox-at-a-location item — they
  don't fit the area/component/check model this table uses. Scoped as
  a separate future feature instead (see `PRODUCT_SPEC.md`'s deferred
  list) rather than forced in here.
- **Locally verified, not yet live**: applied cleanly against a
  disposable local Postgres 16 database replaying the full migration
  chain from scratch — row counts matched expectations exactly at every
  step, with zero orphaned checks (a check with no applicability rule,
  which would silently never appear on any checklist) and zero
  malformed rules. Still needs to be run in the Supabase Dashboard SQL
  Editor against the live project, the same manual step used for every
  migration so far, before any of this content is available in the
  actual app.

### Phase 14: Compliance Documents

The piece of the checklist the user shared that was deliberately left
out of Phase 13 — certificate expirations, permit status, FISP/LL11
filings — because it's property-level document/date state, not a
per-location checkbox item, and doesn't fit the area/component/check
model the checklist itself uses. It's now its own feature.

- **New table and screen**: `compliance_documents`
  (`supabase/migrations/0025`) tracks, per property: a title, a document
  type (boiler certificate, elevator certificate, fire safety permit,
  FISP/LL11 filing, or other), an issuing authority, an expiration date,
  notes, and at most one attached photo/scan. A new "Compliance
  documents" entry on the property detail screen opens the list, with a
  red count badge when anything needs attention (expired or expiring
  within 30 days).
- **Status is derived, not just stored**: a document with an expiration
  date automatically shows as "Valid," "Expiring soon," or "Expired"
  based on today's date — nobody has to remember to update a status
  field for it to stay accurate. "Renewal in progress" and "Not
  applicable" (e.g. a property with no elevator) are the two states set
  manually, since a date can't express either one.
- **Read is portfolio-wide, writes are gated**: any role can see what's
  expiring across a property. Adding, editing, deleting, and attaching a
  photo/scan are restricted to org_admin/portfolio_manager/supervisor —
  the same management role set already used for vendors, findings, and
  corrective actions.
- **Photo/scan capture is online-only, by design**: unlike inspection
  photos (captured in the field, offline-first, encrypted local mirror),
  attaching a certificate photo is an admin/office task done with a
  normal connection — no offline queue was built for it. See migration
  0025's header comment for the full reasoning.
- **Locally verified, not yet live**: a dedicated positive/negative RLS
  test suite confirmed org isolation, role gating (management roles can
  write, a plain inspector role cannot), rejection of a document
  pointed at a different org's property, check-constraint enforcement,
  and the `updated_at` trigger firing correctly. Still needs to be run
  in the Supabase Dashboard SQL Editor against the live project before
  it's usable in the actual app.
- **Explicitly still deferred**: incident/maintenance log review and
  vendor-report currency tracking — recurring review workflows rather
  than a single document with an expiration date, and a candidate for a
  distinct future feature rather than a fit for this table.

### Phase 15: Compliance Tasks

The recurring-review half of the same source checklist section that
Phase 14 didn't cover: log reviews and vendor-report reviews aren't a
single document with an expiration date, they're "check this on a
schedule and record that it happened" — so they get their own table
and their own append-only history instead of being force-fit into
`compliance_documents`.

- **New tables and screen**: `compliance_tasks` and
  `compliance_task_completions` (`supabase/migrations/0026`). A task has
  a type (log review, vendor report review, or other), a title,
  optional description, a review frequency (weekly, monthly, quarterly,
  annual), and — only for vendor-report-review tasks — a linked vendor.
  A new "Compliance tasks" entry on the property detail screen opens the
  list, with a red count badge when anything is due soon, overdue, or
  has never been reviewed.
- **Completions are an append-only log, not an edit**: recording a
  review inserts a new `compliance_task_completions` row (who, when,
  optional notes) rather than updating a status field on the task
  itself — there's no update policy on that table at all. A correction
  is a new row, the same immutability philosophy already used for
  `audit_log`. The full history is viewable per task.
- **Due status is derived, not stored**: nothing on `compliance_tasks`
  records whether it's "overdue" — that's computed at read time from
  the frequency and the latest completion's timestamp, the same
  derived-status approach Phase 14 used for document expiration. A task
  with no completion at all shows as "Never reviewed" rather than a
  false "OK."
- **Read is portfolio-wide, writes are gated**: any role can see the
  task list and due status across a property, and can record a
  completion. Creating, editing, and deleting tasks are restricted to
  org_admin/portfolio_manager/supervisor, matching every other
  management-gated entity in the app.
- **Cross-org foreign key checks on two references, not one**: like
  Phase 14's `property_id` check, `compliance_tasks`' insert/update
  policies also verify that a linked `vendor_id` belongs to the same
  organization as the task — a caller can't stamp their own org
  correctly while pointing the vendor reference at a different org's
  vendor.
- **Deliberately online-only and not auto-seeded**: recording a
  completion is an admin/office action with a normal connection, so
  there's no offline queue for it (same reasoning as Phase 14's photo
  attachment). Tasks also aren't auto-created from anything — an admin
  sets up the recurring tasks they actually want tracked for each
  property, rather than the app guessing a schedule for them.
- **Locally verified, not yet live**: a dedicated positive/negative RLS
  test suite confirmed org isolation, role gating (management roles can
  create/edit/delete tasks, a plain inspector role cannot, but any role
  can record a completion), rejection of a task or completion pointed at
  a different org's property/vendor/task, both directions of the
  vendor/task-type check constraint, and the `updated_at` trigger firing
  correctly. Still needs to be run in the Supabase Dashboard SQL Editor
  against the live project before it's usable in the actual app.

### Phase 16: Dashboard Compliance Rollup

- **New "Compliance" section on the Dashboard tab**: two portfolio-wide
  counts — documents needing attention (expired or expiring soon) and
  tasks needing attention (overdue, due soon, or never reviewed) — next
  to the existing Inspections/Open findings/Corrective actions sections.
  Respects the same single-property filter as the rest of the dashboard.
- **No new migration, no new derived-status logic**: both counts reuse
  `computeDisplayStatus()` and `computeTaskDueStatus()` exactly as built
  in Phases 14 and 15, just fetched and filtered across every property in
  the organization (or one, when filtered) instead of one property's own
  detail screen.
- **Routing works differently from every other section here**: since
  there's no portfolio-wide compliance list screen, tapping either row
  opens that specific property's "Compliance documents"/"Compliance
  tasks" screen when the dashboard's property filter is narrowed to one
  property, or the Properties tab (so a property can be picked) when set
  to "All properties."

### Phase 17: Phase 10 security-roadmap follow-up (aal2 hardening, revoked-device check)

Closes the two concretely code-buildable gaps `TEST_PLAN.md`'s Phase 10
section flagged as not yet true: per-action MFA enforcement at the
database layer, and a revoked device actually being stopped from
continuing to sync. Everything else still open in that section (rate
limiting/CAPTCHA, Play Integrity's enforce mode) is Supabase Auth
dashboard configuration or external Google Cloud/Play Console linkage,
not app code, and stays out of scope here.

- **Per-action `aal2` enforcement, scoped narrowly, not broadly**:
  `supabase/migrations/0027_aal2_admin_hardening_and_device_status.sql`
  adds a new `current_user_has_aal2()` helper (reads the `aal` claim off
  `auth.jwt()`, `security definer` so it can be called directly from an
  RLS policy — see the bug note below) and requires it, in addition to
  the existing `org_admin` check, at exactly the access points that are
  **org_admin-exclusive** today: the organization settings update, the
  admin branch of the profile-editing policy, the org-wide branch of the
  devices view policy, the `security_events` view policy, `revoke_device()`,
  the critical-check-deactivation branch of
  `set_inspection_check_status()` and
  `set_property_check_assignment_status()`, the past-scheduled-inspection
  admin branch of `set_inspection_status()` and `delete_inspection()`,
  and `delete_property()`. Deliberately **not** applied to the broader
  `org_admin`/`portfolio_manager`/`supervisor` management set used
  elsewhere (vendors, findings, corrective actions, compliance
  documents/tasks) — only `org_admin` has a mandatory MFA enrollment path
  today (Phase 10), so requiring aal2 on the broader set would lock out
  portfolio_manager/supervisor entirely, which is a product change, not a
  hardening fix.
- **Real bug found and fixed while building this**: a first version of
  `current_user_has_aal2()` was a plain (non-definer) function. Calling
  `auth.jwt()` directly from an RLS policy as `authenticated` failed with
  `permission denied for schema auth` — but the identical function,
  called from inside another `security definer` function (`revoke_device()`,
  `delete_property()`, etc.), silently inherited that outer function's
  owner-level privileges and appeared to work. The bug only surfaced when
  called straight from an RLS policy's `using` clause. Fixed by making
  `current_user_has_aal2()` `security definer` too, matching
  `current_organization_id()`/`current_user_is_org_admin()`'s existing
  pattern.
- **A revoked device now actually gets signed out, not just left alone**:
  previously, revoking a device server-side did nothing to that device's
  existing client session — it kept working until the token naturally
  expired. `device-registration.ts` now persists the device's own row id
  locally at registration time, and a new `checkThisDeviceRevoked()`
  checks that row's `status` on demand. Three call sites: `offline-sync.ts`
  checks it before every sync attempt (both the single-inspection and
  batch entry points) and aborts the sync with a `deviceRevoked` flag
  instead of attempting it; the Sync Status screen's "Sync now" button
  shows a "This device has been revoked…" message and signs out
  immediately when that flag comes back; and the main app layout polls
  every 45 seconds while online and shows a blocking alert ("Device
  revoked") that signs out on acknowledgment, so a revoked device doesn't
  have to wait for its next sync attempt to find out. This is a
  client-side check (RLS on ordinary tables was deliberately left
  unchanged — device status isn't a general-purpose access gate, just a
  targeted sign-out trigger), so it does not by itself invalidate the
  underlying Supabase session token; a determined attacker with the raw
  token could still make direct API calls, only the app's own UI/sync
  paths honor it. A true "revoked device can't touch the database at all"
  guarantee would need every table's RLS to join out to `devices.status`,
  which is a much bigger, more invasive change than this phase's scope.
- **Locally verified, not yet live**: a dedicated test script exercised
  all eight hardened access points at both `aal1` (expect rejection with
  the specific new error) and `aal2` (expect success), plus confirmed the
  self-service branches (profile self-edit, viewing your own device) are
  completely unaffected by aal at any level. The full pre-existing Phase
  10/14/15 device and compliance test suites were also re-run against the
  same rebuilt database with this migration applied, with zero
  regressions. Not yet run against the live Supabase project — needs to
  be applied via the SQL Editor, same as every prior migration in this
  list, and **migration `0026` (Phase 15, compliance tasks) is still
  pending there too**.
- `npm run lint`, `npm run format:check`, `npx tsc --noEmit`, and
  `expo export --platform android` all pass.

### Phase 18: field-derived checklist expansion

The user supplied a set of their own past inspection walkthrough
templates (a "Building Walkthrough Checklist"/"Capital Plan" template
pair) and completed field-inspection notes from real properties. Reading
through them against the standard library built in 0005/0008/0024
surfaced real gaps — categories called out in every template reviewed,
or actual defects a real inspection flagged, that had nowhere to attach
in the app. `supabase/migrations/0028_field_derived_checklist_expansion.sql`
closes those gaps. Everything here is data, exactly like 0005/0008/0024
— no schema change, no new `inspection_type`, no app code change;
`generate_property_checklist()` already evaluates new library content
generically.

- **One validated finding first**: the P1/P2/P3/P4 priority scale
  already in the app (life safety / code compliance / operational /
  cosmetic) matches the real field reports' own priority breakdown
  exactly, down to the wording. No change needed there — it was worth
  confirming rather than assuming.
- **4 new area types**: Gas Meter Room, Telecom/IT Room, Amenity Space,
  and Office (superintendent's office/staff room) — each is its own
  named section in every template reviewed, or a recurring location in
  the real field notes, with nothing in the existing library to attach
  it to.
- **23 new component types**, the notable ones: a Fire Alarm Panel
  (Lobby) and Pull Stations (Hallway, Stairwell) — fire alarm had zero
  representation before this, despite being in every template and an
  actual field finding about pull-station color-coding; a Backflow
  Preventer/RPZ and Ejector Pit/Pump (Basement) and House/Booster Pumps
  (Boiler Room) — a real report flagged an RPZ with an expired annual
  test tag; a Gravity Tank, Cooling Tower, Chemical Treatment Tank, and
  Waste Riser Vents (Roof) — a real report flagged actual cracking/
  corrosion at a cooling tower's dunnage structure; a Trash Chute
  (distinct from the compactor itself) and Recycling Baler
  (Garbage/Compactor Room) — a real finding was specifically a trash
  chute hopper door not self-closing; a Sidewalk Elevator/Vault
  (Sidewalk) — an actual P2 code-compliance finding (masonry cracking/
  corrosion at a sidewalk vault enclosure) had nowhere to attach; and an
  Access Control/Lockbox (Entrance) and Access Door Lockbox (Roof) —
  standardizing lockbox/lock codes across a building's access points was
  one of the single most repeated findings across the real reports
  reviewed.
- **25 new component-level checks**, plus a new fire-extinguisher
  tag-currency check (`Confirm the fire extinguisher's monthly
inspection tag reflects a current, non-expired inspection`) linked
  across all 5 locations that component type already exists at (Storage
  Room, Boiler Room, Electrical Room, Hallway, Basement) the same way
  0024 linked its own checks across multiple locations, plus a matching
  standpipe tag-currency check.
- **11 new area-level checks**, covering a theme that runs through the
  real field reports but didn't fit any single component: utility/
  mechanical rooms (boiler room, elevator machine room, gas meter room,
  telecom/IT room, basement) being used for unauthorized storage, egress
  corridors and stairwells blocked by residents' personal belongings,
  daisy-chained extension cords/unsafe temporary wiring, and two
  NYC-specific egress-marking checks (photoluminescent stair markings,
  apartment door jamb markings) that were in the original template but
  never became checks.
- **Locally verified, not yet live**: replayed the full migration chain
  from scratch through 0028 against a disposable Postgres 16 database
  with zero errors, then a dedicated smoke test confirmed
  `generate_property_checklist()` correctly assigns new component-level
  checks, new area-level checks, and the fire-extinguisher tag-currency
  check at a second linked location (Boiler Room, not just the location
  it was directly inserted against) — all end to end, not just as
  library rows. The full pre-existing aal2-hardening test suite (Phase 17) was also re-run against the same rebuilt database with zero
  regressions, confirming this purely-additive migration didn't disturb
  anything access-control-related. Not yet run against the live Supabase
  project — needs to be applied via the SQL Editor, and migrations
  `0026` and `0027` are both still pending there too.
- **Explicitly deferred to a future phase**: the user's "Building
  Equipment Inventory" and "Capital Improvement Project Estimates"
  templates, also reviewed this round, describe a different capability
  entirely — an asset registry with age/condition/remaining-useful-life
  and a multi-year ($) capital budget per item, not a location-based
  checklist item. Scoped as its own future feature rather than forced
  into this migration's shape, per the user's own direction.

### Phase 19: fix a real area-level checklist duplication bug (photoluminescent-marking check appearing multiple times)

The user reported seeing several identical "photoluminescent egress path
markings" checklist items in an actual inspection and asked whether any
other items were repeated. Two rounds of read-only diagnostic SQL the
user ran themselves (`scratch_duplicate_diagnostic.sql`, then
`scratch_duplicate_diagnostic_2.sql`) ruled out the two more benign
explanations first — a seed migration re-run (would show two distinct
`inspection_check_library` ids; it didn't) and multiple same-named
locations (the duplicates were confirmed on one single
`property_location_id`) — before isolating a real, reproducible bug in
`generate_property_checklist()` (0009, Phase 4), present since that
migration and affecting every area-level check ever added, including
0024's and 0028's own.

- **The bug**: `generate_property_checklist()`'s `LEFT JOIN` to
  `location_components` fans out one candidate row per confirmed
  component at a location. That's correct for a component-level check,
  but the area-level branch of its matching rule doesn't depend on which
  fanned-out row it's evaluated against — it matches every one of them.
  The function then inserted the fanned-out component id verbatim as
  `location_component_id` regardless of which branch actually matched, so
  a location with N confirmed components got N duplicate assignment rows
  for the same area-level check instead of the one it should ever get.
  Reproduced locally against a disposable Postgres 16 database: a
  Stairwell location with 3 confirmed components generated 3 duplicate
  rows apiece for both of 0028's Stairwell area-level checks, while every
  component-level check on the same location correctly generated exactly
  1 row each.
- **The fix**, `supabase/migrations/0029_fix_area_level_check_duplication.sql`:
  `location_component_id` is only ever set to the fanned-out component id
  when the match was actually component-level; otherwise it's `null`,
  matching an area-level rule's own shape. Same function signature, same
  exclude-rule handling, same `ON CONFLICT` target, same snapshot/audit
  logic — nothing else changes.
- **Verified locally, including a wrinkle worth calling out**:
  reproduced the bug cleanly (repro → apply fix → verify, in one
  continuous session against a freshly rebuilt database so the sequence
  couldn't get confused with itself), confirmed a brand-new location with
  multiple confirmed components now generates every check exactly once,
  and confirmed the fix does **not** retroactively repair already-corrupt
  data — re-running `generate_property_checklist()` on an already-
  duplicated location doesn't collapse the existing duplicates. It's also
  not quite the inert no-op it might sound like: because the old
  duplicate rows carry a non-null `location_component_id` and the
  partial unique index treats that as a distinct key from the correct
  (`null`) shape, the fixed function adds **one additional**,
  correctly-shaped row alongside the old ones the first time it runs
  post-fix (observed directly: a location with 3 pre-existing duplicates
  went to 4, not 3) — it then stabilizes there. Also re-ran the full
  Phase 17 aal2-hardening suite and the Phase 18 field-expansion smoke
  test against the same rebuilt database with zero regressions.
- **Two one-time cleanup scripts for the live database** (not
  migrations — they operate on already-accumulated data, so they don't
  belong in `supabase/migrations/`, and are meant to run once each, in
  this order, after 0029 is applied):
  - `scratch_duplicate_snapshot_item_cleanup.sql` fixes what's actually
    visible right now: duplicate line items already frozen into a
    still-open (`scheduled`/`in_progress`) inspection's snapshot, since
    `start_inspection()` copies every active duplicate assignment 1:1
    into `inspection_snapshot_items` — this is the direct fix for the
    "several photoluminescent items in the inspection" symptom itself.
    `completed` inspections are never touched (a historical record); a
    duplicate group is only auto-collapsed when at most one of its items
    already has real recorded data (status, observation, a photo, a
    finding) — 2+ items with real data are left alone and reported as
    needing manual review, since picking one to keep is a human call.
  - `scratch_duplicate_assignment_cleanup.sql` fixes the underlying
    `property_check_assignments` template so future/re-generated
    checklists don't keep the duplication going. Only rows from an
    area-level rule are ever touched (a location with two confirmed
    components of the _same_ type legitimately getting two separate
    component-level rows is correct, not a bug). A duplicate row already
    referenced by `inspection_snapshot_items` is never deleted — the only
    foreign key onto this table has no `ON DELETE` clause, so that's
    enforced by the database regardless, not just by this script's own
    care. Running the item-level script first measurably shrinks how
    many groups this one has to leave flagged, since collapsing a
    duplicate item can free up the assignment row it referenced.
  - Both scripts were verified locally against 7 constructed scenarios
    covering every keeper-selection branch and conflict case: plain
    duplicates with no inspection yet, a location already re-generated
    once post-fix (old rows plus one new correctly-shaped row), a
    location whose only pre-existing inspection snapshotted just one of
    the eventual duplicates, two separate inspections each independently
    referencing a different duplicate (genuine conflict), all duplicates
    frozen into one single inspection at once (the realistic, common
    case), and two variants that confirm real recorded data (a filled-in
    observation, an attached photo) always blocks an automatic delete.
    Both scripts are idempotent — safe to run again, they just find
    nothing left to do.
- **Live status**: migrations `0026`, `0027`, `0028`, and `0029` have all
  now been run against the live Supabase project. The two one-time
  cleanup scripts (`scratch_duplicate_snapshot_item_cleanup.sql`, then
  `scratch_duplicate_assignment_cleanup.sql`, in that order) still need
  to be run against it — their own reports will say whether anything is
  left needing manual review.
- No app code changes this phase — `npm run lint`, `npm run format:check`,
  `npx tsc --noEmit`, and `expo export --platform android` all still pass
  (re-confirmed, since app code is untouched but the standing rule is to
  re-run the full gate before delivering regardless).

### Phase 20: report-screen entry-button relabel

While manually walking the Phase 19 test plan, the "Email / share
report" test item turned out hard to find — not because the screen was
missing, but because the button that leads to it
(`src/app/(app)/inspections/[id]/index.tsx`'s walkthrough-screen footer)
always read "Review & submit," even for an inspection that's already
`completed` and fully read-only, where there's nothing left to submit.
It still correctly navigated to the review screen, which then correctly
showed a "View report →" link once it detected the inspection was
already submitted — so this was a discoverability rough edge, not a
broken code path. Fixed by relabeling that one button to "View report"
whenever the screen's existing `isReadOnly` flag (already computed from
`inspection.status === 'completed'`) is true, leaving "Review & submit"
exactly as before for an inspection still in progress. No other
behavior changes — same `onPress`, same destination route.

Confirmed device-tested and working after the relabel: the Report
screen's "Email / share report" button opens the native share sheet
with the PDF, including Mail/Gmail as a destination.

- `npx tsc --noEmit`, lint, `format:check`, and
  `expo export --platform android` all pass.

### Phase 21: weekly compliance-task due-soon boundary fix

An independent verification pass (a separate AI tool run against a
sibling snapshot of this project, never touching the real app — see
Phase 23's intro below for the full context on that pass) caught a
real boundary bug in `computeTaskDueStatus()`
(`src/lib/compliance-task-types.ts`): `DUE_SOON_WINDOW_DAYS` was a flat
7 days regardless of frequency, which is exactly as long as the
`weekly` frequency itself. A weekly task marked complete today has its
next-due date exactly 7 days out, and `7 <= 7` is true — so it read
"Due soon" the instant it was completed, instead of "OK." Confirmed
directly by reading the function: `monthly`/`quarterly`/`annual` were
never affected (their frequencies are 30/90/365 days, comfortably
longer than any reasonable due-soon window).

Fixed by giving each frequency its own due-soon window
(`COMPLIANCE_TASK_DUE_SOON_WINDOW_DAYS`) instead of one flat constant:
monthly/quarterly/annual keep the existing 7-day window (unchanged
behavior), and weekly gets a 2-day window, so a freshly-completed
weekly task now reads "OK" until it's genuinely close to due again.

Verified locally with a standalone Node harness (`tsx`, with
`react-native` stubbed out since `@/theme` pulls it in transitively for
`Platform.OS`) that imports and runs the real, unmodified
`compliance-task-types.ts` — no mocking of the function under test
itself. 10 cases: a weekly task completed just now (now `ok`, was the
bug), at 4/5/6/8 days ago (`ok`/`due_soon`/`due_soon`/`overdue`,
confirming the new 2-day window's edges), monthly/quarterly/annual
completed just now (still `ok`, confirming no regression), never
reviewed, and the `monthly` frequency-days constant unchanged at 30.
All 10 passed.

- `npx tsc --noEmit`, lint, `format:check`, and
  `expo export --platform android` all pass.

### Phase 22: silent device-registration failure fix

The same independent verification pass found `registerThisDevice()`
(`src/lib/device-registration.ts`) would return `{ error: null }` --
i.e. report success -- for a response that had neither `error` nor
`data?.error` set, but also no usable `data?.device?.id`. Confirmed
directly by reading the function: a misconfigured or malformed Edge
Function response (its own default boilerplate reply, an empty object,
`null`, or a `device` object missing `id`) was silently treated as a
successful registration, without ever persisting a device row id via
`SecureStore`. That matters beyond just a missing confirmation --
`checkThisDeviceRevoked()` (Phase 17) has nothing to check without a
stored device id, so it would keep failing open (never detecting a
revocation) for that install indefinitely, until the next successful
registration.

Fixed by treating a missing or empty `data?.device?.id` as an error
case too (new `malformed_response` entry in `DEVICE_ERROR_MESSAGES`),
surfaced through the same `deviceRegistrationError` /
`retryDeviceRegistration` UI this screen already has for every other
registration failure -- no new UI needed, just closing the gap in what
counts as "actually succeeded."

Verified locally with a standalone Node harness (`tsx`, with
`expo-secure-store`, `expo-crypto`, and the `@/lib/supabase` singleton
replaced by local stand-ins so the test controls exactly what
`supabase.functions.invoke()` returns) that imports and runs the real,
unmodified `registerThisDevice()`. 7 cases: the 4 malformed-response
shapes the verification pass's own test harness had flagged (`null`,
`{}`, `{ message: "Hello from Functions!" }`, `{ device: {} }`) now all
return an error and persist no device id (previously: silent `{ error:
null }` and no persisted id for all 4); a genuinely valid response
still succeeds and persists the device id; an explicit server-side
rejection (`device_slot_limit_reached`) still surfaces its existing
friendly message; a transport-level error still surfaces as an error.
All 7 passed.

- `npx tsc --noEmit`, lint, `format:check`, and
  `expo export --platform android` all pass.

### Phase 23: offline cross-organization tenant-isolation fix

An external, independent verification/audit pass was run against a
full snapshot of this project (copied by the user into a sibling
`2026-09-12_capex-inspection-pro_v1.0.0_verification` folder by a
separate AI tool, per their own explicit instruction to that tool never
to touch the real app folder). It included a small Node-based test
harness executing real, copied source modules with native APIs mocked
(SQLite via Node's in-memory engine, not the native driver) -- 23 of 29
cases passed; the 6 failures are exactly the bugs fixed in this phase
and the two above. Every finding checked directly against this
project's actual source turned out to be accurate; see
`VERIFICATION_REPORT.md`'s own findings list (not delivered as part of
this app -- it's the other tool's output) for the full writeup.

The most serious of the three: `getAllLocalInspectionHeaders()`
(`src/lib/offline-db.ts`) did a plain `SELECT * FROM
local_inspection_headers` with **no `organization_id` filter at all**,
even though that column has always existed on the table. This is what
the Inspections list (`src/app/(app)/inspections/index.tsx`) falls back
to when there's no network and no successful online fetch -- so a
device previously signed in as one organization's user, now signed in
as a different organization's user (a shared or reissued device), could
see the first organization's mirrored inspections in that offline
fallback list. Made worse by `auth-context.tsx`'s `signOut()`, which
only ever called `supabase.auth.signOut()` and never cleared the local
mirror at all, so old data had no way to age out on its own.

Two independent fixes, since either gap alone could reintroduce this
leak:

- **The query itself is now organization-scoped.**
  `getAllLocalInspectionHeaders()` takes an `organizationId` and adds
  `WHERE organization_id = ?`. Since there's no network to ask "what
  organization am I in?" at exactly the moment this fallback runs, a
  new `current-organization-cache.ts` module caches the signed-in
  user's own `organization_id` (via `expo-secure-store`) once per
  session, written in `auth-context.tsx`'s existing post-auth effect
  (right alongside device registration) and cleared on sign-out.
  `inspections/index.tsx` reads this cache for the offline fallback; if
  it's ever unset (only possible on a very first fully-offline app open
  immediately after a fresh sign-in, before that cache write has run),
  it now shows an explicit "reconnect to enable your offline copy"
  empty state rather than falling back to unfiltered. The sync engine's
  own internal sweep (`syncAllInspections`, which must drain every
  locally dirty row regardless of organization) keeps working through a
  new, deliberately unscoped `getAllLocalInspectionHeadersForSync()` --
  safe because every push it attempts still goes through Supabase RLS,
  which would simply reject a stray other-organization row rather than
  let it through.
- **`signOut()` now clears the local mirror.** While fixing this,
  found `resetLocalMirror()` (offline-db.ts's own diagnostics/
  device-reset helper) had a second, adjacent bug: it dropped
  `local_locations`, `local_items`, `local_photos`, and `sync_queue`,
  but never `local_inspection_headers` itself -- so even a manual
  device reset left every inspection header behind. Fixed to drop all
  five, and `signOut()` now calls it on every completed sign-out.

  Signing out isn't allowed to silently discard someone's not-yet-
  synced offline work just to close this gap, so `signOut()` first
  checks `getSyncOverview()`'s pending/conflict counts. With nothing
  pending, it signs out and clears the mirror immediately, same as
  before this phase from the user's point of view. With something
  pending, it does _not_ sign out yet -- it returns `{ blocked: true,
pendingCount }` instead, so the caller can ask first. The Settings
  screen's "Sign out" button (the one normal, everyday sign-out path)
  is the one place that asks: an Alert naming how many unsynced changes
  exist, with "Cancel" (go sync first) or "Sign out anyway" (which
  retries with `{ force: true }`, discarding them along with the
  mirror). Every other sign-out call site in the app --
  device-registration-error screen, the periodic device-revoked auto
  sign-out, a revoked-device detection during manual sync, and "Sign
  out instead" during MFA setup/challenge -- now explicitly passes
  `{ force: true }`, since those are security/error flows where
  blocking on a confirmation would be more confusing than helpful, not
  everyday voluntary sign-outs.

Verified locally with a standalone Node harness (`tsx`, backed by
Node's built-in `node:sqlite` in place of the native `expo-sqlite`
driver -- the same technique the external verification pass used) that
imports and runs the real, unmodified `offline-db.ts` functions. 6
cases: an org-A-only offline list contains only org A's inspection; an
org-B-only list excludes org A's (previously: both organizations'
inspections were returned regardless of which was asked for); an
organization with no mirrored data gets an empty list rather than
everything; the sync engine's unscoped variant still sees both
organizations' rows (draining sync must not skip anything); and
`resetLocalMirror()` both leaves the `local_inspection_headers` table
in place and, this time, actually empties it (previously: rows from a
prior reset were left behind indefinitely). All 6 passed. The
sign-out warn/force branching itself is UI-level React state wiring
around these same, already-verified functions -- checked by inspection
and by the full quality gate (`tsc --noEmit` catches every call site's
signature), not by an additional standalone harness; still needs a
real on-device pass (see TEST_PLAN.md's new Phase 23 section).

- `npx tsc --noEmit`, lint, `format:check`, and
  `expo export --platform android` all pass.
