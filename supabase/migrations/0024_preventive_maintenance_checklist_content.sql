-- Phase 13: preventive-maintenance checklist content. The user supplied a
-- broader "preventive maintenance checklist" (8 sections: exterior, MEP,
-- fire/life safety, interior common areas, basement/service, site/
-- grounds, pest prevention, compliance) as a target for this app to
-- cover. Everything in this migration is DATA, not code -- exactly like
-- 0005/0008 before it: it adds missing component_types and
-- inspection_check_library/check_applicability_rules rows so the
-- existing generate_property_checklist() (migration 0009) picks them up
-- automatically, same as anything else in the standard library. No new
-- inspection_type, no schema change, no app code change. Each checklist
-- item already gets a checkbox (item status), a comment (the
-- `observation` field), and a camera photo for free from the existing
-- inspection walkthrough (src/app/(app)/inspections/[id]/index.tsx) --
-- that per-item interaction model was already generic, this migration
-- just gives it more content to work with.
--
-- Deliberately NOT included here: the source checklist's "Compliance &
-- Documentation" section (boiler/elevator/fire-safety certificate
-- expirations, FISP/LL11 status, log reviews, vendor reports). That's
-- property-level document/date tracking, not a physical
-- checkbox-at-a-location item, and doesn't fit this table's shape --
-- it's being scoped as its own future feature instead of forced in here.

-- Part 1: new component types under area types that already exist.
-- Nothing in the source checklist needs a new area_type.
insert into public.component_types (area_type_id, name)
select at.id, comp.name
from public.area_types at
join (
  values
    ('Boiler Room', 'Water Heater'),
    ('Boiler Room', 'Sprinkler System'),
    ('Boiler Room', 'Standpipe/Fire Hose'),
    ('Boiler Room', 'Fire Pump'),
    ('Basement', 'Sump Pump'),
    ('Basement', 'Water Meter'),
    ('Elevator Room', 'Elevator Cab'),
    ('Yard', 'Security Cameras'),
    ('Parking Area', 'Security Cameras'),
    -- Fire Extinguisher and GFCIs already exist (Storage Room, and
    -- Apartment/Unit respectively) but the source checklist expects them
    -- much more broadly -- these add the same component type name under
    -- more area types, so Part 3 below can link them to the checks that
    -- already cover that component type everywhere else.
    ('Boiler Room', 'Fire Extinguisher'),
    ('Electrical Room', 'Fire Extinguisher'),
    ('Hallway', 'Fire Extinguisher'),
    ('Basement', 'Fire Extinguisher'),
    ('Hallway', 'GFCIs'),
    ('Basement', 'GFCIs'),
    ('Hallway', 'Smoke/CO Detectors')
) as comp(area_type_name, name) on at.name = comp.area_type_name
where at.organization_id is null;

-- Part 2: new checks tied to a single (area type, component type) pair
-- -- covers both component types that already existed and the ones just
-- added in Part 1 above (this migration's inserts are all visible to
-- each other within the same script). Same pattern as 0008: every
-- `name` below is unique so the join back from `inserted` can't produce
-- a cross-product -- where the source checklist would naturally reuse
-- identical wording across two locations (e.g. "inspect windows..." for
-- both Exterior Elevation and Apartment/Unit), the wording is varied
-- slightly per row specifically to keep that join 1:1.
with new_checks (
  name, area_type_name, component_type_name, instructions, critical,
  photo_required, measurement_required, default_priority, frequency
) as (
  values
    ('Inspect parapets for displacement, cracking, or instability',
      'Roof', 'Parapets', null, true, true, false, 'P1', 'annual'),
    ('Inspect roofline coping stones for displacement or instability',
      'Roof', 'Coping', null, true, true, false, 'P1', 'annual'),
    ('Confirm protective walk pads are intact and properly positioned along the maintenance path',
      'Roof', 'Walk Pads', null, false, false, false, 'P3', 'annual'),
    ('Confirm rooftop exhaust fans run smoothly and are free of debris',
      'Roof', 'Exhaust Fans', null, false, false, false, 'P2', 'quarterly'),

    ('Inspect exterior windows for failed caulking, cracked or fogged glazing, and confirm sash operability and locking hardware',
      'Exterior Elevation', 'Windows', null, false, true, false, 'P2', 'annual'),
    ('Inspect unit windows for failed caulking, cracked or fogged glazing, and confirm sash operability and locking hardware',
      'Apartment/Unit', 'Windows', null, false, true, false, 'P2', 'annual'),

    ('Inspect boiler room pumps and belts for wear, vibration, or unusual noise',
      'Boiler Room', 'Pumps', null, false, false, false, 'P2', 'monthly'),
    ('Inspect mechanical room pumps and belts for wear, vibration, or unusual noise',
      'Mechanical Room', 'Pumps', null, false, false, false, 'P2', 'monthly'),
    ('Inspect PTAC/central HVAC filters and coils for cleanliness and proper airflow',
      'Mechanical Room', 'HVAC Equipment', null, false, false, false, 'P2', 'quarterly'),
    ('Inspect in-unit HVAC filters and coils for cleanliness and proper airflow',
      'Apartment/Unit', 'HVAC Equipment', null, false, false, false, 'P2', 'quarterly'),
    ('Confirm mechanical room exhaust fans are operational and free of debris buildup',
      'Mechanical Room', 'Fans', null, false, false, false, 'P2', 'quarterly'),

    ('Inspect conduit runs for physical damage or signs of moisture intrusion',
      'Electrical Room', 'Conduit', null, true, true, false, 'P1', 'annual'),
    ('Confirm junction boxes are properly covered, labeled, and free of moisture',
      'Electrical Room', 'Junction Boxes', null, true, true, false, 'P1', 'annual'),

    ('Inspect hot water heater for rust, discharge, or pressure-relief issues',
      'Boiler Room', 'Water Heater', null, true, true, false, 'P1', 'annual'),
    ('Confirm sprinkler control valves are open and gauges show normal pressure',
      'Boiler Room', 'Sprinkler System', null, true, false, true, 'P1', 'monthly'),
    ('Inspect fire hoses and standpipe valves for accessibility and condition (NYC-specific buildings)',
      'Boiler Room', 'Standpipe/Fire Hose', null, true, true, false, 'P1', 'annual'),
    ('Review fire pump test logs and confirm the most recent test is current',
      'Boiler Room', 'Fire Pump', null, true, false, false, 'P1', 'monthly'),

    ('Test sump pump operation and confirm backup power source if equipped',
      'Basement', 'Sump Pump', null, true, false, false, 'P1', 'quarterly'),
    ('Record water meter reading and compare against the prior reading for unexplained spikes',
      'Basement', 'Water Meter', null, false, false, true, 'P2', 'monthly'),
    ('Inspect foundation walls for cracks, shifting, or structural movement',
      'Basement', 'Foundation', null, true, true, false, 'P1', 'annual'),
    ('Verify rodent bait stations are in place, intact, and being monitored on schedule',
      'Basement', 'Pest-Control Stations', null, false, false, false, 'P2', 'monthly'),

    ('Confirm site drainage directs water away from the building foundation',
      'Yard', 'Drainage', null, false, true, false, 'P2', 'annual'),
    ('Confirm exterior yard lighting is functioning at night',
      'Yard', 'Lighting', null, false, false, false, 'P2', 'monthly'),
    ('Confirm exterior security cameras are powered and recording',
      'Yard', 'Security Cameras', null, false, false, false, 'P2', 'monthly'),
    ('Confirm parking area security cameras are powered and recording',
      'Parking Area', 'Security Cameras', null, false, false, false, 'P2', 'monthly'),

    ('Inspect elevator cab door tracks, ride quality, and floor leveling',
      'Elevator Room', 'Elevator Cab', null, true, false, false, 'P1', 'monthly'),

    ('Inspect mailroom for structural damage or moisture intrusion',
      'Lobby', 'Mailroom', null, false, true, false, 'P3', 'annual'),

    ('Inspect hallway flooring for loose tiles, trip hazards, or damage',
      'Hallway', 'Flooring', null, false, true, false, 'P2', 'monthly'),
    ('Inspect hallway walls for cracks, staining, or bubbling paint',
      'Hallway', 'Walls', null, false, true, false, 'P3', 'annual'),
    ('Inspect hallway ceilings for cracks, staining, or bubbling paint',
      'Hallway', 'Ceilings', null, false, true, false, 'P3', 'annual'),
    ('Inspect lobby walls for cracks, staining, or bubbling paint',
      'Lobby', 'Walls', null, false, true, false, 'P3', 'annual'),
    ('Inspect lobby ceilings for cracks, staining, or bubbling paint',
      'Lobby', 'Ceilings', null, false, true, false, 'P3', 'annual'),

    ('Confirm garbage room ventilation and general sanitation are adequate',
      'Garbage/Compactor Room', 'Ventilation', null, false, false, false, 'P3', 'monthly')
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

-- Part 3: link the component types added in Part 1 for Fire Extinguisher/
-- GFCIs/Smoke & CO Detectors to the check that ALREADY covers that
-- component type everywhere else (from 0008) -- these are additional
-- check_applicability_rules rows against an existing
-- inspection_check_library row, not new checks.
insert into public.check_applicability_rules (inspection_check_id, component_type_id, rule_type)
select icl.id, ct.id, 'include'
from public.inspection_check_library icl
join (
  values
    ('Confirm fire extinguisher is charged, tagged, and unobstructed', 'Boiler Room', 'Fire Extinguisher'),
    ('Confirm fire extinguisher is charged, tagged, and unobstructed', 'Electrical Room', 'Fire Extinguisher'),
    ('Confirm fire extinguisher is charged, tagged, and unobstructed', 'Hallway', 'Fire Extinguisher'),
    ('Confirm fire extinguisher is charged, tagged, and unobstructed', 'Basement', 'Fire Extinguisher'),
    ('Test that GFCI outlets trip and reset correctly', 'Hallway', 'GFCIs'),
    ('Test that GFCI outlets trip and reset correctly', 'Basement', 'GFCIs'),
    ('Test that smoke and carbon monoxide detectors are present and functioning', 'Hallway', 'Smoke/CO Detectors')
) as link(check_name, area_type_name, component_type_name) on icl.name = link.check_name
join public.area_types at on at.name = link.area_type_name and at.organization_id is null
join public.component_types ct
  on ct.area_type_id = at.id and ct.name = link.component_type_name and ct.organization_id is null
where icl.organization_id is null;

-- Part 4: area-level checks -- apply to every active location of that
-- area type regardless of which components are confirmed there
-- (component_type_id left null on the rule; see generate_property_
-- checklist()'s area-level branch in migration 0009). These cover source
-- checklist items that describe the area as a whole rather than one
-- physical component (a general water-stain/leak note, general pest
-- evidence, general storage-room fire-hazard housekeeping).
with new_area_checks (
  name, area_type_name, instructions, critical, photo_required, default_priority, frequency
) as (
  values
    ('Note any areas where water staining indicates a hidden leak',
      'Exterior Elevation', null, false, true, 'P2', 'annual'),
    ('Look for droppings, gnaw marks, or other evidence of pest activity in the basement',
      'Basement', null, false, true, 'P2', 'monthly'),
    ('Look for droppings, gnaw marks, or other evidence of pest activity in the garbage/compactor room',
      'Garbage/Compactor Room', null, false, true, 'P2', 'monthly'),
    ('Inspect storage room contents for fire hazards -- blocked exits, improperly stored flammables, or obstructed extinguisher access',
      'Storage Room', null, true, true, 'P1', 'quarterly')
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
