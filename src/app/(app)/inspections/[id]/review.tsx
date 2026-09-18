import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { LOCATION_STATUS_LABELS } from '@/lib/inspection-types';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/theme';

type LocationSummary = {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  itemCount: number;
  notInspectedCount: number;
};

type DeficiencyItem = {
  id: string;
  title: string;
  observation: string | null;
  locationName: string;
  /** The Phase 5D finding this item's deficiency auto-opened (see
   * supabase/migrations/0017's handle_item_deficiency() trigger) -- null
   * only in the unlikely case the lookup itself failed, since the trigger
   * guarantees one exists for every 'deficiency' item. Lets this screen
   * link straight into the deficiency detail / corrective-actions flow. */
  findingId: string | null;
};

type ReviewData = {
  inspectionId: string;
  inspectionStatus: string;
  propertyName: string;
  locations: LocationSummary[];
  deficiencies: DeficiencyItem[];
};

// Pure fetch, no setState -- same pattern as [id]/index.tsx.
async function fetchReviewData(
  inspectionId: string,
): Promise<{ data: ReviewData | null; error: string | null }> {
  const { data: snapshotRow, error: snapshotError } = await supabase
    .from('inspection_snapshots')
    .select('id, inspections(id, status, properties(name))')
    .eq('inspection_id', inspectionId)
    .single();

  if (snapshotError || !snapshotRow) {
    logger.error('inspection-review', 'Failed to load inspection', snapshotError);
    return { data: null, error: 'Could not load this inspection.' };
  }

  const row = snapshotRow as unknown as {
    id: string;
    inspections:
      | { id: string; status: string; properties: unknown }
      | { id: string; status: string; properties: unknown }[]
      | null;
  };
  const inspectionRaw = Array.isArray(row.inspections) ? row.inspections[0] : row.inspections;
  if (!inspectionRaw) {
    return { data: null, error: 'Could not load this inspection.' };
  }
  const propertiesRaw = inspectionRaw.properties as { name: string } | { name: string }[] | null;
  const propertyRaw = Array.isArray(propertiesRaw) ? propertiesRaw[0] : propertiesRaw;

  const { data: locationRows, error: locationsError } = await supabase
    .from('inspection_snapshot_locations')
    .select('id, status, status_reason, property_locations(name)')
    .eq('inspection_snapshot_id', row.id)
    .order('sequence_order');

  if (locationsError) {
    logger.error('inspection-review', 'Failed to load areas', locationsError);
    return { data: null, error: 'Could not load this inspection’s areas.' };
  }

  const locationRawRows = (locationRows ?? []) as {
    id: string;
    status: string;
    status_reason: string | null;
    property_locations: { name: string } | { name: string }[] | null;
  }[];
  const locationIds = locationRawRows.map((l) => l.id);

  let itemRows: {
    id: string;
    inspection_snapshot_location_id: string;
    title: string;
    status: string;
    observation: string | null;
  }[] = [];

  if (locationIds.length > 0) {
    const { data, error: itemsError } = await supabase
      .from('inspection_snapshot_items')
      .select('id, inspection_snapshot_location_id, title, status, observation')
      .in('inspection_snapshot_location_id', locationIds);

    if (itemsError) {
      logger.error('inspection-review', 'Failed to load checklist items', itemsError);
      return { data: null, error: 'Could not load this inspection’s checklist items.' };
    }
    itemRows = data ?? [];
  }

  const locations: LocationSummary[] = locationRawRows.map((locationRow) => {
    const propertyLocation = Array.isArray(locationRow.property_locations)
      ? locationRow.property_locations[0]
      : locationRow.property_locations;
    const itemsHere = itemRows.filter(
      (item) => item.inspection_snapshot_location_id === locationRow.id,
    );
    return {
      id: locationRow.id,
      name: propertyLocation?.name ?? 'Unknown area',
      status: locationRow.status,
      status_reason: locationRow.status_reason,
      itemCount: itemsHere.length,
      notInspectedCount: itemsHere.filter((item) => item.status === 'not_inspected').length,
    };
  });

  const deficiencyItemRows = itemRows.filter((item) => item.status === 'deficiency');

  // Phase 5D: look up each deficiency's auto-opened finding (see
  // supabase/migrations/0017) so this screen can link straight into the
  // corrective-actions flow instead of just describing the deficiency.
  // Best-effort -- a failed lookup just means those cards render without
  // a link, not a broken review screen.
  let findingIdByItemId: Record<string, string> = {};
  if (deficiencyItemRows.length > 0) {
    const { data: findingRows, error: findingsError } = await supabase
      .from('findings')
      .select('id, inspection_snapshot_item_id')
      .in(
        'inspection_snapshot_item_id',
        deficiencyItemRows.map((item) => item.id),
      );
    if (findingsError) {
      logger.error('inspection-review', 'Failed to load findings for deficiencies', findingsError);
    } else {
      findingIdByItemId = Object.fromEntries(
        (findingRows ?? [])
          .filter((row) => row.inspection_snapshot_item_id)
          .map((row) => [row.inspection_snapshot_item_id as string, row.id as string]),
      );
    }
  }

  const deficiencies: DeficiencyItem[] = deficiencyItemRows.map((item) => {
    const location = locations.find((l) => l.id === item.inspection_snapshot_location_id);
    return {
      id: item.id,
      title: item.title,
      observation: item.observation,
      locationName: location?.name ?? 'Unknown area',
      findingId: findingIdByItemId[item.id] ?? null,
    };
  });

  return {
    data: {
      inspectionId: inspectionRaw.id,
      inspectionStatus: inspectionRaw.status,
      propertyName: propertyRaw?.name ?? 'Unknown property',
      locations,
      deficiencies,
    },
    error: null,
  };
}

/**
 * Final review screen (Phase 5B). Per PRODUCT_SPEC.md section 8, this is
 * where every not-inspected/inaccessible/skipped area gets surfaced
 * before submission -- the walkthrough screen itself doesn't block
 * navigation between areas, this screen is the actual gate. Submission
 * isn't hard-blocked when something's incomplete (the spec only requires
 * surfacing it, not forbidding it -- a real inspection sometimes has a
 * locked mechanical room and still needs to be closed out) but it does
 * require an explicit, differently-labeled confirmation rather than the
 * same one-tap button a clean inspection gets.
 */
export default function InspectionReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [review, setReview] = useState<ReviewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const result = await fetchReviewData(id);
    if (result.error || !result.data) {
      setLoadError(result.error ?? 'Could not load this inspection.');
      return;
    }
    setLoadError(null);
    setReview(result.data);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!review) {
    return (
      <Screen>
        <View style={styles.centered}>
          {loadError ? (
            <Text style={[typography.body, styles.errorText]}>{loadError}</Text>
          ) : (
            <ActivityIndicator color={colors.slate} />
          )}
        </View>
      </Screen>
    );
  }

  // Anything other than 'complete' is worth surfacing here -- a location
  // still 'pending'/'in_progress' genuinely has unrecorded work, while
  // 'skipped'/'inaccessible'/'not_applicable' are terminal but still
  // belong in the summary (with their required reason) per
  // PRODUCT_SPEC.md section 8's "surfaces all of them before submission."
  const incompleteLocations = review.locations.filter((l) => l.status !== 'complete');
  const notInspectedTotal = review.locations.reduce((sum, l) => sum + l.notInspectedCount, 0);
  const isClean = incompleteLocations.length === 0 && notInspectedTotal === 0;
  const alreadySubmitted = review.inspectionStatus === 'completed';

  async function handleSubmit() {
    if (!review) return;
    setSubmitError(null);
    setIsSubmitting(true);
    const { error } = await supabase
      .from('inspections')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', review.inspectionId);
    setIsSubmitting(false);

    if (error) {
      logger.error('inspection-review', 'Failed to submit inspection', error);
      setSubmitError('Could not submit this inspection. Please try again.');
      return;
    }

    router.replace('/(app)/inspections');
  }

  return (
    <Screen noPadding>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.screenTitle}>{review.propertyName}</Text>

        {alreadySubmitted ? (
          <>
            <Text style={[typography.body, styles.readOnlyBanner]}>
              This inspection was already submitted.
            </Text>
            <Pressable
              onPress={() => router.push(`/(app)/inspections/${review.inspectionId}/report`)}
              style={({ pressed }) => [styles.reportLink, pressed && styles.reportLinkPressed]}
              accessibilityRole="button"
              accessibilityLabel="View this inspection's report"
            >
              <Text style={[typography.bodyStrong, styles.reportLinkText]}>View report →</Text>
            </Pressable>
          </>
        ) : isClean ? (
          <Text style={[typography.body, styles.cleanBanner]}>
            Every area is complete and every item has been recorded.
          </Text>
        ) : (
          <View style={styles.warningBanner}>
            <Text style={[typography.bodyStrong, styles.warningTitle]}>
              This inspection isn&apos;t fully recorded yet
            </Text>
            {incompleteLocations.map((l) => (
              <Text key={l.id} style={[typography.body, styles.warningLine]}>
                {l.name}: {LOCATION_STATUS_LABELS[l.status] ?? l.status}
                {l.status_reason ? ` — ${l.status_reason}` : ''}
                {l.notInspectedCount > 0
                  ? ` (${l.notInspectedCount} item${l.notInspectedCount === 1 ? '' : 's'} not inspected)`
                  : ''}
              </Text>
            ))}
          </View>
        )}

        {review.deficiencies.length > 0 ? (
          <View style={styles.deficiencySection}>
            <Text style={typography.sectionTitle}>Deficiencies ({review.deficiencies.length})</Text>
            {review.deficiencies.map((d) => {
              const card = (
                <>
                  <Text style={typography.bodyStrong}>{d.title}</Text>
                  <Text style={typography.caption}>{d.locationName}</Text>
                  {d.observation ? (
                    <Text style={[typography.body, styles.deficiencyObservation]}>
                      {d.observation}
                    </Text>
                  ) : (
                    <Text style={[typography.caption, styles.missingObservation]}>
                      No observation recorded yet.
                    </Text>
                  )}
                  {d.findingId ? (
                    <Text style={[typography.caption, styles.deficiencyLink]}>
                      Tap to track its corrective action →
                    </Text>
                  ) : null}
                </>
              );
              return d.findingId ? (
                <Pressable
                  key={d.id}
                  onPress={() => router.push(`/(app)/corrective-actions/${d.findingId}`)}
                  style={({ pressed }) => [
                    styles.deficiencyCard,
                    pressed && styles.deficiencyCardPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${d.title} in corrective actions`}
                >
                  {card}
                </Pressable>
              ) : (
                <View key={d.id} style={styles.deficiencyCard}>
                  {card}
                </View>
              );
            })}
          </View>
        ) : null}

        {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
      </ScrollView>

      {!alreadySubmitted ? (
        <View style={styles.footer}>
          <Button
            label={isClean ? 'Submit inspection' : 'Submit anyway'}
            variant={isClean ? 'primary' : 'danger'}
            onPress={handleSubmit}
            loading={isSubmitting}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
  },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  readOnlyBanner: {
    color: colors.textSecondary,
  },
  reportLink: {
    alignSelf: 'flex-start',
  },
  reportLinkPressed: {
    opacity: 0.7,
  },
  reportLinkText: {
    color: colors.info,
  },
  cleanBanner: {
    color: colors.statusSatisfactory,
  },
  warningBanner: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  warningTitle: {
    color: colors.warning,
  },
  warningLine: {
    color: colors.textSecondary,
  },
  deficiencySection: {
    gap: spacing.sm,
  },
  deficiencyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  deficiencyObservation: {
    color: colors.textPrimary,
  },
  missingObservation: {
    color: colors.textDisabled,
    fontStyle: 'italic',
  },
  deficiencyCardPressed: {
    opacity: 0.7,
  },
  deficiencyLink: {
    color: colors.info,
    marginTop: spacing.xs,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
