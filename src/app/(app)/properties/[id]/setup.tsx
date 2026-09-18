import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { AddAreaModal, type AreaType } from '@/components/add-area-modal';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

type LocationRow = {
  id: string;
  name: string;
  area_type_id: string;
  area_type_name: string;
  confirmed_component_count: number;
};

type GenerateResult = { created_count: number; total_active_count: number };

type RawLocationRow = {
  id: string;
  name: string;
  area_type_id: string;
  area_types: { name: string } | { name: string }[] | null;
};

const APARTMENT_UNIT_TYPE_NAME = 'Apartment/Unit';

// Pure fetch helpers, no setState -- kept outside the component and free
// of any hook so the effects below can call them directly and do all
// their state-setting inside a `.then()` written straight into the
// effect body. That's what satisfies the react-hooks/set-state-in-effect
// lint rule: it flags a setState reachable synchronously from a function
// invoked directly in an effect, even through a useCallback-memoized
// wrapper (see the identical fix in use-current-organization.ts).
async function fetchAreaTypes(): Promise<AreaType[]> {
  const { data, error } = await supabase
    .from('area_types')
    .select('id, name')
    .is('organization_id', null)
    .order('name');
  if (error) {
    logger.error('property-setup', 'Failed to load area types', error);
    return [];
  }
  return (data as AreaType[] | null) ?? [];
}

// Maps area_type_id -> every standard component_type id under it. Loaded
// once and used to auto-confirm every applicable component the instant an
// area is added (Phase 12 -- see CHANGELOG.md: areas no longer go through
// a manual "confirm which components are present" step, everything
// standard for the area type is included automatically).
async function fetchComponentTypesByAreaType(): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('component_types')
    .select('id, area_type_id')
    .is('organization_id', null);

  const map = new Map<string, string[]>();
  if (error) {
    logger.error('property-setup', 'Failed to load component types', error);
    return map;
  }
  for (const row of (data as { id: string; area_type_id: string }[] | null) ?? []) {
    const list = map.get(row.area_type_id) ?? [];
    list.push(row.id);
    map.set(row.area_type_id, list);
  }
  return map;
}

async function fetchLocations(
  propertyId: string,
): Promise<{ locations: LocationRow[]; error: string | null }> {
  const { data: locationsData, error: locationsError } = await supabase
    .from('property_locations')
    .select('id, name, area_type_id, route_order, area_types(name)')
    .eq('property_id', propertyId)
    .eq('status', 'active')
    .order('route_order', { ascending: true });

  if (locationsError) {
    logger.error('property-setup', 'Failed to load locations', locationsError);
    return { locations: [], error: "Could not load this property's areas." };
  }

  const rows = (locationsData ?? []) as RawLocationRow[];
  const locationIds = rows.map((r) => r.id);

  const confirmedCounts = new Map<string, number>();
  if (locationIds.length > 0) {
    const { data: componentsData, error: componentsError } = await supabase
      .from('location_components')
      .select('property_location_id')
      .in('property_location_id', locationIds)
      .eq('confirmed', true);
    if (componentsError) {
      logger.error('property-setup', 'Failed to load component counts', componentsError);
    } else {
      for (const row of (componentsData ?? []) as { property_location_id: string }[]) {
        confirmedCounts.set(
          row.property_location_id,
          (confirmedCounts.get(row.property_location_id) ?? 0) + 1,
        );
      }
    }
  }

  return {
    error: null,
    locations: rows.map((r) => {
      const areaTypeRow = Array.isArray(r.area_types) ? r.area_types[0] : r.area_types;
      return {
        id: r.id,
        name: r.name,
        area_type_id: r.area_type_id,
        area_type_name: areaTypeRow?.name ?? 'Unknown area',
        confirmed_component_count: confirmedCounts.get(r.id) ?? 0,
      };
    }),
  };
}

/**
 * Guided property setup wizard (Phase 4, reworked Phase 12): add each area
 * this property has and the checklist builds itself -- no per-component
 * confirmation step and no "Generate checklist" button anymore. Adding an
 * area auto-confirms every standard component for its area type and
 * immediately regenerates the checklist (see `generate_property_checklist()`
 * in migration 0009, still safe to call repeatedly). "Refresh checklist"
 * below stays only as a backfill/safety net for areas added before this
 * changed, or after a rule/library update.
 */
export default function PropertySetupScreen() {
  const { id: propertyId } = useLocalSearchParams<{ id: string }>();

  const [areaTypes, setAreaTypes] = useState<AreaType[]>([]);
  const [componentTypesByAreaType, setComponentTypesByAreaType] = useState<Map<string, string[]>>(
    new Map(),
  );
  const [locations, setLocations] = useState<LocationRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addAreaVisible, setAddAreaVisible] = useState(false);
  const [selectedAreaTypes, setSelectedAreaTypes] = useState<AreaType[]>([]);
  const [areaName, setAreaName] = useState('');
  const [bedroomCount, setBedroomCount] = useState(1);
  const [isAddingArea, setIsAddingArea] = useState(false);
  const [addAreaError, setAddAreaError] = useState<string | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [generateSummary, setGenerateSummary] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Reusable refetch, for handlers that want to reload and aren't running
  // inside an effect.
  const refreshLocations = useCallback(async () => {
    if (!propertyId) return;
    const result = await fetchLocations(propertyId);
    setLoadError(result.error);
    setLocations(result.locations);
  }, [propertyId]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([fetchAreaTypes(), fetchComponentTypesByAreaType()]).then(
      ([areaTypesResult, componentMap]) => {
        if (!isMounted) return;
        setAreaTypes(areaTypesResult);
        setComponentTypesByAreaType(componentMap);
      },
    );
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!propertyId) return;
    let isMounted = true;
    fetchLocations(propertyId).then((result) => {
      if (!isMounted) return;
      setLoadError(result.error);
      setLocations(result.locations);
    });
    return () => {
      isMounted = false;
    };
  }, [propertyId]);

  async function runGenerateChecklist() {
    if (!propertyId) return;
    setGenerateError(null);

    const { data, error } = await supabase.rpc('generate_property_checklist', {
      p_property_id: propertyId,
    });

    if (error) {
      logger.error('property-setup', 'generate_property_checklist failed', error);
      setGenerateError('Could not generate the checklist. Please try again.');
      return;
    }

    const result = data as GenerateResult | null;
    setGenerateSummary(
      result
        ? `${result.total_active_count} active check${result.total_active_count === 1 ? '' : 's'} on this property.`
        : null,
    );
  }

  async function handleAddArea() {
    if (selectedAreaTypes.length === 0 || !propertyId) return;
    setAddAreaError(null);
    setIsAddingArea(true);

    const isApartmentUnitMode =
      selectedAreaTypes.length === 1 && selectedAreaTypes[0].name === APARTMENT_UNIT_TYPE_NAME;

    const baseOrder = locations?.length ?? 0;
    const plannedRows = isApartmentUnitMode
      ? (() => {
          const apartmentType = selectedAreaTypes[0];
          const unitLabel = areaName.trim() || apartmentType.name;
          const bedrooms = Array.from({ length: Math.max(1, bedroomCount) }, (_, i) => ({
            area_type_id: apartmentType.id,
            name: `${unitLabel} — Bedroom ${i + 1}`,
          }));
          return [
            ...bedrooms,
            { area_type_id: apartmentType.id, name: `${unitLabel} — Kitchen` },
            { area_type_id: apartmentType.id, name: `${unitLabel} — Bathroom` },
            { area_type_id: apartmentType.id, name: `${unitLabel} — Living Room` },
          ];
        })()
      : selectedAreaTypes.map((areaType) => ({
          area_type_id: areaType.id,
          name: selectedAreaTypes.length === 1 ? areaName.trim() || areaType.name : areaType.name,
        }));

    const insertRows = plannedRows.map((r, index) => ({
      property_id: propertyId,
      area_type_id: r.area_type_id,
      name: r.name,
      route_order: baseOrder + index,
    }));

    const { data: insertedLocations, error } = await supabase
      .from('property_locations')
      .insert(insertRows)
      .select('id, area_type_id');

    if (error) {
      logger.error('property-setup', 'Failed to add area', error);
      setIsAddingArea(false);
      setAddAreaError(
        insertRows.length === 1
          ? 'Could not add this area. Please try again.'
          : 'Could not add these areas. Please try again.',
      );
      return;
    }

    // Auto-confirm every standard component for each new location's area
    // type -- this is what replaces the old manual "confirm components"
    // step. Not fatal if it fails: the areas themselves were created
    // successfully, this just means checklist generation below won't pick
    // up whatever didn't insert -- "Refresh checklist" can recover it.
    const componentRows = (
      insertedLocations as { id: string; area_type_id: string }[] | null
    )?.flatMap((loc) => {
      const componentTypeIds = componentTypesByAreaType.get(loc.area_type_id) ?? [];
      return componentTypeIds.map((componentTypeId) => ({
        property_location_id: loc.id,
        component_type_id: componentTypeId,
        confirmed: true,
      }));
    });

    if (componentRows && componentRows.length > 0) {
      const { error: componentsError } = await supabase
        .from('location_components')
        .insert(componentRows);
      if (componentsError) {
        logger.error('property-setup', 'Failed to auto-confirm components', componentsError);
      }
    }

    setAddAreaVisible(false);
    setSelectedAreaTypes([]);
    setAreaName('');
    setBedroomCount(1);

    await refreshLocations();
    await runGenerateChecklist();

    setIsAddingArea(false);
  }

  async function handleRefreshChecklist() {
    if (!propertyId || !locations) return;
    setIsSyncing(true);
    setGenerateError(null);

    // Backfill: any active area with zero confirmed components (added
    // before this auto-include behavior shipped) gets every standard
    // component for its area type confirmed, same as a freshly-added area.
    const needsBackfill = locations.filter((l) => l.confirmed_component_count === 0);
    const backfillRows = needsBackfill.flatMap((l) => {
      const componentTypeIds = componentTypesByAreaType.get(l.area_type_id) ?? [];
      return componentTypeIds.map((componentTypeId) => ({
        property_location_id: l.id,
        component_type_id: componentTypeId,
        confirmed: true,
      }));
    });

    if (backfillRows.length > 0) {
      const { error } = await supabase.from('location_components').insert(backfillRows);
      if (error) {
        logger.error('property-setup', 'Backfill failed', error);
      }
    }

    await runGenerateChecklist();
    await refreshLocations();
    setIsSyncing(false);
  }

  if (locations === null) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.slate} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen noPadding>
      <FlatList
        data={locations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[typography.body, styles.headerHint]}>
              Add each area this property has — every standard component and check for that area
              type is included automatically, and the checklist updates itself.
            </Text>
            {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={typography.body}>No areas added yet.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.locationRow}>
            <View style={styles.rowText}>
              <Text style={typography.bodyStrong}>{item.name}</Text>
              <Text style={[typography.caption, styles.rowSubtitle]}>
                {item.area_type_name} · {item.confirmed_component_count}{' '}
                {item.confirmed_component_count === 1 ? 'component' : 'components'} included
              </Text>
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <View style={styles.footer}>
        <Button label="+ Add area" onPress={() => setAddAreaVisible(true)} />
        <Button
          label="Refresh checklist"
          variant="secondary"
          onPress={handleRefreshChecklist}
          loading={isSyncing}
          disabled={locations.length === 0}
        />
        {generateSummary ? (
          <Text style={[typography.body, styles.summaryText]}>{generateSummary}</Text>
        ) : null}
        {generateError ? <Text style={styles.error}>{generateError}</Text> : null}
      </View>

      <AddAreaModal
        visible={addAreaVisible}
        areaTypes={areaTypes}
        selectedAreaTypes={selectedAreaTypes}
        areaName={areaName}
        bedroomCount={bedroomCount}
        onChangeBedroomCount={setBedroomCount}
        isSubmitting={isAddingArea}
        error={addAreaError}
        onToggleAreaType={(areaType) => {
          setSelectedAreaTypes((current) => {
            const isSelected = current.some((selected) => selected.id === areaType.id);
            const next = isSelected
              ? current.filter((selected) => selected.id !== areaType.id)
              : [...current, areaType];
            // Keep the name field in sync only when exactly one type is
            // selected -- that's the only state the modal shows it in.
            setAreaName(next.length === 1 ? next[0].name : '');
            setBedroomCount(1);
            return next;
          });
        }}
        onChangeAreaName={setAreaName}
        onCancel={() => {
          setAddAreaVisible(false);
          setSelectedAreaTypes([]);
          setAreaName('');
          setBedroomCount(1);
          setAddAreaError(null);
        }}
        onSubmit={handleAddArea}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  header: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  headerHint: {
    color: colors.textSecondary,
  },
  empty: {
    paddingTop: spacing.xl,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  rowSubtitle: {
    color: colors.textSecondary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  summaryText: {
    textAlign: 'center',
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
});
