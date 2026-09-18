import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import {
  CorrectiveActionStatus,
  CORRECTIVE_ACTION_STATUS_LABELS,
  CORRECTIVE_ACTION_TERMINAL_STATUSES,
  isOverdueForEscalation,
  PRIORITY_LABELS,
} from '@/lib/corrective-action-types';
import { Finding, fetchFindings } from '@/lib/findings';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

// Status colors always ship with a text label alongside them, same rule
// as inspections/index.tsx's STATUS_COLORS -- PRODUCT_SPEC.md's UX
// requirements say status is never conveyed by color alone.
const STATUS_COLORS: Record<string, string> = {
  open: colors.statusCritical,
  assigned: colors.statusScheduled,
  access_required: colors.statusInProgress,
  vendor_required: colors.statusInProgress,
  scheduled: colors.statusScheduled,
  in_progress: colors.statusInProgress,
  pending_parts: colors.statusInProgress,
  pending_approval: colors.statusInProgress,
  completed: colors.statusSatisfactory,
  verified: colors.statusSatisfactory,
  closed: colors.statusNeutral,
  voided: colors.statusNeutral,
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: colors.priorityP1,
  P2: colors.priorityP2,
  P3: colors.priorityP3,
  P4: colors.priorityP4,
};

type FilterKey = 'active' | 'all';

const ACTIVE_STATUSES = Object.keys(CORRECTIVE_ACTION_STATUS_LABELS).filter(
  (status) => !CORRECTIVE_ACTION_TERMINAL_STATUSES.has(status as CorrectiveActionStatus),
);

/**
 * Corrective actions board (Phase 5D, PRODUCT_SPEC.md section 6:
 * "Filterable list/board by status"). Backed by `findings` (see
 * findings.ts) rather than `corrective_actions` directly -- a finding is
 * the stable "one deficiency, one card" unit the board filters/sorts on,
 * with `current_status` kept in sync with its corrective action's status
 * server-side (see supabase/migrations/0017). Tapping a card opens the
 * full deficiency detail + corrective-action history screen ([id].tsx).
 */
export default function CorrectiveActionsBoardScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>('active');
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (activeFilter: FilterKey) => {
    const { findings: rows, error } = await fetchFindings(
      activeFilter === 'active' ? ACTIVE_STATUSES : undefined,
    );
    if (error) {
      setLoadError(error);
      return;
    }
    setLoadError(null);
    setFindings(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(filter);
    }, [load, filter]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load(filter);
    setIsRefreshing(false);
  }

  return (
    <Screen noPadding style={styles.container}>
      <View style={styles.filterRow}>
        {(['active', 'all'] as FilterKey[]).map((key) => {
          const isSelected = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              style={({ pressed }) => [
                styles.filterPill,
                isSelected && styles.filterPillSelected,
                pressed && styles.rowPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <Text style={[typography.caption, isSelected && styles.filterPillTextSelected]}>
                {key === 'active' ? 'Active' : 'All'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {findings === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.slate} />
        </View>
      ) : (
        <FlatList
          data={findings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          ListHeaderComponent={
            loadError ? <Text style={[typography.body, styles.errorText]}>{loadError}</Text> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={typography.body}>
                {filter === 'active'
                  ? 'No active deficiencies right now.'
                  : 'No deficiencies recorded yet.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const overdueForEscalation = isOverdueForEscalation(
              item.priority,
              item.createdAt,
              item.escalated,
            );
            return (
              <Pressable
                onPress={() => router.push(`/(app)/corrective-actions/${item.id}`)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.title} deficiency`}
              >
                <View style={styles.rowText}>
                  <Text style={typography.bodyStrong}>{item.title}</Text>
                  <Text style={[typography.caption, styles.rowSubtitle]}>
                    {item.locationName}
                    {item.propertyName ? ` · ${item.propertyName}` : ''}
                  </Text>
                  <View style={styles.badgeRow}>
                    {item.priority ? (
                      <View style={styles.badge}>
                        <View
                          style={[
                            styles.badgeDot,
                            {
                              backgroundColor:
                                PRIORITY_COLORS[item.priority] ?? colors.statusNeutral,
                            },
                          ]}
                        />
                        <Text style={typography.caption}>
                          {PRIORITY_LABELS[item.priority] ?? item.priority}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.badge}>
                      <View
                        style={[
                          styles.badgeDot,
                          {
                            backgroundColor:
                              STATUS_COLORS[item.currentStatus] ?? colors.statusNeutral,
                          },
                        ]}
                      />
                      <Text style={typography.caption}>
                        {CORRECTIVE_ACTION_STATUS_LABELS[item.currentStatus] ?? item.currentStatus}
                      </Text>
                    </View>
                    {item.escalated || overdueForEscalation ? (
                      <View style={styles.badge}>
                        <Ionicons name="alert-circle" size={14} color={colors.danger} />
                        <Text style={[typography.caption, styles.escalationText]}>
                          {item.escalated ? 'Escalated' : 'Escalation due'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textDisabled} />
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
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
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  errorText: {
    color: colors.danger,
    marginBottom: spacing.md,
  },
  empty: {
    flex: 1,
    paddingTop: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: touchTarget.minHeight,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  rowSubtitle: {
    color: colors.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  escalationText: {
    color: colors.danger,
    fontWeight: '700',
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
});
