import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { computeDisplayStatus } from '@/lib/compliance-document-types';
import { computeTaskDueStatus } from '@/lib/compliance-task-types';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/theme';

type PropertyDetail = {
  id: string;
  name: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  status: string;
};

const DELETE_ERROR_MESSAGES: Record<string, string> = {
  property_has_inspections:
    'This property has inspection history and can’t be permanently deleted. Archive it instead to hide it without losing that history.',
  insufficient_permission: 'Only an organization admin can permanently delete a property.',
  property_not_found: 'This property could not be found.',
};

function friendlyDeleteError(rawMessage: string): string {
  for (const code of Object.keys(DELETE_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return DELETE_ERROR_MESSAGES[code];
  }
  return 'Could not delete this property. Please try again.';
}

/**
 * Property detail (Phase 4): a small dashboard for one property, with a
 * count of areas set up and active checklist items, and the entry point
 * into the guided setup wizard. Editing the property's own fields (name,
 * address, etc.) isn't built yet -- this screen is read-only on that
 * front for now.
 */
export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [locationCount, setLocationCount] = useState<number | null>(null);
  const [activeCheckCount, setActiveCheckCount] = useState<number | null>(null);
  const [complianceAttentionCount, setComplianceAttentionCount] = useState<number>(0);
  const [taskAttentionCount, setTaskAttentionCount] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;

    const [propertyResult, locationCountResult, checkCountResult, complianceResult, tasksResult] =
      await Promise.all([
        supabase
          .from('properties')
          .select('id, name, street_address, city, state, status')
          .eq('id', id)
          .single(),
        supabase
          .from('property_locations')
          .select('id', { count: 'exact', head: true })
          .eq('property_id', id)
          .eq('status', 'active'),
        supabase
          .from('property_check_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('property_id', id)
          .eq('status', 'active'),
        supabase
          .from('compliance_documents')
          .select('status, expiration_date')
          .eq('property_id', id),
        supabase
          .from('compliance_tasks')
          .select('id, frequency')
          .eq('property_id', id)
          .eq('status', 'active'),
      ]);

    if (propertyResult.error) {
      logger.error('property-detail', 'Failed to load property', propertyResult.error);
      setLoadError('Could not load this property.');
      return;
    }
    setLoadError(null);
    setProperty(propertyResult.data as PropertyDetail);
    setLocationCount(locationCountResult.count ?? 0);
    setActiveCheckCount(checkCountResult.count ?? 0);

    // Not a count(*) query -- "expiring soon"/"expired" is derived from
    // expiration_date at read time (see compliance-document-types.ts's
    // computeDisplayStatus), so the rows have to be fetched to count them.
    const complianceRows =
      (complianceResult.data as { status: string; expiration_date: string | null }[] | null) ?? [];
    const attentionCount = complianceRows.filter((row) => {
      const displayStatus = computeDisplayStatus(row.status, row.expiration_date);
      return displayStatus === 'expired' || displayStatus === 'expiring_soon';
    }).length;
    setComplianceAttentionCount(attentionCount);

    // Same "derive at read time" approach as compliance_documents above --
    // fetch each active task's most recent completion, then compute its
    // due status client-side (computeTaskDueStatus) rather than trusting
    // any stored status.
    const taskRows = (tasksResult.data as { id: string; frequency: string }[] | null) ?? [];
    if (taskRows.length === 0) {
      setTaskAttentionCount(0);
    } else {
      const { data: completionRows } = await supabase
        .from('compliance_task_completions')
        .select('compliance_task_id, completed_at')
        .in(
          'compliance_task_id',
          taskRows.map((t) => t.id),
        )
        .order('completed_at', { ascending: false });

      const latestByTask: Record<string, string> = {};
      for (const row of (completionRows as {
        compliance_task_id: string;
        completed_at: string;
      }[]) ?? []) {
        if (!latestByTask[row.compliance_task_id])
          latestByTask[row.compliance_task_id] = row.completed_at;
      }

      const taskAttention = taskRows.filter((task) => {
        const dueStatus = computeTaskDueStatus(
          task.frequency as 'weekly' | 'monthly' | 'quarterly' | 'annual',
          latestByTask[task.id] ?? null,
        );
        return (
          dueStatus === 'overdue' || dueStatus === 'due_soon' || dueStatus === 'never_reviewed'
        );
      }).length;
      setTaskAttentionCount(taskAttention);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleArchiveToggle() {
    if (!property) return;
    const archiving = property.status === 'active';
    setActionError(null);
    setIsUpdatingStatus(true);
    const { error } = await supabase
      .from('properties')
      .update({ status: archiving ? 'archived' : 'active' })
      .eq('id', property.id);
    setIsUpdatingStatus(false);

    if (error) {
      logger.error('property-detail', 'Failed to update property status', error);
      setActionError('Could not update this property. Please try again.');
      return;
    }
    await load();
  }

  function confirmArchiveToggle() {
    if (!property) return;
    const archiving = property.status === 'active';
    Alert.alert(
      archiving ? 'Archive this property?' : 'Restore this property?',
      archiving
        ? 'Archived properties are hidden from active use but can be restored later. This does not free up a plan slot.'
        : 'This property will become active again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: archiving ? 'Archive' : 'Restore',
          style: archiving ? 'destructive' : 'default',
          onPress: handleArchiveToggle,
        },
      ],
    );
  }

  async function handleDelete() {
    if (!property) return;
    setActionError(null);
    setIsUpdatingStatus(true);
    const { error } = await supabase.rpc('delete_property', { p_property_id: property.id });
    setIsUpdatingStatus(false);

    if (error) {
      logger.error('property-detail', 'Failed to delete property', error);
      setActionError(friendlyDeleteError(error.message ?? ''));
      return;
    }
    router.replace('/(app)/properties');
  }

  function confirmDelete() {
    if (!property) return;
    Alert.alert(
      'Permanently delete this property?',
      `This removes "${property.name}" and all of its areas and components. This cannot be undone, and only works if it has no inspection history. This also frees up a plan slot.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete permanently', style: 'destructive', onPress: handleDelete },
      ],
    );
  }

  if (!property) {
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

  const hasAreas = (locationCount ?? 0) > 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.screenTitle}>{property.name}</Text>
        {property.status === 'archived' ? (
          <Text style={[typography.caption, styles.archivedBadge]}>ARCHIVED</Text>
        ) : null}
        {property.street_address || property.city ? (
          <Text style={[typography.body, styles.address]}>
            {[property.street_address, property.city, property.state].filter(Boolean).join(', ')}
          </Text>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={typography.sectionTitle}>{locationCount ?? '—'}</Text>
            <Text style={typography.caption}>Areas set up</Text>
          </View>
          <Pressable
            onPress={() => router.push(`/(app)/properties/${property.id}/checklist`)}
            style={({ pressed }) => [styles.statCard, pressed && styles.statCardPressed]}
            accessibilityRole="button"
            accessibilityLabel="View and manage this property's checklist"
          >
            <Text style={typography.sectionTitle}>{activeCheckCount ?? '—'}</Text>
            <Text style={typography.caption}>Active checks</Text>
          </Pressable>
        </View>

        {!hasAreas ? (
          <Text style={[typography.body, styles.hint]}>
            Add the buildings, areas, and components this property has, and we&apos;ll build its
            inspection checklist automatically.
          </Text>
        ) : null}

        <Button
          label={hasAreas ? 'Manage buildings & areas' : 'Set up buildings & areas'}
          onPress={() => router.push(`/(app)/properties/${property.id}/setup`)}
        />

        <View style={styles.complianceSection}>
          <Text style={typography.label}>Compliance</Text>

          <Pressable
            onPress={() => router.push(`/(app)/properties/${property.id}/compliance`)}
            style={({ pressed }) => [styles.complianceRow, pressed && styles.statCardPressed]}
            accessibilityRole="button"
            accessibilityLabel="View compliance documents"
          >
            <View style={styles.complianceRowText}>
              <Text style={typography.bodyStrong}>Compliance documents</Text>
              <Text style={typography.caption}>
                Certificates, permits, and filings with expiration dates
              </Text>
            </View>
            {complianceAttentionCount > 0 ? (
              <View style={styles.attentionBadge}>
                <Text style={[typography.caption, styles.attentionBadgeText]}>
                  {complianceAttentionCount}
                </Text>
              </View>
            ) : null}
          </Pressable>

          <Pressable
            onPress={() => router.push(`/(app)/properties/${property.id}/compliance-tasks`)}
            style={({ pressed }) => [styles.complianceRow, pressed && styles.statCardPressed]}
            accessibilityRole="button"
            accessibilityLabel="View compliance tasks"
          >
            <View style={styles.complianceRowText}>
              <Text style={typography.bodyStrong}>Compliance tasks</Text>
              <Text style={typography.caption}>Recurring log and vendor-report reviews</Text>
            </View>
            {taskAttentionCount > 0 ? (
              <View style={styles.attentionBadge}>
                <Text style={[typography.caption, styles.attentionBadgeText]}>
                  {taskAttentionCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        <View style={styles.dangerZone}>
          <Button
            label={property.status === 'active' ? 'Archive property' : 'Restore property'}
            variant="secondary"
            onPress={confirmArchiveToggle}
            loading={isUpdatingStatus}
          />
          <Button
            label="Delete permanently"
            variant="danger"
            onPress={confirmDelete}
            loading={isUpdatingStatus}
          />
        </View>
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
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  address: {
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  archivedBadge: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: -spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  dangerZone: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hint: {
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statCardPressed: {
    opacity: 0.6,
  },
  complianceSection: {
    gap: spacing.sm,
  },
  complianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  complianceRowText: {
    flex: 1,
    gap: spacing.xs,
  },
  attentionBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  attentionBadgeText: {
    color: colors.textInverse,
    fontWeight: '700',
  },
});
