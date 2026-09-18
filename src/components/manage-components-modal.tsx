import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/button';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

export type LocationSummary = {
  id: string;
  name: string;
  area_type_id: string;
  area_type_name: string;
};

type ComponentRow = { id: string; name: string; confirmed: boolean };

type ManageComponentsModalProps = {
  location: LocationSummary;
  onClose: () => void;
};

// Pure fetch, no setState -- see the identical pattern (and the reason
// for it) in properties/[id]/setup.tsx and use-current-organization.ts.
async function fetchComponents(
  areaTypeId: string,
  locationId: string,
): Promise<{ components: ComponentRow[]; error: string | null }> {
  const [componentTypesResult, locationComponentsResult] = await Promise.all([
    supabase
      .from('component_types')
      .select('id, name')
      .eq('area_type_id', areaTypeId)
      .is('organization_id', null)
      .order('name'),
    supabase
      .from('location_components')
      .select('component_type_id, confirmed')
      .eq('property_location_id', locationId),
  ]);

  if (componentTypesResult.error) {
    logger.error('manage-components', 'Failed to load component types', componentTypesResult.error);
    return { components: [], error: 'Could not load components for this area.' };
  }

  const confirmedMap = new Map<string, boolean>();
  for (const row of (locationComponentsResult.data ?? []) as {
    component_type_id: string;
    confirmed: boolean;
  }[]) {
    confirmedMap.set(row.component_type_id, row.confirmed);
  }

  return {
    error: null,
    components: ((componentTypesResult.data ?? []) as { id: string; name: string }[]).map((ct) => ({
      id: ct.id,
      name: ct.name,
      confirmed: confirmedMap.get(ct.id) ?? false,
    })),
  };
}

/**
 * "Confirm components" step of the guided setup wizard (Phase 4): shows
 * every standard component for this location's area type, checked if
 * already confirmed present. Toggling upserts `location_components`
 * (confirmed true/false) immediately -- there's no separate "save" step,
 * so closing this modal at any point leaves exactly what's checked.
 * PRODUCT_SPEC.md section 7: "guided setup never auto-activates a
 * suggested component without explicit user confirmation" -- every
 * component here starts unchecked until the user taps it.
 */
export function ManageComponentsModal({ location, onClose }: ManageComponentsModalProps) {
  const [components, setComponents] = useState<ComponentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchComponents(location.area_type_id, location.id).then((result) => {
      if (!isMounted) return;
      setLoadError(result.error);
      setComponents(result.components);
    });
    return () => {
      isMounted = false;
    };
  }, [location.area_type_id, location.id]);

  async function handleToggle(componentTypeId: string, nextValue: boolean) {
    setPendingId(componentTypeId);
    setComponents((prev) =>
      prev
        ? prev.map((c) => (c.id === componentTypeId ? { ...c, confirmed: nextValue } : c))
        : prev,
    );

    const { error } = await supabase.from('location_components').upsert(
      {
        property_location_id: location.id,
        component_type_id: componentTypeId,
        confirmed: nextValue,
      },
      { onConflict: 'property_location_id,component_type_id' },
    );

    setPendingId(null);

    if (error) {
      logger.error('manage-components', 'Failed to toggle component', error);
      // Revert the optimistic update on failure so the checkbox reflects
      // what's actually saved, not what the user tapped.
      setComponents((prev) =>
        prev
          ? prev.map((c) => (c.id === componentTypeId ? { ...c, confirmed: !nextValue } : c))
          : prev,
      );
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>{location.name}</Text>
          <Text style={[typography.caption, styles.subtitle]}>
            {location.area_type_name} — check off what&apos;s actually present
          </Text>

          {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

          {components === null ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.slate} />
            </View>
          ) : (
            <ScrollView style={styles.list}>
              {components.map((component) => (
                <Pressable
                  key={component.id}
                  onPress={() => handleToggle(component.id, !component.confirmed)}
                  disabled={pendingId === component.id}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: component.confirmed }}
                >
                  <Ionicons
                    name={component.confirmed ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={component.confirmed ? colors.slate : colors.textDisabled}
                  />
                  <Text style={typography.body}>{component.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Button label="Done" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: '85%',
  },
  subtitle: {
    marginTop: -spacing.sm,
  },
  centered: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  list: {
    maxHeight: 360,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xs,
  },
  rowPressed: {
    opacity: 0.6,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
