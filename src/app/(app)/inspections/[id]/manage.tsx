import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import {
  InspectionLifecycleAction,
  InspectionLifecycleModal,
} from '@/components/inspection-lifecycle-modal';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { INSPECTION_STATUS_LABELS, inspectionTypeLabel } from '@/lib/inspection-types';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

type InspectorOption = { id: string; label: string };

type RawInspectionDetail = {
  id: string;
  status: string;
  status_reason: string | null;
  inspection_type: string;
  scheduled_date: string | null;
  assigned_inspector_id: string | null;
  properties: { name: string } | { name: string }[] | null;
};

type InspectionDetail = {
  id: string;
  status: string;
  statusReason: string | null;
  inspectionType: string;
  scheduledDate: string | null;
  assignedInspectorId: string | null;
  propertyName: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Maps set_inspection_status()/delete_inspection() exception codes (see
// supabase/migrations/0015) to messages a non-technical user can act on --
// same pattern as every other RPC error map in this app.
const LIFECYCLE_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'We could not confirm your account. Try signing out and back in.',
  inspection_not_found: 'Could not find this inspection.',
  invalid_status: 'That status is not supported yet.',
  status_reason_required: 'A reason is required.',
  insufficient_permission:
    'While this inspection is still scheduled, only the assigned inspector or an organization admin, portfolio manager, or supervisor can do this.',
  admin_required_past_scheduled:
    'This inspection has already started or finished — only an organization admin can void or delete it now.',
};

function friendlyLifecycleError(rawMessage: string): string {
  for (const code of Object.keys(LIFECYCLE_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return LIFECYCLE_ERROR_MESSAGES[code];
  }
  return 'Something went wrong. Please try again.';
}

async function fetchInspection(
  id: string,
): Promise<{ inspection: InspectionDetail | null; error: string | null }> {
  const { data, error } = await supabase
    .from('inspections')
    .select(
      'id, status, status_reason, inspection_type, scheduled_date, assigned_inspector_id, properties(name)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('inspection-manage', 'Failed to load inspection', error);
    return { inspection: null, error: 'Could not load this inspection.' };
  }
  if (!data) {
    return { inspection: null, error: 'Could not find this inspection.' };
  }

  const raw = data as RawInspectionDetail;
  const property = Array.isArray(raw.properties) ? raw.properties[0] : raw.properties;
  return {
    inspection: {
      id: raw.id,
      status: raw.status,
      statusReason: raw.status_reason,
      inspectionType: raw.inspection_type,
      scheduledDate: raw.scheduled_date,
      assignedInspectorId: raw.assigned_inspector_id,
      propertyName: property?.name ?? 'Unknown property',
    },
    error: null,
  };
}

async function fetchInspectorOptions(): Promise<{
  options: InspectorOption[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('status', 'active')
    .order('full_name');

  if (error) {
    logger.error('inspection-manage', 'Failed to load teammates', error);
    return { options: [], error: 'Could not load teammates to assign.' };
  }
  const rows = (data as { id: string; full_name: string | null; email: string }[] | null) ?? [];
  return {
    options: rows.map((row) => ({ id: row.id, label: row.full_name?.trim() || row.email })),
    error: null,
  };
}

/**
 * Manage an inspection's header (Phase 5B-ext2): reschedule/reassign
 * (plain RLS-gated update -- see 0015's comment on why this stays a
 * direct write), and void or delete it entirely, both governed by
 * set_inspection_status()/delete_inspection() (0015). Reached from the
 * inspections list via each row's manage icon.
 *
 * Deliberately does NOT allow changing inspection_type/property/location
 * scope here -- those are frozen into the snapshot the moment
 * start_inspection() runs (see 0012), and editing them after the fact
 * would mean the checklist no longer matches what was actually walked.
 */
export default function ManageInspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inspectorOptions, setInspectorOptions] = useState<InspectorOption[]>([]);

  const [scheduledDateText, setScheduledDateText] = useState('');
  const [selectedInspectorId, setSelectedInspectorId] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  const [lifecycleAction, setLifecycleAction] = useState<InspectionLifecycleAction | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [isLifecycleSubmitting, setIsLifecycleSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [inspectionResult, inspectorResult] = await Promise.all([
      fetchInspection(id),
      fetchInspectorOptions(),
    ]);
    setLoadError(inspectionResult.error);
    setInspection(inspectionResult.inspection);
    if (inspectionResult.inspection) {
      setScheduledDateText(inspectionResult.inspection.scheduledDate ?? '');
      setSelectedInspectorId(inspectionResult.inspection.assignedInspectorId);
    }
    setInspectorOptions(inspectorResult.options);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleSaveSchedule() {
    if (!inspection) return;
    setScheduleError(null);

    const trimmedDate = scheduledDateText.trim();
    if (trimmedDate && !DATE_PATTERN.test(trimmedDate)) {
      setScheduleError('Enter the date as YYYY-MM-DD, or leave it blank.');
      return;
    }

    setIsSavingSchedule(true);
    const { error } = await supabase
      .from('inspections')
      .update({
        scheduled_date: trimmedDate || null,
        assigned_inspector_id: selectedInspectorId,
      })
      .eq('id', inspection.id);
    setIsSavingSchedule(false);

    if (error) {
      logger.warn('inspection-manage', 'Failed to update schedule', { message: error.message });
      setScheduleError(
        error.message.includes('row-level security')
          ? 'You don’t have permission to edit this inspection’s schedule.'
          : 'Could not save these changes. Please try again.',
      );
      return;
    }
    load();
  }

  function openLifecycleModal(action: InspectionLifecycleAction) {
    setLifecycleAction(action);
    setLifecycleReason('');
    setLifecycleError(null);
  }

  async function handleConfirmLifecycle() {
    if (!inspection || !lifecycleAction) return;
    if (!lifecycleReason.trim()) {
      setLifecycleError('A reason is required.');
      return;
    }

    setIsLifecycleSubmitting(true);
    if (lifecycleAction === 'void') {
      const { error } = await supabase.rpc('set_inspection_status', {
        p_inspection_id: inspection.id,
        p_new_status: 'voided',
        p_reason: lifecycleReason.trim(),
      });
      setIsLifecycleSubmitting(false);
      if (error) {
        logger.warn('inspection-manage', 'set_inspection_status failed', {
          message: error.message,
        });
        setLifecycleError(friendlyLifecycleError(error.message));
        return;
      }
      setLifecycleAction(null);
      load();
      return;
    }

    const { error } = await supabase.rpc('delete_inspection', {
      p_inspection_id: inspection.id,
      p_reason: lifecycleReason.trim(),
    });
    setIsLifecycleSubmitting(false);
    if (error) {
      logger.warn('inspection-manage', 'delete_inspection failed', { message: error.message });
      setLifecycleError(friendlyLifecycleError(error.message));
      return;
    }
    setLifecycleAction(null);
    router.replace('/(app)/inspections');
  }

  if (inspection === null) {
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

  const isVoided = inspection.status === 'voided';

  return (
    <Screen noPadding>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.sectionTitle}>{inspection.propertyName}</Text>
        <Text style={typography.body}>
          {inspectionTypeLabel(inspection.inspectionType)} ·{' '}
          {INSPECTION_STATUS_LABELS[inspection.status] ?? inspection.status}
        </Text>
        {inspection.statusReason ? (
          <Text style={[typography.caption, styles.reasonText]}>{inspection.statusReason}</Text>
        ) : null}

        {isVoided ? (
          <Text style={[typography.body, styles.voidedNote]}>
            This inspection has been voided — its schedule and assignment can no longer be edited.
          </Text>
        ) : (
          <View style={styles.section}>
            <TextField
              label="Scheduled date"
              value={scheduledDateText}
              onChangeText={setScheduledDateText}
              placeholder="YYYY-MM-DD (blank for none)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={[typography.label, styles.fieldSpacing]}>Assigned inspector</Text>
            {inspectorOptions.length === 0 ? (
              <Text style={typography.caption}>No teammates found.</Text>
            ) : (
              <View style={styles.optionList}>
                <Pressable
                  onPress={() => setSelectedInspectorId(null)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    selectedInspectorId === null && styles.optionRowSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedInspectorId === null }}
                >
                  <Text
                    style={selectedInspectorId === null ? typography.bodyStrong : typography.body}
                  >
                    Unassigned
                  </Text>
                </Pressable>
                {inspectorOptions.map((option) => {
                  const isSelected = selectedInspectorId === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => setSelectedInspectorId(option.id)}
                      style={({ pressed }) => [
                        styles.optionRow,
                        isSelected && styles.optionRowSelected,
                        pressed && styles.rowPressed,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={isSelected ? typography.bodyStrong : typography.body}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {scheduleError ? <Text style={styles.errorText}>{scheduleError}</Text> : null}
            <Button label="Save changes" onPress={handleSaveSchedule} loading={isSavingSchedule} />
          </View>
        )}

        <View style={[styles.section, styles.dangerZone]}>
          <Text style={typography.label}>Danger zone</Text>
          {!isVoided ? (
            <Button
              label="Void inspection"
              variant="danger"
              onPress={() => openLifecycleModal('void')}
            />
          ) : null}
          <Button
            label="Delete inspection"
            variant="danger"
            onPress={() => openLifecycleModal('delete')}
          />
        </View>
      </ScrollView>

      <InspectionLifecycleModal
        action={lifecycleAction}
        reason={lifecycleReason}
        isSubmitting={isLifecycleSubmitting}
        error={lifecycleError}
        onChangeReason={setLifecycleReason}
        onCancel={() => setLifecycleAction(null)}
        onConfirm={handleConfirmLifecycle}
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
  errorText: {
    ...typography.body,
    color: colors.danger,
  },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  reasonText: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  voidedNote: {
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  fieldSpacing: {
    marginTop: spacing.sm,
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
  optionRowSelected: {
    backgroundColor: colors.background,
    borderColor: colors.slate,
  },
  rowPressed: {
    opacity: 0.6,
  },
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
});
