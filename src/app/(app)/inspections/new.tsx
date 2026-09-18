import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { SUPPORTED_INSPECTION_TYPES, InspectionType } from '@/lib/inspection-types';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

type PropertyOption = { id: string; name: string };
type LocationOption = { id: string; name: string };

// The 5 types that resolve their own scope server-side (no manual area
// picking) -- everything else (apartment_unit/custom) is now just
// "tap the areas you want," handled directly below rather than through
// this list. See CHANGELOG.md's Phase 12 entry.
const QUICK_INSPECTION_TYPES = SUPPORTED_INSPECTION_TYPES.filter(
  (t) => !t.requiresLocationSelection,
);

// Maps the exception codes raised by start_inspection() (see
// supabase/migrations/0012_start_inspection.sql) to messages a
// non-technical user can act on -- same pattern as properties/new.tsx's
// create_property() error mapping.
const ERROR_MESSAGES: Record<string, string> = {
  property_not_found: 'Could not find that property.',
  insufficient_permission:
    'Only an organization admin, portfolio manager, or supervisor can start an inspection.',
  inspection_type_not_yet_supported: 'That inspection type is not supported yet.',
  invalid_inspection_type: 'That inspection type is not recognized.',
  location_selection_required: 'Pick at least one area for this inspection type.',
  no_locations_in_scope:
    "No areas matched this inspection type. Set up the property's areas and checklist first.",
  not_authenticated:
    'We could not confirm your account. Try signing out and back in — if this keeps happening, contact support.',
};

function friendlyError(rawMessage: string): string {
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return ERROR_MESSAGES[code];
  }
  return 'Something went wrong starting the inspection. Please try again.';
}

// Pure fetches, no setState -- same pattern as properties/[id]/setup.tsx.
async function fetchProperties(): Promise<{ properties: PropertyOption[]; error: string | null }> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('status', 'active')
    .order('name');

  if (error) {
    logger.error('inspections-new', 'Failed to load properties', error);
    return { properties: [], error: 'Could not load your properties.' };
  }
  return { properties: (data as PropertyOption[] | null) ?? [], error: null };
}

async function fetchLocations(
  propertyId: string,
): Promise<{ locations: LocationOption[]; error: string | null }> {
  const { data, error } = await supabase
    .from('property_locations')
    .select('id, name')
    .eq('property_id', propertyId)
    .eq('status', 'active')
    .order('route_order', { ascending: true });

  if (error) {
    logger.error('inspections-new', 'Failed to load areas', error);
    return { locations: [], error: 'Could not load this property’s areas.' };
  }
  return { locations: (data as LocationOption[] | null) ?? [], error: null };
}

/**
 * Start-inspection picker (Phase 5B, reworked Phase 12): pick a property,
 * then tap the specific area(s) to inspect and start right from there
 * (this always calls start_inspection() with `custom` under the hood --
 * see migration 0012, `apartment_unit` and `custom` are functionally
 * identical, just picked locations). No inspection-type list is shown
 * until a property is picked, and area selection is never gated behind a
 * type choice anymore. The 5 types that resolve their own scope
 * server-side (comprehensive, roof, mechanical, common area, fire & life
 * safety) remain available underneath as a quick-start shortcut for when
 * you don't want to hand-pick areas.
 */
export default function NewInspectionScreen() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyOption[] | null>(null);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);

  const [locations, setLocations] = useState<LocationOption[] | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    fetchProperties().then((result) => {
      if (!isMounted) return;
      setPropertiesError(result.error);
      setProperties(result.properties);
      if (result.properties.length === 1) {
        setSelectedPropertyId(result.properties[0].id);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetches this property's areas as soon as it's picked, and resets any
  // prior area selection -- areas are always shown and always
  // selectable now, regardless of inspection type.
  useEffect(() => {
    let isMounted = true;

    const resolved: Promise<{ locations: LocationOption[] | null; error: string | null }> =
      !selectedPropertyId
        ? Promise.resolve({ locations: null, error: null })
        : fetchLocations(selectedPropertyId);

    resolved.then((result) => {
      if (!isMounted) return;
      setLocationsError(result.error);
      setLocations(result.locations);
      setSelectedLocationIds([]);
    });

    return () => {
      isMounted = false;
    };
  }, [selectedPropertyId]);

  function toggleLocation(id: string) {
    setSelectedLocationIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );
  }

  async function handleStart(type: InspectionType, locationIds: string[] | null) {
    if (!selectedPropertyId) {
      setSubmitError('Pick a property.');
      return;
    }
    setSubmitError(null);
    setIsSubmitting(true);
    const { data, error } = await supabase.rpc('start_inspection', {
      p_property_id: selectedPropertyId,
      p_inspection_type: type,
      p_location_ids: locationIds,
    });
    setIsSubmitting(false);

    if (error) {
      logger.warn('inspections-new', 'start_inspection failed', { message: error.message });
      setSubmitError(friendlyError(error.message));
      return;
    }

    router.replace(`/(app)/inspections/${data as string}`);
  }

  if (properties === null) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.slate} />
        </View>
      </Screen>
    );
  }

  if (properties.length === 0) {
    return (
      <Screen>
        <Text style={typography.body}>
          {propertiesError ?? 'Add a property before starting an inspection.'}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.label}>Property</Text>
        <View style={styles.optionList}>
          {properties.map((property) => {
            const isSelected = selectedPropertyId === property.id;
            return (
              <Pressable
                key={property.id}
                onPress={() => setSelectedPropertyId(property.id)}
                style={({ pressed }) => [
                  styles.optionRow,
                  isSelected && styles.optionRowSelected,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={isSelected ? typography.bodyStrong : typography.body}>
                  {property.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {selectedPropertyId ? (
          <>
            <Text style={[typography.label, styles.sectionSpacing]}>Areas at this property</Text>
            <Text style={[typography.caption, styles.typeDescription]}>
              Tap one or more areas, then start the inspection below.
            </Text>
            {locationsError ? <Text style={styles.error}>{locationsError}</Text> : null}
            {locations === null ? (
              <ActivityIndicator color={colors.slate} />
            ) : locations.length === 0 ? (
              <Text style={typography.body}>
                This property has no areas set up yet — set up its buildings and areas first.
              </Text>
            ) : (
              <>
                <View style={styles.optionList}>
                  {locations.map((location) => {
                    const isSelected = selectedLocationIds.includes(location.id);
                    return (
                      <Pressable
                        key={location.id}
                        onPress={() => toggleLocation(location.id)}
                        style={({ pressed }) => [
                          styles.optionRow,
                          isSelected && styles.optionRowSelected,
                          pressed && styles.rowPressed,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected }}
                      >
                        <Text style={isSelected ? typography.bodyStrong : typography.body}>
                          {location.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Button
                  label={
                    selectedLocationIds.length > 0
                      ? `Start inspection (${selectedLocationIds.length} ${selectedLocationIds.length === 1 ? 'area' : 'areas'})`
                      : 'Start inspection'
                  }
                  onPress={() => handleStart('custom', selectedLocationIds)}
                  loading={isSubmitting}
                  disabled={selectedLocationIds.length === 0}
                />

                <Text style={[typography.label, styles.sectionSpacing]}>
                  Or start a quick inspection
                </Text>
                <View style={styles.optionList}>
                  {QUICK_INSPECTION_TYPES.map((option) => (
                    <Pressable
                      key={option.value}
                      onPress={() => handleStart(option.value, null)}
                      disabled={isSubmitting}
                      style={({ pressed }) => [
                        styles.optionRow,
                        styles.typeRow,
                        pressed && styles.rowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Start ${option.label} inspection`}
                    >
                      <Text style={typography.bodyStrong}>{option.label}</Text>
                      <Text style={[typography.caption, styles.typeDescription]}>
                        {option.description}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </>
        ) : null}

        {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sectionSpacing: {
    marginTop: spacing.md,
  },
  optionList: {
    gap: spacing.xs,
  },
  optionRow: {
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeRow: {
    gap: spacing.xs,
  },
  typeDescription: {
    color: colors.textSecondary,
  },
  optionRowSelected: {
    backgroundColor: colors.background,
    borderColor: colors.slate,
  },
  rowPressed: {
    opacity: 0.6,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
