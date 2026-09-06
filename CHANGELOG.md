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

### Notes

- Phase 0 (discovery and environment setup): complete.
- Phase 1 (product specification): approved.
- Phase 2 (application foundation): scaffold complete — auth shell,
  design system, Supabase connection, error handling, logging, and
  lint/format/typecheck all working. Property/inspection data and the
  organization-creation trigger are Phase 3, not yet implemented.
