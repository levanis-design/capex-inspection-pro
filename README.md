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
completed, and `PRODUCT_SPEC.md` for the specification currently under
review. Phase 0 (environment setup) is complete; Phase 1 (product
specification) is in progress.

## Tech stack

- React Native + Expo + TypeScript
- Expo Router
- Supabase (Auth, PostgreSQL with Row Level Security, Storage)
- Local SQLite (offline-first inspections) with a sync queue
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
- A physical Android phone for testing (with Expo Go, initially)
- VS Code (recommended, not required)

## Local setup

> The application code itself has not been scaffolded yet — that happens in
> Phase 2, after the product specification is approved. This section will
> be filled in with exact `npx create-expo-app` / install / run instructions
> at that point.

1. Clone the repository.
2. Copy `.env.example` to `.env` and fill in your own Supabase project URL
   and anon key (found in the Supabase dashboard under Project Settings →
   API). Never commit `.env`.
3. (Phase 2 onward) Install dependencies and start the Expo dev server.

## Security notes

- No passwords, private keys, service-role keys, access tokens, or personal
  account information are ever committed to this repository.
- The Supabase `service_role` key is never used inside the mobile app; it is
  only used, if at all, from a secure server-side context.
- Row Level Security is enforced at the database level for all multi-tenant
  data — organizations cannot see each other's data even if the frontend
  has a bug.

## Data used during development

Only fictional or sanitized data is used in this repository and in any
sample content (e.g. "123 Example Street", "Sample Multifamily Property",
"Unit 3A", "Example Boiler No. 1"). No real resident, employee, or
proprietary company data is ever included.
