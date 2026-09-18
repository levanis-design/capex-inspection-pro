-- Phase 3, migration 5 of 5: seed the platform-standard area type and
-- component type library (organization_id null = visible to everyone,
-- editable by no one). This is data, not code -- expanding this list
-- later never requires an app release, per PRODUCT_SPEC.md section 7.

insert into public.area_types (name, description) values
  ('Entrance', 'Building entrance / main access point'),
  ('Roof', 'Roof surfaces and rooftop equipment'),
  ('Exterior Elevation', 'Building facade and exterior walls'),
  ('Balcony', 'Balconies and attached exterior platforms'),
  ('Hallway', 'Interior corridors'),
  ('Lobby', 'Building lobby / entry common area'),
  ('Stairwell', 'Egress stairwells'),
  ('Apartment/Unit', 'Individual residential units'),
  ('Basement', 'Basement and below-grade areas'),
  ('Boiler Room', 'Boiler and burner equipment room'),
  ('Mechanical Room', 'HVAC and mechanical equipment room'),
  ('Electrical Room', 'Electrical panels and switchgear room'),
  ('Elevator Room', 'Elevator machine room'),
  ('Laundry Room', 'Shared laundry facilities'),
  ('Garbage/Compactor Room', 'Waste and compactor room'),
  ('Storage Room', 'General storage areas'),
  ('Sidewalk', 'Sidewalks adjacent to the property'),
  ('Yard', 'Yards and grounds'),
  ('Parking Area', 'Parking lots/garages'),
  ('Custom Area', 'Placeholder type for organization-defined custom areas');

insert into public.component_types (area_type_id, name)
select at.id, comp.name
from public.area_types at
join (values
  ('Roof', 'Membrane'), ('Roof', 'Flashing'), ('Roof', 'Drains'), ('Roof', 'Strainers'),
  ('Roof', 'Parapets'), ('Roof', 'Coping'), ('Roof', 'Bulkhead'), ('Roof', 'Skylight'),
  ('Roof', 'Chimney'), ('Roof', 'Walk Pads'), ('Roof', 'Exhaust Fans'), ('Roof', 'Rooftop Equipment'),

  ('Hallway', 'Flooring'), ('Hallway', 'Walls'), ('Hallway', 'Ceilings'), ('Hallway', 'Lighting'),
  ('Hallway', 'Emergency Lighting'), ('Hallway', 'Exit Signs'), ('Hallway', 'Doors'),
  ('Hallway', 'Fire-Rated Assemblies'), ('Hallway', 'Penetrations'),

  ('Stairwell', 'Treads'), ('Stairwell', 'Nosings'), ('Stairwell', 'Railings'), ('Stairwell', 'Guards'),
  ('Stairwell', 'Doors'), ('Stairwell', 'Self-Closing Hardware'), ('Stairwell', 'Lighting'),
  ('Stairwell', 'Emergency Lighting'), ('Stairwell', 'Fire-Rated Enclosure'),

  ('Boiler Room', 'Boilers'), ('Boiler Room', 'Burners'), ('Boiler Room', 'Pumps'), ('Boiler Room', 'Valves'),
  ('Boiler Room', 'Piping'), ('Boiler Room', 'Gauges'), ('Boiler Room', 'Controls'), ('Boiler Room', 'Tanks'),
  ('Boiler Room', 'Ventilation'), ('Boiler Room', 'Electrical Service'), ('Boiler Room', 'Floor Drains'),

  ('Mechanical Room', 'HVAC Equipment'), ('Mechanical Room', 'Pumps'), ('Mechanical Room', 'Fans'),
  ('Mechanical Room', 'Controls'), ('Mechanical Room', 'Condensate Drainage'), ('Mechanical Room', 'Ducts'),
  ('Mechanical Room', 'Insulation'), ('Mechanical Room', 'Ventilation'),

  ('Electrical Room', 'Panels'), ('Electrical Room', 'Switchgear'), ('Electrical Room', 'Conduit'),
  ('Electrical Room', 'Junction Boxes'), ('Electrical Room', 'Grounding'), ('Electrical Room', 'Clearances'),
  ('Electrical Room', 'Lighting'), ('Electrical Room', 'Emergency Systems'),

  ('Apartment/Unit', 'Entrance Door'), ('Apartment/Unit', 'Windows'), ('Apartment/Unit', 'Flooring'),
  ('Apartment/Unit', 'Walls'), ('Apartment/Unit', 'Ceilings'), ('Apartment/Unit', 'Kitchen Wet Sources'),
  ('Apartment/Unit', 'Bathroom Wet Sources'), ('Apartment/Unit', 'Toilets'), ('Apartment/Unit', 'Supply Valves'),
  ('Apartment/Unit', 'Drains'), ('Apartment/Unit', 'HVAC Equipment'), ('Apartment/Unit', 'Smoke/CO Detectors'),
  ('Apartment/Unit', 'Ventilation'), ('Apartment/Unit', 'Outlets'), ('Apartment/Unit', 'GFCIs'),

  ('Exterior Elevation', 'Facade Materials'), ('Exterior Elevation', 'Windows'), ('Exterior Elevation', 'Sealants'),
  ('Exterior Elevation', 'Penetrations'), ('Exterior Elevation', 'Balconies'), ('Exterior Elevation', 'Railings'),
  ('Exterior Elevation', 'Drainage'), ('Exterior Elevation', 'Attachments'),

  ('Garbage/Compactor Room', 'Compactor'), ('Garbage/Compactor Room', 'Containers'),
  ('Garbage/Compactor Room', 'Floor Drains'), ('Garbage/Compactor Room', 'Ventilation'),
  ('Garbage/Compactor Room', 'Lighting'), ('Garbage/Compactor Room', 'Pest-Control Devices'),

  ('Entrance', 'Doors'), ('Entrance', 'Door Hardware'), ('Entrance', 'Lighting'), ('Entrance', 'Signage'),
  ('Entrance', 'Entry Flooring/Mats'),

  ('Lobby', 'Flooring'), ('Lobby', 'Walls'), ('Lobby', 'Ceilings'), ('Lobby', 'Lighting'),
  ('Lobby', 'Mailroom'), ('Lobby', 'Entrance Doors'),

  ('Basement', 'Foundation'), ('Basement', 'Floor Drains'), ('Basement', 'Lighting'),
  ('Basement', 'Storage Areas'), ('Basement', 'Pest-Control Stations'),

  ('Elevator Room', 'Elevator Equipment'), ('Elevator Room', 'Machine Room Ventilation'), ('Elevator Room', 'Lighting'),

  ('Laundry Room', 'Washers/Dryers'), ('Laundry Room', 'Venting'), ('Laundry Room', 'Drains'), ('Laundry Room', 'Lighting'),

  ('Storage Room', 'Shelving'), ('Storage Room', 'Lighting'), ('Storage Room', 'Fire Extinguisher'),

  ('Balcony', 'Railings'), ('Balcony', 'Decking/Surface'), ('Balcony', 'Drainage'), ('Balcony', 'Attachments'),

  ('Sidewalk', 'Surface Condition'), ('Sidewalk', 'Trip Hazards'), ('Sidewalk', 'Lighting'),

  ('Yard', 'Drainage'), ('Yard', 'Fencing'), ('Yard', 'Lighting'),

  ('Parking Area', 'Surface Condition'), ('Parking Area', 'Lighting'), ('Parking Area', 'Striping'), ('Parking Area', 'Drainage')
) as comp(area_type_name, name) on at.name = comp.area_type_name
where at.organization_id is null;
