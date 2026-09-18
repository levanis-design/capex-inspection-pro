-- Phase 4, migration 4: a unique constraint on location_components so the
-- guided setup wizard can upsert a component's confirmed state cleanly
-- (confirm it, or un-confirm a mistake) instead of needing a
-- select-then-insert-or-update round trip. Without this, nothing stopped
-- the same component type from being added twice at the same location,
-- which would also have let the checklist generator see it as two
-- separate components and (harmlessly, but confusingly) generate the
-- same check assignment through two different location_component_id
-- values.
create unique index location_components_unique_location_component
  on public.location_components (property_location_id, component_type_id);
