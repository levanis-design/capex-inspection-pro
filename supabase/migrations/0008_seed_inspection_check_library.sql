-- Phase 4, migration 2 of 3: seed the platform-standard inspection check
-- library and the applicability rules linking each check to its
-- component type.
--
-- This is a representative starter set -- at least one meaningful check
-- per area type in the standard library, with life-safety items (fire
-- extinguishers, emergency lighting, self-closing doors, smoke/CO
-- detectors, elevator equipment, boiler controls, dryer vents, etc.)
-- marked critical -- not an exhaustive one. Per PRODUCT_SPEC.md section 7,
-- "expanding this library later is a data change, not an app release," so
-- growing it over time is expected and does not block Phase 4.
--
-- Run this once, after 0007. Like 0005, it has no re-run guard, so running
-- it twice would create duplicate checks.

with new_checks (
  name, area_type_name, component_type_name, instructions, critical,
  photo_required, measurement_required, default_priority, frequency
) as (
  values
    ('Inspect for punctures, open seams, deterioration, and previous temporary repairs',
      'Roof', 'Membrane', null, false, true, false, 'P2', 'annual'),
    ('Confirm roof drains and strainers are clear of debris and draining properly',
      'Roof', 'Drains', 'Standing water on a roof indicates a blocked drain -- treat as urgent.', true, true, false, 'P1', 'quarterly'),
    ('Inspect flashing at penetrations and parapets for separation or deterioration',
      'Roof', 'Flashing', null, false, true, false, 'P2', 'annual'),

    ('Test that emergency lighting activates on a power interruption',
      'Hallway', 'Emergency Lighting', null, true, false, false, 'P1', 'monthly'),
    ('Confirm exit sign is illuminated and visible from the corridor',
      'Hallway', 'Exit Signs', null, true, false, false, 'P1', 'monthly'),
    ('Confirm fire-rated door/wall assemblies show no unauthorized penetrations or damage',
      'Hallway', 'Fire-Rated Assemblies', null, true, true, false, 'P1', 'annual'),

    ('Inspect railings and guards for looseness, damage, or code-noncompliant gaps',
      'Stairwell', 'Railings', null, true, true, false, 'P1', 'annual'),
    ('Confirm self-closing door hardware fully closes and latches every time',
      'Stairwell', 'Self-Closing Hardware', null, true, false, false, 'P1', 'monthly'),
    ('Inspect treads and nosings for wear, damage, or trip hazards',
      'Stairwell', 'Treads', null, false, true, false, 'P2', 'annual'),

    ('Inspect boiler for leaks, corrosion, and confirm the pressure relief valve is unobstructed',
      'Boiler Room', 'Boilers', null, true, true, false, 'P1', 'monthly'),
    ('Verify boiler safety controls and gauges are functioning and within normal operating range',
      'Boiler Room', 'Controls', 'Record the observed pressure/temperature reading.', true, false, true, 'P1', 'monthly'),

    ('Confirm electrical panels are labeled, fully closed, and clearances are unobstructed',
      'Electrical Room', 'Panels', null, true, true, false, 'P1', 'annual'),
    ('Test emergency electrical systems (generator/transfer switch) under load',
      'Electrical Room', 'Emergency Systems', null, true, false, false, 'P1', 'quarterly'),

    ('Test that smoke and carbon monoxide detectors are present and functioning',
      'Apartment/Unit', 'Smoke/CO Detectors', null, true, false, false, 'P1', 'annual'),
    ('Inspect water supply valves for leaks or corrosion',
      'Apartment/Unit', 'Supply Valves', null, false, true, false, 'P2', 'annual'),
    ('Test that GFCI outlets trip and reset correctly',
      'Apartment/Unit', 'GFCIs', null, true, false, false, 'P2', 'annual'),

    ('Inspect facade for cracking, spalling, or loose material',
      'Exterior Elevation', 'Facade Materials', null, true, true, false, 'P1', 'annual'),
    ('Inspect sealants/caulking at joints for failure or gaps',
      'Exterior Elevation', 'Sealants', null, false, true, false, 'P3', 'annual'),

    ('Inspect compactor for proper operation and confirm safety interlocks engage',
      'Garbage/Compactor Room', 'Compactor', null, true, false, false, 'P2', 'monthly'),

    ('Confirm entrance doors close, latch, and lock securely',
      'Entrance', 'Doors', null, false, false, false, 'P2', 'monthly'),
    ('Inspect door hardware (panic bars, closers) for proper function',
      'Entrance', 'Door Hardware', null, true, false, false, 'P1', 'monthly'),

    ('Inspect lobby flooring for trip hazards or damage',
      'Lobby', 'Flooring', null, false, true, false, 'P3', 'monthly'),

    ('Confirm basement floor drains are clear and functioning',
      'Basement', 'Floor Drains', null, false, false, false, 'P2', 'annual'),

    ('Confirm elevator machine room equipment shows no unusual noise, leaks, or overheating',
      'Elevator Room', 'Elevator Equipment', null, true, false, false, 'P1', 'monthly'),

    ('Inspect dryer vent lines for lint buildup and confirm clear discharge',
      'Laundry Room', 'Washers/Dryers', 'Lint-clogged dryer vents are a fire hazard -- treat as urgent.', true, false, false, 'P1', 'quarterly'),

    ('Confirm fire extinguisher is charged, tagged, and unobstructed',
      'Storage Room', 'Fire Extinguisher', null, true, true, false, 'P1', 'monthly'),

    ('Inspect balcony railings for looseness, corrosion, or code-noncompliant gaps',
      'Balcony', 'Railings', null, true, true, false, 'P1', 'annual'),

    ('Inspect sidewalk for cracking, heaving, or trip hazards',
      'Sidewalk', 'Surface Condition', null, false, true, false, 'P2', 'annual'),

    ('Inspect fencing for damage, gaps, or security compromise',
      'Yard', 'Fencing', null, false, true, false, 'P3', 'annual'),

    ('Confirm parking area lighting is functioning at night',
      'Parking Area', 'Lighting', null, false, false, false, 'P2', 'monthly')
),
inserted as (
  insert into public.inspection_check_library (
    name, instructions, critical, photo_required, measurement_required, default_priority, frequency
  )
  select name, instructions, critical, photo_required, measurement_required, default_priority, frequency
  from new_checks
  returning id, name
)
insert into public.check_applicability_rules (inspection_check_id, component_type_id, rule_type)
select i.id, ct.id, 'include'
from inserted i
join new_checks nc on nc.name = i.name
join public.area_types at on at.name = nc.area_type_name and at.organization_id is null
join public.component_types ct
  on ct.area_type_id = at.id and ct.name = nc.component_type_name and ct.organization_id is null;
