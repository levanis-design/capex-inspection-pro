# Product Specification — Capex Inspection Pro

**Status:** Draft v0.2 — Phase 1, awaiting your approval. Revises v0.1 to
make plan entitlement, device registration, and a location-driven
checklist hierarchy part of the MVP (previously the commercial pieces were
deferred and the checklist model was a flatter template). No application
code will be written until this document is approved.

---

## 1. Product Overview & Positioning

(Unchanged from v0.1.) Capex Inspection Pro is a multi-tenant, mobile-first
inspection and preventive-maintenance system for multifamily property
teams. It is a documentation and workflow tool, not a code-certification
engine, and does not replace inspections that must legally be performed by
licensed professionals.

Operating standard: **"Clean, safe and fully operational."**
Default decision principle: **"Repair before replacement unless condition,
safety, compliance, or lifecycle evidence supports replacement."**

## 2. MVP Scope

**In scope for the first production release:**

| Area                | Included                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Accounts & tenancy  | Secure sign-up/sign-in, org isolation, **server-enforced Free-plan entitlement**                                               |
| Device registration | **Server-side device fingerprinting, Play Integrity verification, controlled device replacement**                              |
| Properties          | Property setup, buildings, **data-driven area/location library**, systems/assets                                               |
| Checklists          | **Location-driven hierarchy**: area type → component → inspection check, generated per property, versioned                     |
| Inspections         | **Location-driven field workflow**, ordered route, 5-state item status, comments, photos, measurements                         |
| Offline             | Full offline capture and safe, conflict-aware sync                                                                             |
| Prioritization      | P1–P4 priority model, responsible-department routing                                                                           |
| Corrective actions  | Full lifecycle from open finding to verified/closed                                                                            |
| Reports             | Branded PDF reports, generated on-device, immutable once approved                                                              |
| History             | Inspection history, audit log, **security event log**, archive/restore                                                         |
| Dashboard           | Portfolio-level counts, filters, aging                                                                                         |
| Security            | RLS everywhere, MFA for admins, encrypted local storage, private storage + signed URLs, rate limiting, CAPTCHA, tested backups |

**Explicitly deferred (design extension points only, not built now):**

AI photo diagnosis, automatic code-compliance conclusions, vendor bidding,
inventory management, accounting/payments beyond the Free-tier entitlement
gate itself, advanced third-party integrations, complex paid-plan billing
enforcement (Free-tier enforcement is now MVP; Individual/Professional/
Team/Enterprise limit _enforcement_ reuses the same mechanism but their
specific numeric limits and payment collection are configured later),
resident portal, full CMMS replacement, iOS app, and web admin console.

## 3. Plan Entitlement, Device Registration & Security (MVP requirement)

This section was previously "deferred/design-only" in v0.1. It is now a
release-blocking MVP requirement, on the same footing as offline
reliability.

### 3.1 Free plan entitlement

The Free plan permits, per organization: **one verified user, one
organization, one property slot, and one active registered Android
device.** Teammate invitations are not permitted on the Free plan.

- **Active and archived properties both consume the property slot.**
  Archiving a property to "free up" a slot does not work — only
  administrator-controlled permanent deletion reduces the count, and per
  section 13 that path is deliberately restrictive.
- **Property creation is only possible through a transactional backend
  function** (`create_property()`, see `DATABASE_SCHEMA.md`) that locks
  the organization row, re-checks the current property count against the
  plan limit, and performs the insert in the same transaction. Direct
  table inserts are denied by Row Level Security. This closes both the
  "edit the request in the client" bypass and the "fire two requests at
  once" race condition.
- **Reinstalling the app restores the same account, organization, and
  property** after the user signs back in — it does not create a new
  organization, a new property, or consume an additional property slot.
  Property entitlement is tied to the organization, never to the device.

### 3.2 Device registration

Device identity is established **server-side only**, using:

1. An **app-scoped identifier** (resets on uninstall/reinstall by
   platform design — this is intentional and is handled by the reinstall
   flow below, not by trying to defeat it).
2. A **server-side HMAC** (or equivalent non-reversible transform) of that
   identifier, computed with a secret that never leaves the backend. The
   raw identifier is discarded immediately after hashing. **No raw
   hardware identifier (IMEI, Android ID, serial number, MAC address) is
   ever collected or stored.**
3. **Google Play Integrity** as an additional signal — the client obtains
   an integrity token and sends it to the backend; **verdict verification
   happens only on the backend**, never trusted from the client.

### 3.3 Device replacement (including reinstall)

A controlled replacement process handles both a deliberate device swap and
an app reinstall that looks like a new device:

- Re-verifies the user (a normal successful sign-in, plus MFA if
  enrolled, is treated as sufficient re-verification — **per your
  decision**, this happens automatically rather than requiring a separate
  in-app confirmation step).
- Revokes the former device's registration.
- Registers the replacement device.
- Sends a security notification email regardless of whether the trigger
  was automatic — this is the safety net if the sign-in wasn't actually
  the legitimate user.
- Records the event in both `security_events` and `audit_log`.

### 3.4 Abuse prevention vs. legitimate multi-seat use

The device-fingerprint checks exist to stop one person from repeatedly
creating new Free-plan organizations across multiple devices/accounts.
They must **not** block a legitimate invited teammate from joining an
existing **paid** organization from a device that has, say, already been
used for someone else's Free account. Concretely: the fingerprint-reuse
block is evaluated only at (a) self-serve Free-organization creation and
(b) device registration under a Free-plan organization. Accepting an
invite into an existing paid-plan organization is a separate transactional
path that checks that organization's own `user_seat_limit`, not the
Free-plan abuse signal.

### 3.5 Server-enforced entitlements vs. interface-only restrictions

To be explicit, since this distinction matters for both security and for
your own testing:

| Restriction                                       | Enforcement                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Free plan: 1 organization per account             | **Server-enforced** — signup path                                                                                       |
| Free plan: 1 property slot                        | **Server-enforced** — `create_property()` transaction                                                                   |
| Free plan: 1 active device                        | **Server-enforced** — device registration Edge Function                                                                 |
| Free plan: no teammate invites                    | **Server-enforced** — invite path checks `teammate_invites_allowed`                                                     |
| Hiding "Invite teammate" button on Free plan UI   | Interface-only convenience — the real gate is the server check above; hiding the button is not a substitute for it      |
| Showing remaining property/device slots in the UI | Interface-only — informational, always re-derived from the server-enforced counts, never trusted as the source of truth |

### 3.6 Additional security requirements (MVP)

Verified email required before full access; rate limiting and CAPTCHA/bot
protection on signup, sign-in, and password recovery; session tokens held
in platform secure storage on-device; local SQLite inspection data and
cached photographs encrypted at rest; administrator (`org_admin`) MFA
required; all Supabase Storage buckets private, accessed only via
short-lived signed URLs; full Row Level Security on every table; immutable
approved reports; a dedicated `security_events` audit log in addition to
the general business `audit_log`; the ability to revoke a session or
device; and a tested (not just scheduled) backup-restoration procedure.
See `DATABASE_SCHEMA.md` Part A for the schema and enforcement mechanism,
and `TEST_PLAN.md` for how each of these gets verified.

## 4. Organizations, Roles & Permissions

**Tenancy model:** unchanged — one organization per user account for MVP,
full Row Level Security isolation.

**Onboarding model:** self-serve creates a Free-plan organization (your
decision from Phase 0). The first person to sign up becomes
`org_admin`. Teammate invitations are only possible once the organization
is on a paid plan with `teammate_invites_allowed = true`.

**Roles:** organization administrator, portfolio manager, supervisor,
inspector/technician, read-only viewer.

**Permission matrix (MVP):**

| Action                                                         | Org Admin                                    | Portfolio Mgr | Supervisor                    | Inspector | Viewer |
| -------------------------------------------------------------- | -------------------------------------------- | ------------- | ----------------------------- | --------- | ------ |
| Create/edit properties (within entitlement)                    | Y                                            | Y             | –                             | –         | –      |
| Manage area/component/check library (org-level customizations) | Y                                            | Y             | –                             | –         | –      |
| Manage property check assignments                              | Y                                            | Y             | Y (property-level edits only) | –         | –      |
| Schedule inspections                                           | Y                                            | Y             | Y                             | –         | –      |
| Perform inspections                                            | Y                                            | Y             | Y                             | Y         | –      |
| Review & approve reports                                       | Y                                            | Y             | Y                             | –         | –      |
| Assign corrective actions                                      | Y                                            | Y             | Y                             | –         | –      |
| Archive records                                                | Y                                            | Y             | –                             | –         | –      |
| Permanently delete eligible records                            | Y                                            | –             | –                             | –         | –      |
| Deactivate a critical check (requires reason + approval)       | Y                                            | –             | –                             | –         | –      |
| Invite teammates (paid plans only)                             | Y                                            | –             | –                             | –         | –      |
| Register/replace this org's devices                            | Y (self), and each user for their own device |               |                               |           |        |
| View this org's `security_events`                              | Y                                            | –             | –                             | –         | –      |
| Manage plan/billing (display only in MVP)                      | Y                                            | –             | –                             | –         | –      |

Note: device registration itself is per-user (each authenticated user
registers their own device), but the _count_ of active devices is
constrained by the organization's `device_slot_limit`; on the Free plan
that limit is 1, which in practice ties to the single allowed user.

## 5. Core User Journeys

**5.1 New user signs up (Free plan)**
Sign up with email → verify email (required before proceeding) → CAPTCHA
challenge on signup → organization auto-created on the Free plan (1 user /
1 property / 1 device, no invites) → app requests device registration →
client obtains a Play Integrity token and an app-scoped identifier → sends
both to the backend → backend verifies the Play Integrity verdict,
computes the HMAC fingerprint, and registers the device transactionally →
user lands on an empty dashboard prompting them to create their first
property.

**5.2 Organization admin sets up a new property (guided, location-driven)**
"New Property" → basic property fields (name, address, type, year built,
units, etc.) → **property creation call goes through the transactional
entitlement-checked function**; if the Free-plan slot is already used, the
user sees a clear message and an upgrade prompt rather than a silent
failure → guided setup begins:

1. Identify the buildings on the property.
2. Select which standard area types exist (roof, hallway, stairwell,
   boiler room, etc.), and create as many instances of each as needed
   (e.g. "Hallway — Floor 1," "Hallway — Floor 2," "Stairwell A,"
   "Stairwell B," "Roof — Main Building," "Roof — Rear Extension").
3. The app creates each named location instance with its own building,
   floor, and route order.
4. For each area, the app suggests the commonly associated components
   from the component library (e.g. Roof suggests membrane, flashing,
   drains, strainers, parapets, coping, bulkhead, skylight, chimney, walk
   pads, exhaust fans, rooftop equipment).
5. The user confirms which suggested components actually exist, removes
   ones that don't, marks any as not applicable, and can add custom
   components.
6. The app generates the applicable property checklist
   (`property_check_assignments`) from confirmed components plus
   applicable regional/seasonal rules.
7. The user reviews the generated checklist and activates it (this
   creates the first `property_template_versions` row).

Nothing is auto-assumed into the active checklist — every suggested
component requires explicit confirmation, removal, or "not applicable"
before it can generate checks.

**5.3 Inspector performs a location-driven field inspection (offline)**
Inspector opens an assigned inspection → the app generates (or has
already generated, if scheduled in advance) an `inspection_snapshot` from
the current active `property_template_versions`, scoped to whichever
buildings/locations the inspection type calls for → inspector reviews the
proposed scope before starting → the active inspection shows the route of
locations in order:

1. Open the inspection route.
2. Arrive at / select the next area.
3. See only the components and checks assigned to that specific area
   (not a flat list of every checklist item on the property).
4. Complete the applicable checks (status, photos, comments,
   measurements).
5. Add an ad hoc observation or item if needed (this-inspection-only, or
   submitted for supervisor approval to become permanent).
6. Mark the area complete — or, if it can't be completed, mark it
   skipped/inaccessible/not-applicable-to-scope, **which requires a
   reason.**
7. Proceed to the next area.

The screen always shows current area, completed areas, remaining areas,
skipped areas, and inaccessible areas, plus overall progress. All of this
works fully offline. Before final submission, a review screen clearly
lists every uninspected or inaccessible location so nothing is silently
missed.

**5.4 Supervisor reviews and approves a report** (unchanged from v0.1)
Supervisor opens a completed inspection → reviews findings, especially P1/
P2 items and any uninspected/inaccessible locations → approves → PDF
generated client-side → report becomes immutable → stored in history.

**5.5 Portfolio manager tracks corrective actions** (unchanged from v0.1)

**5.6 Returning user reinstalls the app**
User reinstalls, signs in with their existing credentials (+ MFA if
enrolled) → this is treated as adequate re-verification → backend detects
the app-scoped identifier no longer matches the registered device →
automatically revokes the old device registration and registers the new
one → sends a security-notification email → user lands back on their
existing organization and property, exactly as before, with no new slot
consumed and no manual "replace device" step required.

**5.7 Legitimate device replacement (lost/upgraded phone)**
Functionally identical to 5.6 — signing in on the new phone is what
triggers the same automatic replacement flow. There is no separate
"request a new device" screen needed for the common case; the email
notification is what protects against misuse of this convenience.

## 6. Screens (MVP)

| Screen                                              | Purpose                                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in / Sign up                                   | Auth entry point, CAPTCHA on signup, email verification prompt                                                                               |
| Device registration (background/first-run)          | Silent Play Integrity + fingerprint registration, with a blocking error state only if it fails                                               |
| Organization setup (first run)                      | Auto-create Free-plan org, name it, set org admin profile                                                                                    |
| Dashboard                                           | Portfolio summary cards, filters, quick links, remaining-slot indicators (informational only)                                                |
| Properties list                                     | Search/filter properties, "New Property" (blocked with an upgrade prompt if the Free slot is used)                                           |
| Property detail                                     | Overview, buildings/locations, systems/assets, checklist, inspection history tabs                                                            |
| Guided property setup wizard                        | Buildings → areas → location instances → suggested components → confirm/remove/not-applicable → generated checklist review → activate        |
| Area & component library (admin)                    | Org-level customization of area types and component types, adding custom ones                                                                |
| Property check assignments editor                   | The resolved, per-property checklist: add/remove/override checks per location/component, manage critical-check status with required reason   |
| Inspection list / schedule                          | Upcoming, in progress, completed, overdue                                                                                                    |
| New inspection setup                                | Type, property, scope (buildings/locations, per inspection-type rules), assigned inspector, date, **review generated scope before creating** |
| Active inspection (location-driven route navigator) | Current/completed/remaining/skipped/inaccessible areas, progress, per-area check list                                                        |
| Checklist item detail                               | Status, photos, measurement, comment, priority, owner                                                                                        |
| Deficiency detail                                   | Full finding record, escalation state                                                                                                        |
| Corrective actions board                            | Filterable list/board by status                                                                                                              |
| Report preview / PDF viewer                         | Preview before approval, download/share after                                                                                                |
| User & role management                              | Invite teammates (paid plans only), assign roles                                                                                             |
| Devices & security (settings)                       | View this account's registered device, replace-device history, security notifications                                                        |
| Settings                                            | Org profile, branding, plan info                                                                                                             |

## 7. Location Hierarchy: Area, Component & Inspection-Check Model

This replaces v0.1's flat three-level template with a compositional
hierarchy: **Organization → Property → Building → Area/Location →
Component/Asset → Inspection Check.** Full entity definitions are in
`DATABASE_SCHEMA.md` Part B; this section describes the product behavior.

**Area type library (standard, data-driven):** entrance, roof, exterior
elevation, balcony, hallway, lobby, stairwell, apartment/unit, basement,
boiler room, mechanical room, electrical room, elevator room, laundry
room, garbage/compactor room, storage room, sidewalk, yard, parking area,
custom area. A property may contain multiple instances of the same area
type (e.g. two stairwells, two roofs). Every location instance has its own
stable identifier, name, building, floor, route order, active status, and
inspection history.

**Component library (standard, per area type, data-driven):** e.g. Roof →
membrane, flashing, drains, strainers, parapets, coping, bulkhead,
skylight, chimney, walk pads, exhaust fans, rooftop equipment; Hallway →
flooring, walls, ceilings, lighting, emergency lighting, exit signs,
doors, fire-rated assemblies, penetrations; Stairwell → treads, nosings,
railings, guards, doors, self-closing hardware, lighting, emergency
lighting, fire-rated enclosure; Boiler Room → boilers, burners, pumps,
valves, piping, gauges, controls, tanks, ventilation, electrical service,
floor drains; Mechanical Room → HVAC equipment, pumps, fans, controls,
condensate drainage, ducts, insulation, ventilation; Electrical Room →
panels, switchgear, conduit, junction boxes, grounding, clearances,
lighting, emergency systems; Apartment → entrance door, windows, flooring,
walls, ceilings, kitchen wet sources, bathroom wet sources, toilets,
supply valves, drains, HVAC equipment, detectors, ventilation, outlets,
GFCIs; Exterior → façade materials, windows, sealants, penetrations,
balconies, railings, drainage, attachments; Garbage Room → compactor,
containers, floor drains, ventilation, lighting, pest-control devices.
Users can add custom components at the organization or property level.

**Inspection-check library (reusable, versioned, data-driven):** each
check (e.g. "Inspect for punctures, open seams, deterioration, and
previous temporary repairs" under Roof → Membrane) carries its own
instructions, applicability rules, status options, required-photo/comment/
measurement flags, acceptable range, default priority/department,
frequency, critical-item designation, regional/seasonal tags, active
status, and version. None of this is hard-coded into mobile UI
components — expanding the library is a data change, not an app release.

**Critical checks:** a check marked `critical` cannot be permanently
removed through an ordinary edit. Allowed states are active, inactive
(with required reason), not applicable (with required reason), or
superseded by another check — every transition records the user, date,
reason, and (for deactivation) admin approval.

**Property and equipment changes:** adding an area, deactivating an area,
adding/replacing/relocating equipment, renovating an area, adding a
building, or changing inspection applicability all apply to **future**
inspections only. In-progress and completed inspection snapshots are
never altered by later changes.

## 8. Inspection Workflow

**Inspection types (MVP):** comprehensive, preventive-maintenance,
seasonal, fire/life-safety, mechanical, exterior/grounds, common-area,
apartment/unit, move-in, move-out, capital-planning, follow-up, custom.

**Automatic checklist generation.** When an inspection is created, the
system generates its checklist from: (1) inspection type, (2) selected
property, (3) selected buildings/locations, (4) confirmed components and
assets at those locations, (5) property-specific checklist overrides
(`property_check_assignments`), (6) applicable regional/seasonal modules,
and (7) the currently active version of each relevant inspection check.
The user reviews the proposed scope before the inspection starts. A
uniqueness rule (see `DATABASE_SCHEMA.md`) guarantees the generator never
produces the same (location, component, check) combination twice.

**How each inspection type resolves its scope:**

| Inspection type        | Scope resolution                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Comprehensive          | All active locations on the property                                                                |
| Preventive maintenance | Locations/components whose assigned checks are currently due by frequency                           |
| Roof                   | Locations typed as Roof, plus checks tagged as relevant exterior conditions                         |
| Mechanical             | Boiler-room and mechanical-room locations and their equipment                                       |
| Fire & life-safety     | All locations, filtered to checks tagged fire/life-safety (including `critical` checks)             |
| Common-area            | Entrance, lobby, hallway, and stairwell locations                                                   |
| Apartment/unit         | User-selected unit location(s)                                                                      |
| Follow-up              | Items tied to unresolved or user-selected prior findings/corrective actions, not a fresh area sweep |
| Custom                 | Manually selected areas and checks                                                                  |

**Default route (customizable per property):** arrival/entrance → roof and
upper-level → exterior/envelope → common areas top-down → stairwells/egress
→ apartments/units → basement/service areas → mechanical/electrical rooms
→ grounds/sidewalks/rear yard → final closeout. Within a unit: entrance to
exit, clockwise, floor to ceiling, wet sources documented separately.

**Location-driven active-inspection navigation** (see journey 5.3): the
inspector only ever sees the components/checks for the area they're
currently in, not the whole property's checklist at once. Not-inspected,
inaccessible, skipped, or out-of-scope areas each require a reason, and the
final review screen surfaces all of them before submission.

**Item statuses:** satisfactory, deficiency, not applicable, not
inspected, pending verification. A deficiency triggers configurable
required-field rules.

**Item fields:** status, observation, recommendation, photo(s) with
before/after designation and caption, measurement + unit, code/certificate
reference, inspector, date/time, location, component/asset, priority,
responsible department/person/vendor, access status/plan, target
completion date, next action, follow-up date, work-order number,
estimated/actual cost, labor hours, material cost, completion evidence,
supervisor review, signature, full change history.

**Priority model:**

| Priority | Meaning                                                | Response expectation (MVP default)                            |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| P1       | Life safety / immediate hazard                         | Immediate notification; escalate within 2 hours if unresolved |
| P2       | Code, regulatory, or material compliance concern       | Documented senior escalation if unresolved beyond 24 hours    |
| P3       | Operational / preventive-maintenance / standard repair | Normal workflow                                               |
| P4       | Cosmetic / minor condition                             | Normal workflow                                               |

Priority is shown with both color and a text/icon label — never color
alone.

**Responsibility routing:** construction management, facilities, energy
management, property management, vendor, other — with the suggested
routing rules from your brief. Every deficiency has exactly one primary
owner.

## 9. Offline Strategy

Unchanged in principle from v0.1 (must work fully offline in roofs,
basements, mechanical rooms — release-blocking), extended to the new
structure:

- Local SQLite mirrors the active `inspection_snapshot`, its
  `inspection_snapshot_locations` (with status/reason), and
  `inspection_snapshot_items`, plus any offline-created photos,
  comments, and ad hoc items.
- Photos are written to local device storage immediately on capture, and
  both photos and the local SQLite data are **encrypted at rest** on the
  device (per section 3.6).
- A sync queue tracks every offline change, keyed by `client_uuid`, so
  sync is idempotent and never creates duplicates.
- Conflicts are never silently overwritten — flagged for review, both
  versions preserved in the audit trail.
- Closing and reopening the app mid-inspection resumes at the same
  location within the route.
- Device-replacement/reinstall logic (section 3.3) operates independently
  of inspection sync — a device replacement never touches property or
  inspection entitlement, only the `devices` table.

## 10. Deficiencies & Corrective Actions

(Unchanged from v0.1.) Statuses: open, assigned, access required, vendor
required, scheduled, in progress, pending parts, pending approval,
completed, verified, closed, voided. Repeat-condition linkage, resident
access, vendor assignment, aging/overdue flags, escalation state,
completion evidence, and supervisor verification are all tracked.

## 11. Reports

(Unchanged from v0.1.) Generated client-side/on-device. Contents now also
implicitly include the list of skipped/inaccessible locations from the
final-review step, since that's part of "areas not inspected" in the
report body. Immutable once approved.

## 12. Dashboard & Analytics (MVP)

(Unchanged from v0.1.) Metrics and filters as previously specified.

## 13. Data Protection, Retention & Audit

(Unchanged from v0.1, extended.) Ordinary users cannot permanently delete
a completed inspection. Archive/void/restore lifecycle as before. Property
deletion archives by default and preserves inspection history — and, per
section 3.1, an archived property still counts against the Free-plan
property slot, so archiving is not a way to "reset" entitlement.
`security_events` (logins, device changes, MFA, rate-limit triggers) is
retained separately from the general `audit_log` and is visible only to
`org_admin`.

## 14. Regional Configuration

(Unchanged in intent from v0.1, now implemented via
`check_applicability_rules.region_tag` rather than a separate bolt-on.)
MVP ships the framework plus a generic default library; NYC/Boston/DC/
Virginia-specific modules are added as data (new `inspection_check_library`
rows + applicability rules), not new code.

## 15. Commercial Readiness

Free-plan entitlement enforcement is now MVP (section 3). The same
transactional-function mechanism (`create_property()`-style row-locked
check-then-write) is reused for any future paid-tier numeric limit — only
the limit values and the payment-collection/plan-upgrade flow itself are
deferred. `organizations.plan_limits_extra` still holds the not-yet-enforced
soft limits (monthly inspections, storage, branded reports, analytics,
retention period) for Individual/Professional/Team/Enterprise tiers.

## 16. Acceptance Criteria

See `TEST_PLAN.md` for the full checklist, which now includes: property
and device entitlement (including a concurrency test), device
fingerprinting never storing raw hardware identifiers, Play Integrity
verdicts checked only server-side, the reinstall/device-replacement flow,
checklist-generation de-duplication, critical-check protection, and the
full security requirement list in section 3.6 — in addition to the
original organization-isolation, permission, template-snapshot-immutability,
and offline-reliability criteria from v0.1.

## 17. Assumptions & Open Decisions Log

- 2026-08-18 — PDF generation: client-side on-device.
- 2026-08-18 — Org onboarding: self-serve creates org, invite-only for
  teammates on paid plans.
- 2026-08-18 — Free plan entitlement (1 user/org/property/device),
  server-enforced via transactional functions, is MVP — **added this
  revision**.
- 2026-08-18 — Device registration via app-scoped identifier + server-side
  HMAC + Play Integrity, with automatic replacement on reinstall/new-device
  sign-in — **added this revision, reinstall behavior per your decision**.
- 2026-08-18 — Location-driven area/component/inspection-check hierarchy
  replaces the flat template model — **added this revision**.
- Still open / recommended defaults, flag if you want something different:
  - Transactional email provider for security notifications (device
    replacement, etc.) — not yet chosen; will propose an option in
    Phase 2.
  - Exact local-database encryption library for offline SQLite — will be
    finalized in Phase 6 (candidates include SQLCipher-compatible SQLite
    drivers for Expo).
  - Play Integrity requires a Google Cloud project linked to your Play
    Console app — we'll set this up together in Phase 12 lead-up, but the
    backend code will be written against it starting in Phase 2/3.
  - Assumed: single organization per user account for MVP.
  - Assumed: English-only UI for MVP.
  - Assumed: US-based deployment/region defaults.

If anything above doesn't match what you had in mind, tell me and I'll
revise this document before we touch any code.
