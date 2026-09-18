import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '@/components/screen';
import { PRIORITY_LABELS } from '@/lib/corrective-action-types';
import {
  DashboardMetrics,
  fetchDashboardMetrics,
  fetchDashboardProperties,
  PropertyOption,
} from '@/lib/dashboard';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

/**
 * Dashboard & Analytics (Phase 8, PRODUCT_SPEC.md section 12). Portfolio-
 * level counts, an optional single-property filter, and quick links into
 * the Properties/Inspections/Corrective Actions tabs -- see dashboard.ts
 * for exactly where each count comes from and what "open"/"overdue" mean
 * here.
 *
 * Every stat on this screen is informational only, per the spec's own
 * "remaining-slot indicators (informational only)" framing -- nothing
 * here writes anything or gates any action. Tapping a row just navigates
 * to the tab that actually manages that data.
 *
 * Phase 16 addition: a "Compliance" section with portfolio-wide document/
 * task attention counts. Unlike every other section here, there's no
 * portfolio-wide compliance list screen to route to (compliance documents
 * and tasks are both per-property screens), so tapping either row routes
 * to that specific property's compliance screen when the property filter
 * is narrowed to one, or to the Properties tab (to pick one) when it's
 * set to "All properties."
 */
export default function DashboardScreen() {
  const router = useRouter();
  const { data: organization } = useCurrentOrganization();
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (propertyId: string | null) => {
    const [propertiesResult, metricsResult] = await Promise.all([
      fetchDashboardProperties(),
      fetchDashboardMetrics(propertyId),
    ]);
    setProperties(propertiesResult.properties);
    if (metricsResult.error) {
      setLoadError(metricsResult.error);
      return;
    }
    setLoadError(null);
    setMetrics(metricsResult.metrics);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(selectedPropertyId);
    }, [load, selectedPropertyId]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load(selectedPropertyId);
    setIsRefreshing(false);
  }

  const slotLimit = organization?.propertySlotLimit ?? null;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <Screen>
        <Text style={typography.screenTitle}>Dashboard</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <FilterPill
            label="All properties"
            selected={selectedPropertyId === null}
            onPress={() => setSelectedPropertyId(null)}
          />
          {properties.map((property) => (
            <FilterPill
              key={property.id}
              label={property.name}
              selected={selectedPropertyId === property.id}
              onPress={() => setSelectedPropertyId(property.id)}
            />
          ))}
        </ScrollView>

        {loadError ? <Text style={[typography.body, styles.errorText]}>{loadError}</Text> : null}

        {metrics === null ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.slate} />
          </View>
        ) : (
          <>
            {selectedPropertyId === null && slotLimit !== null ? (
              <Section title="Properties">
                <StatRow
                  label="Property slots used"
                  value={`${metrics.propertiesUsed} of ${slotLimit}`}
                  onPress={() => router.push('/(app)/properties')}
                />
              </Section>
            ) : null}

            <Section title="Inspections">
              <StatRow
                label="Scheduled"
                value={metrics.inspections.scheduled}
                onPress={() => router.push('/(app)/inspections')}
              />
              <StatRow
                label="In progress"
                value={metrics.inspections.inProgress}
                onPress={() => router.push('/(app)/inspections')}
              />
              <StatRow
                label="Completed"
                value={metrics.inspections.completed}
                onPress={() => router.push('/(app)/inspections')}
              />
              <StatRow
                label="Postponed"
                value={metrics.inspections.postponed}
                onPress={() => router.push('/(app)/inspections')}
              />
              <StatRow
                label="Overdue"
                value={metrics.inspections.overdue}
                highlight={metrics.inspections.overdue > 0}
                onPress={() => router.push('/(app)/inspections')}
              />
            </Section>

            <Section title="Open findings">
              <StatRow
                label={PRIORITY_LABELS.P1}
                value={metrics.findings.p1}
                highlight={metrics.findings.p1 > 0}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
              <StatRow
                label={PRIORITY_LABELS.P2}
                value={metrics.findings.p2}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
              <StatRow
                label={PRIORITY_LABELS.P3}
                value={metrics.findings.p3}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
              <StatRow
                label={PRIORITY_LABELS.P4}
                value={metrics.findings.p4}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
              {metrics.findings.unprioritized > 0 ? (
                <StatRow
                  label="Not yet prioritized"
                  value={metrics.findings.unprioritized}
                  onPress={() => router.push('/(app)/corrective-actions')}
                />
              ) : null}
              <StatRow
                label="Escalated"
                value={metrics.findings.escalated}
                highlight={metrics.findings.escalated > 0}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
              <StatRow
                label="Total open"
                value={metrics.findings.totalOpen}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
            </Section>

            <Section title="Corrective actions">
              <StatRow
                label="Open"
                value={metrics.correctiveActions.totalOpen}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
              <StatRow
                label="Overdue"
                value={metrics.correctiveActions.overdue}
                highlight={metrics.correctiveActions.overdue > 0}
                onPress={() => router.push('/(app)/corrective-actions')}
              />
            </Section>

            <Section title="Compliance">
              <StatRow
                label="Documents needing attention"
                value={metrics.compliance.documentsAttention}
                highlight={metrics.compliance.documentsAttention > 0}
                onPress={() =>
                  selectedPropertyId
                    ? router.push(`/(app)/properties/${selectedPropertyId}/compliance`)
                    : router.push('/(app)/properties')
                }
              />
              <StatRow
                label="Tasks needing attention"
                value={metrics.compliance.tasksAttention}
                highlight={metrics.compliance.tasksAttention > 0}
                onPress={() =>
                  selectedPropertyId
                    ? router.push(`/(app)/properties/${selectedPropertyId}/compliance-tasks`)
                    : router.push('/(app)/properties')
                }
              />
            </Section>
          </>
        )}
      </Screen>
    </ScrollView>
  );
}

function FilterPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterPill,
        selected && styles.filterPillSelected,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[typography.caption, selected && styles.filterPillTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={typography.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function StatRow({
  label,
  value,
  onPress,
  highlight,
}: {
  label: string;
  value: number | string;
  onPress: () => void;
  highlight?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.statRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={typography.body}>{label}</Text>
      <View style={styles.statRowRight}>
        <Text style={[typography.bodyStrong, highlight && styles.highlightText]}>{value}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxl,
  },
  errorText: {
    color: colors.danger,
    marginTop: spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingRight: spacing.lg,
  },
  filterPill: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillSelected: {
    backgroundColor: colors.slate,
    borderColor: colors.slate,
  },
  filterPillTextSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  rowPressed: {
    opacity: 0.6,
  },
  section: {
    marginTop: spacing.xxl,
    gap: spacing.sm,
  },
  sectionBody: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  highlightText: {
    color: colors.danger,
  },
});
