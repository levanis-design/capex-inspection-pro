-- Phase 18: checklist content expansion, sourced from the user's own past
-- inspection walkthrough templates and completed field reports (multiple
-- properties, both a formal "Building Walkthrough Checklist"/"Capital
-- Plan" template pair and raw completed-inspection field notes), which
-- surfaced real gaps against the standard library built in 0005/0008/0024.
--
-- Everything here is DATA, not code -- exactly like 0005/0008/0024 before
-- it: new area_types/component_types rows, new inspection_check_library/
-- check_applicability_rules rows. No schema change, no new
-- inspection_type, no app code change -- generate_property_checklist()
-- (0009) already evaluates both area-level and component-level
-- applicability rules generically, so anything added here is picked up
-- automatically the same way 0008/0024's content was.
--
-- What prompted each addition (so the reasoning survives, not just the
-- data):
--   - Fire alarm system (panel + pull stations) had NO representation at
--     all before this, despite being called out in every walkthrough
--     template reviewed and in an actual field finding (a pull station
--     needing its color-coding corrected).
--   - Domestic water system components (backflow preventer/RPZ, house/
--     booster pumps) and their test-tag currency were missing -- a real
--     field report flagged an RPZ whose annual test tag had expired.
--   - Gas meter room (ventilation, separation, labeling, security) is its
--     own checklist section in every template reviewed, but had no area
--     type at all -- it was only implied via Boiler Room's generic
--     "ventilation" check.
--   - Cooling tower/chiller and its chemical treatment system, and the
--     rooftop gravity tank, are asked about in every template but have no
--     component anywhere -- a real field report specifically flagged
--     cracking/corrosion at a cooling tower's dunnage structure.
--   - Telephone/data/intercom/CCTV/key-security is its own named section
--     in every template, but has zero representation -- and unified/
--     standardized lockbox codes and unsealed penetrations in camera/IT
--     rooms were among the single most repeated findings across the real
--     reports reviewed.
--   - Resident amenity spaces (gym, rec/business center) have no area
--     type at all -- a real field report flagged an actual tip-over
--     hazard on unsecured gym equipment.
--   - Trash chute (as distinct from the compactor itself) and the
--     recycling baler aren't modeled -- a real field finding was
--     specifically about a trash chute hopper door not self-closing.
--   - Waste riser vent height/painting above the roof, and basement
--     ejector pits, are asked about in the templates but have no
--     component.
--   - Sidewalk elevator/vault enclosures (a common NYC pre-war feature)
--     showed up as an actual P2 code-compliance finding (masonry
--     cracking/corrosion) with nowhere to attach it.
--   - NYC-specific egress markings (photoluminescent stair markings,
--     apartment door jamb markings) are asked about in the original
--     template but were never turned into checks.
--   - A recurring theme across the real field reports that doesn't fit
--     any existing check: utility/mechanical rooms (boiler, elevator
--     machine room, gas meter room, telecom/IT room, basement) being used
--     for unauthorized storage, and egress corridors/stairwells being
--     blocked by residents' personal belongings.
--
-- Deliberately NOT included here (same reasoning as 0024's own scope
-- note): the Building Equipment Inventory / Capital Improvement Project
-- Estimates templates also reviewed represent a different capability --
-- an asset registry with age/condition/remaining-useful-life and a
-- multi-year ($) capital budget per item -- not a location-based
-- checklist item, and scoped as its own future feature instead.

-- Part 0: new area types. Nothing existing fit a dedicated gas meter
-- room, a telecom/IT/security equipment room, resident amenity spaces,
-- or a superintendent's office/back-of-house room -- all four are their
-- own named sections in the source templates and/or their own recurring
-- location in the real field reports.
insert into public.area_types (name, description) values
  ('Gas Meter Room', 'Dedicated room housing gas meters, separated from residential occupancy'),
  ('Telecom/IT Room', 'Data, intercom, CCTV/security, and building communications equipment room'),
  ('Amenity Space', 'Resident amenity areas: gym, recreation/business center, resident lounge'),
  ('Office', 'Superintendent''s office, staff room, or other administrative/back-of-house space');

-- Part 1: new component types, under both the new area types above and
-- several existing ones.
insert into public.component_types (area_type_id, name)
select at.id, comp.name
from public.area_types at
join (
  values
    ('Gas Meter Room', 'Gas Meters'),
    ('Gas Meter Room', 'Ventilation'),

    ('Telecom/IT Room', 'Intercom System'),
    ('Telecom/IT Room', 'CCTV/Camera Equipment'),

    ('Amenity Space', 'Fitness Equipment'),
    ('Amenity Space', 'Furnishings & Flooring'),

    ('Office', 'General Storage'),
    ('Office', 'Walls & Ceilings'),

    ('Roof', 'Gravity Tank'),
    ('Roof', 'Cooling Tower'),
    ('Roof', 'Chemical Treatment Tank'),
    ('Roof', 'Waste Riser Vents'),
    ('Roof', 'Access Door Lockbox'),

    ('Basement', 'Backflow Preventer/RPZ'),
    ('Basement', 'Ejector Pit/Pump'),

    ('Boiler Room', 'House/Booster Pumps'),

    ('Garbage/Compactor Room', 'Trash Chute'),
    ('Garbage/Compactor Room', 'Recycling Baler'),

    ('Lobby', 'Fire Alarm Panel'),

    ('Hallway', 'Pull Station'),
    ('Stairwell', 'Pull Station'),

    ('Entrance', 'Access Control/Lockbox'),

    ('Sidewalk', 'Sidewalk Elevator/Vault')
) as comp(area_type_name, name) on at.name = comp.area_type_name
where at.organization_id is null;

-- Part 2: new checks tied to a single (area type, component type) pair.
-- Same 1:1-unique-name discipline as 0008/0024: every `name` below is
-- unique so the join back from `inserted` can't produce a cross-product.
with new_checks (
  name, area_type_name, component_type_name, instructions, critical,
  photo_required, measurement_required, default_priority, frequency
) as (
  values
    ('Confirm gas meters are properly separated per unit/use and clearly labeled',
      'Gas Meter Room', 'Gas Meters', null, true, true, false, 'P1', 'annual'),
    ('Confirm the gas meter room has adequate ventilation per code',
      'Gas Meter Room', 'Ventilation', null, true, false, false, 'P1', 'annual'),

    ('Confirm the building intercom system is functional at the entrance and unit stations',
      'Telecom/IT Room', 'Intercom System', null, false, false, false, 'P2', 'annual'),
    ('Confirm CCTV cameras are powered, recording, and unobstructed',
      'Telecom/IT Room', 'CCTV/Camera Equipment', null, false, false, false, 'P2', 'monthly'),

    ('Confirm gym equipment is properly secured and free of tip-over or entrapment hazards',
      'Amenity Space', 'Fitness Equipment',
      'A loose or unanchored machine (e.g. a free-standing weight rack) is a life-safety hazard -- treat as urgent.',
      true, true, false, 'P1', 'monthly'),
    ('Inspect amenity space furnishings, mirrors, and flooring for damage or hazards',
      'Amenity Space', 'Furnishings & Flooring', null, false, true, false, 'P3', 'quarterly'),

    ('Confirm office/staff room storage does not obstruct egress or create fire hazards',
      'Office', 'General Storage', null, true, true, false, 'P2', 'quarterly'),
    ('Inspect office walls and ceilings for water damage or staining',
      'Office', 'Walls & Ceilings', null, false, true, false, 'P3', 'annual'),

    ('Inspect gravity tank hatch, tank condition, and dunnage structure for damage or deterioration',
      'Roof', 'Gravity Tank', null, true, true, false, 'P1', 'annual'),
    ('Inspect cooling tower structure and dunnage for cracking, corrosion, or instability',
      'Roof', 'Cooling Tower', null, true, true, false, 'P1', 'annual'),
    ('Confirm the cooling tower chemical treatment system has a functioning pump and filter',
      'Roof', 'Chemical Treatment Tank', null, false, false, false, 'P2', 'quarterly'),
    ('Confirm waste riser vent stacks extend the required height above the roof and are painted/protected',
      'Roof', 'Waste Riser Vents', null, false, true, false, 'P2', 'annual'),
    ('Confirm the roof access door lockbox/lock code matches the property''s standardized access system',
      'Roof', 'Access Door Lockbox', null, true, false, false, 'P1', 'quarterly'),

    ('Confirm the backflow preventer/RPZ device has a current, non-expired annual test tag',
      'Basement', 'Backflow Preventer/RPZ', null, true, true, false, 'P1', 'annual'),
    ('Test ejector pit pump operation and confirm no backup or odor issues',
      'Basement', 'Ejector Pit/Pump', null, true, false, false, 'P1', 'quarterly'),

    ('Inspect house/booster pumps for age, auto-toggle function, and signs of leaking or wear',
      'Boiler Room', 'House/Booster Pumps', null, true, true, false, 'P1', 'monthly'),

    ('Confirm trash chute hopper doors self-close and self-latch at every floor',
      'Garbage/Compactor Room', 'Trash Chute', null, true, false, false, 'P1', 'monthly'),
    ('Inspect recycling baler for proper operation and confirm safety interlocks engage',
      'Garbage/Compactor Room', 'Recycling Baler', null, false, false, false, 'P2', 'quarterly'),

    ('Confirm the fire alarm panel shows no active trouble/supervisory signals and is centrally monitored',
      'Lobby', 'Fire Alarm Panel', null, true, false, false, 'P1', 'monthly'),

    ('Confirm hallway fire alarm pull stations are unobstructed, correctly color-coded, and undamaged',
      'Hallway', 'Pull Station', null, true, true, false, 'P1', 'monthly'),
    ('Confirm stairwell fire alarm pull stations are unobstructed, correctly color-coded, and undamaged',
      'Stairwell', 'Pull Station', null, true, true, false, 'P1', 'monthly'),

    ('Confirm entrance lockbox/lock codes match the property''s standardized access system',
      'Entrance', 'Access Control/Lockbox', null, false, false, false, 'P2', 'quarterly'),

    ('Inspect sidewalk elevator/vault enclosure for masonry cracking, corrosion, or water infiltration',
      'Sidewalk', 'Sidewalk Elevator/Vault', null, true, true, false, 'P1', 'annual'),

    ('Confirm the standpipe system''s most recent test tag is current and not expired',
      'Boiler Room', 'Standpipe/Fire Hose', null, true, false, false, 'P1', 'annual'),

    ('Confirm the fire extinguisher''s monthly inspection tag reflects a current, non-expired inspection',
      'Storage Room', 'Fire Extinguisher', null, true, true, false, 'P1', 'monthly')
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

-- Part 3: link the fire-extinguisher tag-currency check just inserted
-- above (against Storage Room/Fire Extinguisher) to the other locations
-- that component type already exists at (Boiler Room, Electrical Room,
-- Hallway, Basement -- added in 0024 Part 1) -- same "extra
-- applicability rows against an existing check" pattern as 0024 Part 3.
insert into public.check_applicability_rules (inspection_check_id, component_type_id, rule_type)
select icl.id, ct.id, 'include'
from public.inspection_check_library icl
join (
  values
    ('Confirm the fire extinguisher''s monthly inspection tag reflects a current, non-expired inspection', 'Boiler Room', 'Fire Extinguisher'),
    ('Confirm the fire extinguisher''s monthly inspection tag reflects a current, non-expired inspection', 'Electrical Room', 'Fire Extinguisher'),
    ('Confirm the fire extinguisher''s monthly inspection tag reflects a current, non-expired inspection', 'Hallway', 'Fire Extinguisher'),
    ('Confirm the fire extinguisher''s monthly inspection tag reflects a current, non-expired inspection', 'Basement', 'Fire Extinguisher')
) as link(check_name, area_type_name, component_type_name) on icl.name = link.check_name
join public.area_types at on at.name = link.area_type_name and at.organization_id is null
join public.component_types ct
  on ct.area_type_id = at.id and ct.name = link.component_type_name and ct.organization_id is null
where icl.organization_id is null;

-- Part 4: area-level checks -- apply to every active location of that
-- area type regardless of which components are confirmed there (same
-- pattern as 0024 Part 4). These cover the recurring "this whole room is
-- being misused for storage" / "this whole corridor is blocked" findings
-- from the real field reports, plus the egress-marking and
-- lockbox-standardization items that describe an area rather than one
-- physical component.
with new_area_checks (
  name, area_type_name, instructions, critical, photo_required, default_priority, frequency
) as (
  values
    ('Confirm the gas meter room door is self-closing, secured, and free of unauthorized storage',
      'Gas Meter Room', null, true, true, 'P1', 'monthly'),
    ('Confirm the telecom/IT room is used only for its intended equipment, with panel covers in place and no unsealed ceiling/wall penetrations',
      'Telecom/IT Room', null, true, true, 'P2', 'annual'),
    ('Confirm the elevator machine room is free of unauthorized storage, has proper lighting, and windows/openings are closed and sealed',
      'Elevator Room', null, true, true, 'P1', 'quarterly'),
    ('Confirm the boiler room is free of unauthorized storage unrelated to building equipment',
      'Boiler Room', null, true, true, 'P2', 'quarterly'),
    ('Confirm basement utility spaces (water meter, booster pump, electric meter areas) are free of unauthorized storage and are properly labeled',
      'Basement', null, false, true, 'P3', 'quarterly'),
    ('Confirm rooftop safety-equipment areas and mechanical spaces are not used for unrelated storage',
      'Roof', null, false, true, 'P3', 'annual'),
    ('Confirm corridors are clear of personal belongings, doormats, or stored items blocking egress',
      'Hallway', null, true, true, 'P2', 'monthly'),
    ('Confirm apartment entry doors display required jamb markings for firefighter identification',
      'Hallway', null, false, true, 'P3', 'annual'),
    ('Confirm stairwells are clear of personal belongings, debris, or stored items blocking egress',
      'Stairwell', null, true, true, 'P2', 'monthly'),
    ('Confirm photoluminescent egress path markings on stair treads and handrails are present, visible, and undamaged',
      'Stairwell', null, true, true, 'P2', 'annual'),
    ('Look for daisy-chained extension cords, overloaded outlets, or other unsafe temporary wiring',
      'Apartment/Unit', null, true, false, 'P1', 'annual')
),
inserted as (
  insert into public.inspection_check_library (
    name, instructions, critical, photo_required, default_priority, frequency
  )
  select name, instructions, critical, photo_required, default_priority, frequency
  from new_area_checks
  returning id, name
)
insert into public.check_applicability_rules (inspection_check_id, area_type_id, rule_type)
select i.id, at.id, 'include'
from inserted i
join new_area_checks nac on nac.name = i.name
join public.area_types at on at.name = nac.area_type_name and at.organization_id is null;
