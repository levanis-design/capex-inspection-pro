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
See section 10a for the certificate/permit tracking piece of "Compliance
document/date tracking" (Phase 14) and section 10b for the recurring
log-review/vendor-report-currency piece (Phase 15) — both now built.

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

**Phase 17 addition (2026-09-12):** two follow-up hardening items,
closing gaps Phase 10 had left open. First, administrator MFA (above)
gated _reaching the app at all_ as an org_admin, but didn't separately
require a completed MFA session for each individual admin-only database
action — that's now also enforced directly at the RLS/function layer,
for the specific set of actions that are org_admin-exclusive (organization
settings, admin-editing another profile, org-wide device visibility,
security events, revoking a device, deactivating a critical inspection
check, voiding/deleting a past-scheduled inspection, permanently deleting
a property). Deliberately not extended to the broader
org_admin/portfolio_manager/supervisor management set used elsewhere,
since only org_admin has an MFA enrollment path today. Second, revoking a
device previously didn't stop that device's existing session from
continuing to work — the app now actively checks its own device's
revoked status (before syncing, and on a short foreground poll) and signs
out with an explanation as soon as it detects it. Both are locally
verified, not yet applied to the live project; see `DATABASE_SCHEMA.md`'s
migration `0027` entry and `CHANGELOG.md`'s Phase 17 entry for the full
detail, including the client-side check's known limits.

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
| Compliance documents (Phase 14)                     | Per-property certificate/permit list — title, type, expiration, derived valid/expiring/expired status, photo/scan, notes                     |
| Compliance tasks (Phase 15)                         | Per-property recurring review list — log reviews, vendor report reviews, derived OK/due soon/overdue status, review history with notes       |
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
Phase 13 (migration `0024`) confirmed this in practice: a much broader
preventive-maintenance checklist (37 additional checks, 16 additional
component types, covering exterior envelope, MEP, fire/life safety,
interior common areas, basement/service areas, site/grounds, and pest
prevention) was added entirely as data — no app code changed, and the
existing per-item checkbox/comment/photo interaction on the inspection
walkthrough screen picked it up automatically.

**Phase 18 addition (2026-09-12):** the same "expanding the library is a
data change" property held up again, this time against the user's own
real walkthrough templates and completed field reports rather than a
generic reference checklist. Migration `0028` added 4 new area types
(Gas Meter Room, Telecom/IT Room, Amenity Space, Office), 23 new
component types, 36 new checks, and — new to this pass — checks that
confirm an inspection _tag_ is current and not expired (fire
extinguisher, standpipe), a distinct concept from the compliance
documents/tasks features (section 3.6/13): a tag lives on a physical
asset and gets checked during an ordinary walkthrough, not tracked as
its own property-level record with an expiration date. See
`CHANGELOG.md`'s Phase 18 entry for the full list and the specific real
findings that motivated each addition.

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
- **Shared-device tenant isolation (Phase 23):** the local mirror is
  scoped to whichever organization is currently signed in, and is
  cleared on sign-out — with no unsynced changes pending, this happens
  immediately and silently; with unsynced changes pending, the person is
  asked to confirm before anything is discarded (see CHANGELOG.md's
  Phase 23 entry for the exact UX and which sign-out paths bypass the
  prompt as security/error flows). This is what actually makes it safe
  for one physical device to be reissued or shared across different
  organizations' users over time, which section 3.3 (device replacement)
  assumes but never previously specified at the local-storage level.

## 10. Deficiencies & Corrective Actions

(Unchanged from v0.1.) Statuses: open, assigned, access required, vendor
required, scheduled, in progress, pending parts, pending approval,
completed, verified, closed, voided. Repeat-condition linkage, resident
access, vendor assignment, aging/overdue flags, escalation state,
completion evidence, and supervisor verification are all tracked.

## 10a. Compliance Documents (Phase 14)

Property-level tracking for certificates and permits with a renewal date
— boiler certificate, elevator certificate, fire safety permit, FISP/LL11
filing, or an open-ended "other" category. Deliberately separate from the
area/component/check model in section 7: this is document/expiration-date
state attached to a _property_, not a checkbox item attached to a
_location_, so it lives in its own table (`compliance_documents`, see
`DATABASE_SCHEMA.md`) rather than being forced through
`check_applicability_rules`.

Each document has a title, an optional issuing authority, an optional
expiration date, a notes field, and at most one attached photo/scan. The
status shown in the UI is derived, not just stored: given an expiration
date, a document displays as "Valid," "Expiring soon" (within 30 days), or
"Expired" automatically as today's date moves — a certificate can't
silently keep reading "Valid" after it's lapsed just because nobody
edited the row. Two additional states are set manually, since a date
can't express them: "Renewal in progress" and "Not applicable" (e.g. a
property with no elevator has no elevator certificate to track).

Read access is portfolio-wide (any role can see what's expiring); adding,
editing, deleting, and attaching a photo/scan are restricted to
org_admin/portfolio_manager/supervisor, the same management role set used
for vendors, findings, and corrective actions. Photo/scan capture is
online-only (no offline queue) — unlike inspection photos, this is an
office/admin task done with a normal connection, not a field capture with
unreliable signal.

**Explicitly out of scope for Phase 14**: incident/maintenance log review
and vendor-report currency tracking. Those are recurring review
workflows rather than a single document with an expiration date, and
don't fit this table's shape either — see section 10b, which Phase 15
built for exactly that.

## 10b. Compliance Tasks (Phase 15)

The recurring-review half of the same source checklist section that
Phase 14 left out: "Review incident logs and maintenance logs for
patterns" and "Ensure contractor and vendor reports are up to date."
Neither is a document with an expiration date — each is a task that
repeats on a schedule (weekly, monthly, quarterly, or annual), where what
matters is whether someone actually did the review recently and what
they found, not a single expiring artifact.

Each compliance task has a type (log review, vendor report review, or an
open-ended "other"), a title, an optional description, a frequency, and
— for a vendor report review task specifically — a linked vendor (from
the same `vendors` table corrective actions already use). A task's due
status is derived the same way a compliance document's is: "OK," "Due
soon" (within 7 days), "Overdue," or "Never reviewed," computed from the
most recent completion plus the task's frequency, not from a stored
status that could go stale.

Recording a review is its own append-only log
(`compliance_task_completions`) rather than a single "last reviewed"
field — every time someone marks a task reviewed, that's a new entry
with its own timestamp, who did it, and an optional note on what they
found, so a pattern across multiple reviews (the whole point of "review
logs for patterns") stays visible rather than being overwritten each
time.

Same permission model as compliance documents: read is portfolio-wide,
managing tasks and recording reviews are restricted to
org_admin/portfolio_manager/supervisor. Deliberately not auto-seeded per
property (unlike the checklist library) — a log-review task applies to
any property generically, but a vendor-report-review task only makes
sense for a vendor actually used there, and there's no reliable way to
infer that automatically, so an admin adds the tasks that apply.

## 11. Reports

Generated client-side/on-device, one PDF per inspection, immutable once
approved. **The detailed design below was written during Phase 7
implementation (2026-09-10)** — v0.1's original detail behind this
section was never carried forward into v0.2, which only kept the
one-line summary ("branded PDF reports, generated on-device, immutable
once approved"). See `DATABASE_SCHEMA.md`'s "reports" entry and
`supabase/migrations/0021` for the full data-model rationale; this
section covers product behavior.

A report can only be generated for a `completed` inspection (submitting
the inspection via the Review & Submit screen is what unlocks it). Only
an org_admin, portfolio_manager, or supervisor may approve one — an
inspector/viewer sees a "waiting for approval" message instead of an
Approve button, matching this section's role table. There is no draft
state persisted anywhere: "Preview" renders the current state of the
inspection to a PDF and opens it in the device's share/preview sheet
without recording anything, and "Approve & finalize" independently
renders a fresh PDF, uploads it, and records it as the one, permanent
report for that inspection. Once approved, a report cannot be edited,
regenerated, or re-approved — if something needs to be corrected, that's
a product decision for a future phase (a `follow_up` inspection type
already exists for re-checking a specific condition, which may end up
being the intended mechanism), not something this phase guesses a
versioning scheme for.

Report contents: a cover header (organization name, property name and
address, inspection type, scheduled/completed dates, assigned inspector,
approver name and date); a scope summary table listing every area with
its status, and the required reason for any skipped/inaccessible one
(this is the "areas not inspected" content the original spec line
called out); a findings section covering every item recorded as
`deficiency` or `pending_verification`, sorted P1 first, each with its
observation/recommendation/code reference/responsible department, its
current corrective-action status and escalation flag, and its photos;
and a full item-by-item checklist appendix (every item, every status,
grouped by area) as the complete record. The findings section reflects
each item's corrective-action status _as of the moment of approval_ —
the report itself never changes afterward even though the underlying
corrective action keeps moving on the board.

## 12. Dashboard & Analytics (MVP)

**The detailed design below was written during Phase 8 implementation
(2026-09-10)** — same situation section 11 was in before Phase 7: v0.1's
original detail behind this section was never carried forward into v0.2,
which only kept the one-line summary ("Portfolio-level counts, filters,
aging"). See `src/lib/dashboard.ts` for the query-level implementation;
this section covers what's shown and why.

The Dashboard tab is a portfolio-level, read-only summary — every number
on it is informational, per the "remaining-slot indicators (informational
only)" framing already established for entitlement limits in section 3.1;
nothing on this screen writes anything or gates any action. Tapping any
stat navigates to the tab that actually manages that data (Properties,
Inspections, or Corrective Actions) rather than drilling into a
dashboard-specific detail view — the board/list screens those tabs
already have are the detail view.

A single-property filter (a horizontally scrollable row of pills: "All
properties" plus each active property, "All properties" selected by
default) narrows every metric below except property slot usage, which is
always portfolio-wide (it's a statement about the organization's plan
entitlement, not about one property). Archived properties are excluded
from the filter list itself (there's no reason to drill into one day to
day) but are NOT excluded from the "All properties" totals, since their
history (findings, corrective actions) still belongs to the organization.

Metrics shown:

- **Property slot usage** — active + archived property count against
  `organizations.property_slot_limit` (matches `create_property()`'s own
  counting rule from section 3.1 exactly: an archived property still
  consumes its slot).
- **Inspections by status** — scheduled, in progress, completed,
  postponed, voided, plus a derived **overdue** count (status is
  scheduled or in_progress AND `scheduled_date` is in the past). Overdue
  is not a stored status — it's the same read-time computation the rest
  of this app already prefers over a stored/derived column (see
  `isOverdueForCompletion()` in `corrective-action-types.ts` for the
  precedent).
- **Open findings by priority** — P1-P4 counts (P1 highlighted, since a
  nonzero P1 count is the single most urgent thing this screen can show),
  a "not yet prioritized" count if any open finding has no priority set,
  and an **escalated** count (also highlighted). "Open" here means a
  finding's `current_status` hasn't reached one of the terminal states
  (completed, verified, closed, voided) — the same non-terminal set the
  Corrective Actions board's own default filter already uses.
- **Corrective actions** — total open count, and an **overdue** count
  (open AND `target_completion_date` is in the past) — the same
  overdue-for-completion definition `corrective-action-types.ts` already
  uses per-row on the deficiency detail screen, just aggregated here.
- **Quick links** are implicit: every stat row above is itself the link
  (tapping it opens the relevant tab), rather than a separate row of
  buttons — see the screens table in section 6.

Deliberately out of scope for this phase: any historical/trend view
(week-over-week, month-over-month), cost roll-ups (estimated/actual cost
aggregation across corrective actions), and a multi-property comparison
view (side-by-side across more than one property at a time) — the filter
is single-select by design for the MVP. All three are natural follow-ups
once there's enough real portfolio data to make them worth building.

**Phase 16 addition (2026-09-12):** a sixth section, **Compliance**, with
two more counts — documents needing attention (expired or expiring soon,
across every property) and tasks needing attention (overdue, due soon, or
never reviewed). Both reuse the exact same derived-status functions as
their per-property attention badges (`computeDisplayStatus`,
`computeTaskDueStatus` — see sections 10a/10b), just aggregated across
the whole portfolio (or narrowed to one property, same as every other
section here) instead of one property at a time. The one difference from
every other section: there's no portfolio-wide compliance list screen to
route to, so tapping a row opens that specific property's compliance
screen when the filter is narrowed to one property, or the Properties tab
(to pick one) when it's set to "All properties."

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
- 2026-09-07 — Local-database + encryption approach for offline SQLite
  (Phase 5C) finalized: `expo-sqlite` for the local mirror, with
  application-layer encryption via `tweetnacl`'s `secretbox`
  (XSalsa20-Poly1305) rather than a fully-encrypted database file (e.g. a
  SQLCipher-backed driver). Reasoning: this project has deliberately
  stayed on plain Expo managed workflow -- runnable in Expo Go, no
  `android`/`ios` native directories, no custom dev client -- through
  every phase so far, and a SQLCipher-style driver needs a custom native
  build (ejecting), which is a large infrastructure change this phase
  didn't ask for. Instead: every free-text/sensitive field (observations,
  status reasons, photo captions) is encrypted before it touches SQLite,
  and photo bytes are encrypted before being written to local device
  storage; structural fields (ids, statuses, titles, timestamps) stay
  plaintext so the mirror is queryable. The symmetric key is generated
  once per install and stored in `expo-secure-store` (Keychain/Keystore),
  same as the Supabase auth session token. See `src/lib/local-crypto.ts`'s
  header comment for the full detail, and flag it if you'd rather invest
  in ejecting for whole-database encryption instead.
- Still open / recommended defaults, flag if you want something different:
  - Transactional email provider for security notifications (device
    replacement, etc.) — not yet chosen; will propose an option in
    Phase 2.
  - Play Integrity requires a Google Cloud project linked to your Play
    Console app — we'll set this up together in Phase 12 lead-up, but the
    backend code will be written against it starting in Phase 2/3.
  - Assumed: single organization per user account for MVP.
  - Assumed: English-only UI for MVP.
  - Assumed: US-based deployment/region defaults.

If anything above doesn't match what you had in mind, tell me and I'll
revise this document before we touch any code.
