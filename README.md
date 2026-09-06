# Capex Inspection Pro

A mobile-first inspection and preventive-maintenance application for
multifamily property managers, facilities teams, construction managers,
building owners, maintenance supervisors, and field technicians.

Capex Inspection Pro is a **documentation and workflow tool**. It helps
teams establish properties and systems, build property-specific inspection
programs, perform field inspections, document and prioritize deficiencies,
assign responsibility, track corrective work to completion, and produce
professional PDF reports and portfolio-level compliance/preventive-
maintenance dashboards. It does **not** replace inspections or
certifications that must be performed by licensed or qualified
professionals, and it does not claim code compliance based on checklist
completion alone.

Operating standard: **"Clean, safe and fully operational."**
Default decision principle: **"Repair before replacement unless condition,
safety, compliance, or lifecycle evidence supports replacement."**

## Status

This project is in early development. See `CHANGELOG.md` for what has been
completed, and `PRODUCT_SPEC.md` / `DATABASE_SCHEMA.md` for the approved
specification. Phase 0 (environment setup) and Phase 1 (product
specification) are complete. Phase 2 (application foundation — this
scaffold) is in progress.

## Tech stack

- React Native + Expo (SDK 57) + TypeScript (strict mode)
- Expo Router (file-based routing, typed routes)
- Supabase (Auth, PostgreSQL with Row Level Security, Storage)
- Local SQLite (offline-first inspections) with a sync queue — Phase 6
- GitHub for version control, EAS Build for Android builds
- Target platform: Android first (Google Play), with iOS and a web admin
  interface planned for later

## Project documentation

- `PRODUCT_SPEC.md` — product specification: scope, user journeys, screens,
  entities, permissions, offline strategy, acceptance criteria
- `DATABASE_SCHEMA.md` — database entities, relationships, RLS policies,
  migration history
- `TEST_PLAN.md` — acceptance criteria and test checklist per feature
- `CHANGELOG.md` — history of what's been built, in what phase

## Prerequisites (developer machine)

- Node.js (verified working: v24.14.0)
- Git (verified working: 2.53.0)
- A GitHub account with access to this repository
- A Supabase account and project (for Auth/Database/Storage)
- A physical Android phone for testing, with the **Expo Go** app installed
  from the Play Store
- VS Code (recommended, not required)

## Local setup

1. Copy `.env.example` to a new file named `.env` in the project root, and
   fill in your Supabase project URL and anon/publishable key (found in
   the Supabase dashboard under Project Settings → API). **Never commit
   `.env`** — it's already excluded via `.gitignore`.
2. Install dependencies:

   ```
   npm install
   ```

3. Start the Expo development server:

   ```
   npm start
   ```

4. A QR code appears in the terminal. Open the **Expo Go** app on your
   Android phone and scan it (Expo Go has a built-in scanner on its home
   screen). Your phone and computer need to be on the same Wi-Fi network.
   The app will load on your phone and hot-reload as you edit files.

## Available scripts

| Command                | Purpose                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `npm start`            | Start the Expo dev server (scan the QR code with Expo Go)                              |
| `npm run android`      | Start the dev server and try to launch directly on a connected/emulated Android device |
| `npm run lint`         | Check code style and common mistakes (ESLint)                                          |
| `npm run format`       | Auto-format all files (Prettier)                                                       |
| `npm run format:check` | Check formatting without changing files (used in CI later)                             |
| `npm run typecheck`    | Check for TypeScript type errors without building                                      |

## Project structure

```
src/
  app/               # Screens and layouts only (Expo Router file-based routing)
    _layout.tsx      # Root layout: error boundary, auth provider, route protection
    (auth)/          # Sign-in / sign-up — shown when signed out
    (app)/           # Dashboard / Properties / Inspections / Settings tabs — shown when signed in
  components/        # Reusable, presentation-only UI components
  lib/               # Supabase client, auth context, env config, logging, secure storage
  theme/             # Colors, spacing, typography — the single source of design-system values
```

Only screens and layout files belong directly in `src/app` — everything
else (business logic, reusable UI, data access) lives in `src/components`
or `src/lib` and is imported into a screen. This keeps route files thin and
easy to navigate.

## What Phase 2 includes (and what it doesn't yet)

**Included:** Expo + TypeScript + Expo Router scaffold; the color/spacing/
typography design system from `PRODUCT_SPEC.md`; environment
configuration with fail-fast validation; a Supabase client using
Keystore/Keychain-backed secure storage for the session (not plain-file
storage); a working email/password sign-up and sign-in flow with
protected routing (`Stack.Protected`) between signed-out and signed-in
screens; a global error boundary; a small structured logger; ESLint +
Prettier + strict TypeScript checks, all currently passing clean.

**Not yet included (later phases, by design):** the `organizations` /
`profiles` database tables and the trigger that turns a sign-up into a
Free-plan organization (Phase 3); device registration and Play Integrity
verification (Phase 2 security follow-up / Phase 10); the actual
Dashboard, Properties, and Inspections screens, which currently show
placeholder text naming the phase that replaces them.

## Known items

- `npm audit` reports vulnerabilities in transitive build-tooling
  dependencies (Metro/`xcode`/`uuid`, pulled in via Expo's own config
  tooling), not in application runtime code. Forcing the fix would
  downgrade Expo to an older SDK, which we don't want. Revisit as part of
  the Phase 10 dependency audit, once newer upstream releases are
  available.
- The Expo template's own `LICENSE` file (MIT, copyright Expo/650
  Industries) was removed — it described the starter template, not this
  private, proprietary application.

## Security notes

- No passwords, private keys, service-role keys, access tokens, or personal
  account information are ever committed to this repository.
- The Supabase `service_role` key is never used inside the mobile app; it is
  only used, if at all, from a secure server-side context.
- Row Level Security is enforced at the database level for all multi-tenant
  data — organizations cannot see each other's data even if the frontend
  has a bug.
- Auth session tokens are stored via `expo-secure-store` (Keystore on
  Android), never in plain-file storage — see `src/lib/secure-storage.ts`.

## Data used during development

Only fictional or sanitized data is used in this repository and in any
sample content (e.g. "123 Example Street", "Sample Multifamily Property",
"Unit 3A", "Example Boiler No. 1"). No real resident, employee, or
proprietary company data is ever included.
