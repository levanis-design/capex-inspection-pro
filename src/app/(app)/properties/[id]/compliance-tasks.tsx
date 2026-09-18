import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
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

import { ComplianceTaskModal } from '@/components/compliance-task-modal';
import { Screen } from '@/components/screen';
import { TaskCompletionHistoryModal } from '@/components/task-completion-history-modal';
import {
  COMPLIANCE_TASK_DUE_STATUS_COLORS,
  COMPLIANCE_TASK_DUE_STATUS_LABELS,
  COMPLIANCE_TASK_FREQUENCY_LABELS,
  COMPLIANCE_TASK_TYPE_LABELS,
  computeTaskDueStatus,
  friendlyComplianceTaskError,
} from '@/lib/compliance-task-types';
import {
  ComplianceTask,
  ComplianceTaskCompletion,
  ComplianceTaskInput,
  createComplianceTask,
  deleteComplianceTask,
  fetchComplianceTaskCompletions,
  fetchComplianceTasks,
  recordComplianceTaskCompletion,
  updateComplianceTask,
} from '@/lib/compliance-tasks';
import { fetchVendors, Vendor } from '@/lib/findings';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, radius, spacing, typography } from '@/theme';

const EMPTY_INPUT: ComplianceTaskInput = {
  taskType: 'other',
  title: '',
  description: '',
  vendorId: null,
  frequency: 'monthly',
};

function inputFromTask(task: ComplianceTask): ComplianceTaskInput {
  return {
    taskType: task.taskType,
    title: task.title,
    description: task.description ?? '',
    vendorId: task.vendorId,
    frequency: task.frequency,
  };
}

/**
 * Phase 15: Compliance Tasks. The other half of the source checklist's
 * "Compliance & Documentation" section that Phase 14 (compliance
 * documents) left out -- recurring review workflows (log reviews,
 * vendor-report reviews) rather than a single document with an
 * expiration date. See supabase/migrations/0026's header comment.
 *
 * Same permission shape as compliance.tsx (Phase 14): read is org-wide,
 * write (add/edit/delete/record a review) is gated to
 * org_admin/portfolio_manager/supervisor.
 */
export default function PropertyComplianceTasksScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: organization } = useCurrentOrganization();
  const canManage = organization
    ? ['org_admin', 'portfolio_manager', 'supervisor'].includes(organization.role)
    : false;

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ComplianceTask[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ComplianceTask | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalInput, setModalInput] = useState<ComplianceTaskInput>(EMPTY_INPUT);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [historyTask, setHistoryTask] = useState<ComplianceTask | null>(null);
  const [completions, setCompletions] = useState<ComplianceTaskCompletion[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;

    const [propertyResult, vendorsResult] = await Promise.all([
      supabase.from('properties').select('name, organization_id').eq('id', id).single(),
      fetchVendors(),
    ]);

    if (propertyResult.error) {
      logger.error('property-compliance-tasks', 'Failed to load property', propertyResult.error);
      setLoadError('Could not load this property.');
      return;
    }
    const property = propertyResult.data as { name: string; organization_id: string };
    setPropertyName(property.name);
    setOrganizationId(property.organization_id);
    setVendors(vendorsResult.vendors);

    const { tasks: loadedTasks, error } = await fetchComplianceTasks(id);
    if (error) {
      setLoadError(error);
      return;
    }
    setLoadError(null);
    setTasks(loadedTasks);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openAddModal() {
    setEditing(null);
    setModalInput(EMPTY_INPUT);
    setModalError(null);
    setModalVisible(true);
  }

  function openEditModal(task: ComplianceTask) {
    setEditing(task);
    setModalInput(inputFromTask(task));
    setModalError(null);
    setModalVisible(true);
  }

  async function handleSubmit() {
    if (!id || !organizationId) return;
    if (!modalInput.title.trim()) {
      setModalError('A title is required.');
      return;
    }
    if (modalInput.taskType === 'vendor_report_review' && !modalInput.vendorId) {
      setModalError('Pick a vendor for a vendor report review task.');
      return;
    }

    setIsSaving(true);
    const result = editing
      ? await updateComplianceTask(editing.id, modalInput)
      : await createComplianceTask(organizationId, id, modalInput);
    setIsSaving(false);

    if (result.error) {
      setModalError(friendlyComplianceTaskError(result.error));
      return;
    }
    setModalVisible(false);
    load();
  }

  function confirmDelete(task: ComplianceTask) {
    Alert.alert('Delete this task?', `This removes "${task.title}" and its review history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteComplianceTask(task.id);
          if (error) {
            Alert.alert('Could not delete', friendlyComplianceTaskError(error));
            return;
          }
          load();
        },
      },
    ]);
  }

  async function openHistory(task: ComplianceTask) {
    setHistoryTask(task);
    setCompletionNotes('');
    setHistoryError(null);
    setIsLoadingHistory(true);
    const { completions: loaded, error } = await fetchComplianceTaskCompletions(task.id);
    setIsLoadingHistory(false);
    if (error) {
      setHistoryError(error);
      return;
    }
    setCompletions(loaded);
  }

  async function handleRecordCompletion() {
    if (!historyTask || !organizationId) return;
    setIsRecording(true);
    const { error } = await recordComplianceTaskCompletion(
      organizationId,
      historyTask.id,
      completionNotes,
    );
    setIsRecording(false);
    if (error) {
      setHistoryError(friendlyComplianceTaskError(error));
      return;
    }
    setCompletionNotes('');
    await openHistory(historyTask);
    load();
  }

  if (tasks === null) {
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

  return (
    <Screen noPadding>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.screenTitle}>Compliance tasks</Text>
        <Text style={[typography.body, styles.hint]}>{propertyName}</Text>

        {tasks.length === 0 ? (
          <Text style={[typography.body, styles.hint]}>
            No compliance tasks yet. Track recurring reviews here — incident/maintenance log
            reviews, keeping vendor reports current, or anything else worth checking on a schedule.
          </Text>
        ) : (
          tasks.map((task) => {
            const dueStatus = computeTaskDueStatus(task.frequency, task.lastCompletedAt);
            const dueColor = COMPLIANCE_TASK_DUE_STATUS_COLORS[dueStatus];

            return (
              <Pressable
                key={task.id}
                onPress={() => canManage && openEditModal(task)}
                disabled={!canManage}
                style={({ pressed }) => [styles.row, pressed && canManage && styles.rowPressed]}
              >
                <View style={styles.rowText}>
                  <Text style={typography.bodyStrong}>{task.title}</Text>
                  <Text style={typography.caption}>
                    {COMPLIANCE_TASK_TYPE_LABELS[task.taskType]}
                    {task.vendorName ? ` · ${task.vendorName}` : ''} ·{' '}
                    {COMPLIANCE_TASK_FREQUENCY_LABELS[task.frequency]}
                  </Text>
                  <Text style={typography.caption}>
                    {task.lastCompletedAt
                      ? `Last reviewed ${new Date(task.lastCompletedAt).toLocaleDateString()}`
                      : 'Never reviewed'}
                  </Text>
                  <View style={[styles.statusBadge, { borderColor: dueColor }]}>
                    <Text style={[typography.caption, { color: dueColor }]}>
                      {COMPLIANCE_TASK_DUE_STATUS_LABELS[dueStatus]}
                    </Text>
                  </View>
                </View>

                <View style={styles.rowActions}>
                  <Pressable
                    onPress={() => openHistory(task)}
                    accessibilityRole="button"
                    accessibilityLabel="Record a review or view history"
                    style={({ pressed }) => [styles.iconButton, pressed && styles.rowPressed]}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color={colors.slate} />
                  </Pressable>
                  {canManage ? (
                    <Pressable
                      onPress={() => confirmDelete(task)}
                      accessibilityRole="button"
                      accessibilityLabel="Delete task"
                      style={({ pressed }) => [styles.iconButton, pressed && styles.rowPressed]}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}

        {canManage ? (
          <Pressable
            onPress={openAddModal}
            style={({ pressed }) => [styles.addButton, pressed && styles.rowPressed]}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={20} color={colors.slate} />
            <Text style={typography.bodyStrong}>Add compliance task</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <ComplianceTaskModal
        visible={modalVisible}
        isEditing={!!editing}
        input={modalInput}
        vendors={vendors}
        isSubmitting={isSaving}
        error={modalError}
        onChange={setModalInput}
        onCancel={() => setModalVisible(false)}
        onSubmit={handleSubmit}
      />

      <TaskCompletionHistoryModal
        visible={!!historyTask}
        taskTitle={historyTask?.title ?? ''}
        completions={completions}
        isLoading={isLoadingHistory}
        notes={completionNotes}
        isSubmitting={isRecording}
        error={historyError}
        onChangeNotes={setCompletionNotes}
        onRecordCompletion={handleRecordCompletion}
        onClose={() => setHistoryTask(null)}
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
    color: colors.danger,
  },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  hint: {
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    marginTop: spacing.xs,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
});
