import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, spacing, touchTarget, typography } from '@/theme';

type PropertyRow = {
  id: string;
  name: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  status: string;
};

/**
 * Properties list (Phase 3). Buildings, the area/location library, and the
 * guided setup wizard for a given property are Phase 4 — tapping a row here
 * does not drill in any further yet.
 */
export default function PropertiesListScreen() {
  const router = useRouter();
  const { data: organization } = useCurrentOrganization();
  const [properties, setProperties] = useState<PropertyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('properties')
      .select('id, name, street_address, city, state, status')
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('properties', 'Failed to load properties', error);
      setLoadError('Could not load properties. Pull down to try again.');
      setProperties((prev) => prev ?? []);
      return;
    }
    setLoadError(null);
    setProperties((data as PropertyRow[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
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

  const limit = organization?.propertySlotLimit ?? null;
  const atLimit = limit !== null && properties.length >= limit;

  return (
    <Screen noPadding>
      <FlatList
        data={properties}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        ListHeaderComponent={
          loadError ? (
            <View style={styles.banner}>
              <Text style={[typography.body, styles.errorText]}>{loadError}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={typography.body}>
              No properties yet. Add your first property to start setting up buildings, areas, and
              inspection checklists.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(app)/properties/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
          >
            <View style={styles.rowText}>
              <Text style={typography.bodyStrong}>
                {item.name}
                {item.status === 'archived' ? ' (archived)' : ''}
              </Text>
              {item.street_address || item.city ? (
                <Text style={[typography.caption, styles.rowSubtitle]}>
                  {[item.street_address, item.city, item.state].filter(Boolean).join(', ')}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textDisabled} />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
      <View style={styles.footer}>
        {limit !== null ? (
          <Text style={[typography.caption, styles.usageText]}>
            {properties.length} of {limit} {limit === 1 ? 'property' : 'properties'} used on your
            plan
          </Text>
        ) : null}
        {atLimit ? (
          <Text style={[typography.body, styles.limitText]}>
            You&apos;ve reached your plan&apos;s property limit. Contact us to add more properties
            on a paid plan.
          </Text>
        ) : (
          <Button label="Add property" onPress={() => router.push('/(app)/properties/new')} />
        )}
      </View>
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
  banner: {
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  empty: {
    flex: 1,
    paddingTop: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.sm,
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
  usageText: {
    textAlign: 'center',
    color: colors.textSecondary,
  },
  limitText: {
    textAlign: 'center',
    color: colors.textSecondary,
  },
});
