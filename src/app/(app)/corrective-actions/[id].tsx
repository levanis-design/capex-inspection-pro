import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
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
import {
  CorrectiveActionFormState,
  ManageCorrectiveActionModal,
} from '@/components/manage-corrective-action-modal';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import {
  CORRECTIVE_ACTION_STATUS_LABELS,
  friendlyCorrectiveActionError,
  isOverdueForCompletion,
  isOverdueForEscalation,
  PRIORITY_LABELS,
} from '@/lib/corrective-action-types';
import {
  AssignableProfile,
  CorrectiveAction,
  createVendor,
  fetchAssignableProfiles,
  fetchCorrectiveActions,
  fetchFinding,
  fetchVendors,
  Finding,
  setCorrectiveActionStatus,
  setFindingEscalation,
  updateCorrectiveActionDetails,
  updateFindingDetails,
  Vendor,
} from '@/lib/findings';
import { fetchPhotosForItems, ItemPhoto } from '@/lib/inspection-photos';
import { logger } from '@/lib/logger';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, radius, spacing, typography } from '@/theme';

const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];

const EMPTY_FORM: CorrectiveActionFormState = {
  status: 'open',
  statusReason: '',
  assignedTo: null,
  vendorId: null,
  accessNotes: '',
  scheduledDate: '',
  targetCompletionDate: '',
  estimatedCost: '',
  actualCost: '',
  completionNotes: '',
};

function toFormState(action: CorrectiveAction): CorrectiveActionFormState {
  return {
    status: action.status,
    statusReason: action.statusReason ?? '',
    assignedTo: action.assignedTo,
    vendorId: action.vendorId,
    accessNotes: action.accessNotes ?? '',
    scheduledDate: action.scheduledDate ?? '',
    targetCompletionDate: action.targetCompletionDate ?? '',
    estimatedCost: action.estimatedCost != null ? String(action.estimatedCost) : '',
    actualCost: action.actualCost != null ? String(action.actualCost) : '',
    completionNotes: action.completionNotes ?? '',
  };
}

function parseCost(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Deficiency detail (Phase 5D, PRODUCT_SPEC.md section 6: "Full finding
 * record, escalation state"). Shows the finding's stable identity (what/
 * where/priority, the original observation + photos from the inspection
 * that raised it), escalation controls, and the corrective action(s)
 * tracking its remediation -- see findings.ts's module comment for why
 * these are two separate tables.
 *
 * Edit controls (priority, resident access, escalation, and everything on
 * the corrective action) are only shown to org_admin/portfolio_manager/
 * supervisor, per PRODUCT_SPEC.md section 4's "Assign corrective actions"
 * row -- inspectors and viewers get a read-only view. This is a UX
 * courtesy only; every write path is independently enforced server-side
 * by supabase/migrations/0017's SECURITY DEFINER functions regardless of
 * what this screen shows.
 */
export default function DeficiencyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: organization } = useCurrentOrganization();
  const canManage = organization
    ? ['org_admin', 'portfolio_manager', 'supervisor'].includes(organization.role)
    : false;

  const [finding, setFinding] = useState<Finding | null>(null);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);
  const [photos, setPhotos] = useState<ItemPhoto[]>([]);
  const [profiles, setProfiles] = useState<AssignableProfile[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isEscalating, setIsEscalating] = useState(false);
  const [escalationNoteDraft, setEscalationNoteDraft] = useState('');
  const [escalationError, setEscalationError] = useState<string | null>(null);
  const [isSubmittingEscalation, setIsSubmittingEscalation] = useState(false);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form, setForm] = useState<CorrectiveActionFormState>(EMPTY_FORM);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSavingModal, setIsSavingModal] = useState(false);

  const [isAddVendorVisible, setIsAddVendorVisible] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorTrade, setNewVendorTrade] = useState('');
  const [addVendorError, setAddVendorError] = useState<string | null>(null);
  const [isSavingVendor, setIsSavingVendor] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const { finding: findingResult, error } = await fetchFinding(id);
    if (error || !findingResult) {
      setLoadError(error ?? 'Could not load this deficiency.');
      return;
    }
    setLoadError(null);
    setFinding(findingResult);

    const [actionsResult, profilesResult, vendorsResult] = await Promise.all([
      fetchCorrectiveActions(findingResult.id),
      fetchAssignableProfiles(),
      fetchVendors(),
    ]);
    setCorrectiveActions(actionsResult.correctiveActions);
    setProfiles(profilesResult.profiles);
    setVendors(vendorsResult.vendors);

    if (findingResult.inspectionSnapshotItemId) {
      const { photosByItem } = await fetchPhotosForItems([findingResult.inspectionSnapshotItemId]);
      setPhotos(photosByItem[findingResult.inspectionSnapshotItemId] ?? []);
    } else {
      setPhotos([]);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handlePriorityChange(priority: string) {
    if (!finding) return;
    const previous = finding;
    setFinding({ ...finding, priority });
    const { error } = await updateFindingDetails(finding.id, {
      priority,
      repeatOfFindingId: finding.repeatOfFindingId,
      residentAccessRequired: finding.residentAccessRequired,
    });
    if (error) {
      logger.warn('deficiency-detail', 'update_finding_details (priority) failed', {
        message: error,
      });
      setFinding(previous);
    }
  }

  async function handleResidentAccessChange(residentAccessRequired: boolean) {
    if (!finding) return;
    const previous = finding;
    setFinding({ ...finding, residentAccessRequired });
    const { error } = await updateFindingDetails(finding.id, {
      priority: finding.priority,
      repeatOfFindingId: finding.repeatOfFindingId,
      residentAccessRequired,
    });
    if (error) {
      logger.warn('deficiency-detail', 'update_finding_details (resident access) failed', {
        message: error,
      });
      setFinding(previous);
    }
  }

  async function handleConfirmEscalate() {
    if (!finding) return;
    setIsSubmittingEscalation(true);
    setEscalationError(null);
    const { error } = await setFindingEscalation(finding.id, true, escalationNoteDraft.trim());
    setIsSubmittingEscalation(false);
    if (error) {
      setEscalationError(friendlyCorrectiveActionError(error));
      return;
    }
    setIsEscalating(false);
    setEscalationNoteDraft('');
    load();
  }

  async function handleClearEscalation() {
    if (!finding) return;
    setIsSubmittingEscalation(true);
    setEscalationError(null);
    const { error } = await setFindingEscalation(finding.id, false);
    setIsSubmittingEscalation(false);
    if (error) {
      setEscalationError(friendlyCorrectiveActionError(error));
      return;
    }
    load();
  }

  function handleOpenModal(action: CorrectiveAction) {
    setForm(toFormState(action));
    setModalError(null);
    setIsModalVisible(true);
  }

  async function handleSaveModal() {
    const currentAction = correctiveActions[correctiveActions.length - 1];
    if (!currentAction) return;
    setIsSavingModal(true);
    setModalError(null);

    const detailsResult = await updateCorrectiveActionDetails(currentAction.id, {
      assignedTo: form.assignedTo,
      vendorId: form.vendorId,
      accessNotes: form.accessNotes.trim() || null,
      scheduledDate: form.scheduledDate.trim() || null,
      targetCompletionDate: form.targetCompletionDate.trim() || null,
      estimatedCost: parseCost(form.estimatedCost),
      actualCost: parseCost(form.actualCost),
      completionNotes: form.completionNotes.trim() || null,
    });
    if (detailsResult.error) {
      setIsSavingModal(false);
      setModalError(friendlyCorrectiveActionError(detailsResult.error));
      return;
    }

    if (form.status !== currentAction.status) {
      const statusResult = await setCorrectiveActionStatus(
        currentAction.id,
        form.status,
        form.statusReason.trim() || undefined,
      );
      if (statusResult.error) {
        setIsSavingModal(false);
        setModalError(friendlyCorrectiveActionError(statusResult.error));
        return;
      }
    }

    setIsSavingModal(false);
    setIsModalVisible(false);
    load();
  }

  function handleAddVendor() {
    setNewVendorName('');
    setNewVendorTrade('');
    setAddVendorError(null);
    setIsAddVendorVisible(true);
  }

  async function handleSaveVendor() {
    if (!newVendorName.trim()) {
      setAddVendorError('A name is required.');
      return;
    }
    setIsSavingVendor(true);
    setAddVendorError(null);
    const { vendor, error } = await createVendor({
      name: newVendorName.trim(),
      trade: newVendorTrade.trim() || null,
      contactName: null,
      phone: null,
      email: null,
    });
    setIsSavingVendor(false);
    if (error || !vendor) {
      setAddVendorError(error ?? 'Could not add this vendor.');
      return;
    }
    setVendors((prev) => [...prev, vendor].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((prev) => ({ ...prev, vendorId: vendor.id }));
    setIsAddVendorVisible(false);
  }

  if (!finding) {
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

  const currentAction = correctiveActions[correctiveActions.length - 1] ?? null;
  const previousAttempts = correctiveActions.slice(0, -1);
  const overdueForEscalation = isOverdueForEscalation(
    finding.priority,
    finding.createdAt,
    finding.escalated,
  );

  return (
    <Screen noPadding>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.screenTitle}>{finding.title}</Text>
        <Text style={[typography.caption, styles.subtitle]}>
          {finding.locationName}
          {finding.componentName ? ` · ${finding.componentName}` : ''}
          {finding.propertyName ? ` · ${finding.propertyName}` : ''}
        </Text>

        <View style={styles.section}>
          <Text style={typography.label}>Priority</Text>
          <View style={styles.pillRow}>
            {PRIORITY_OPTIONS.map((option) => {
              const isSelected = finding.priority === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => canManage && handlePriorityChange(option)}
                  disabled={!canManage}
                  style={({ pressed }) => [
                    styles.pill,
                    isSelected && styles.pillSelected,
                    pressed && canManage && styles.rowPressed,
                  ]}
                >
                  <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                    {PRIORITY_LABELS[option] ?? option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {finding.description ? (
          <View style={styles.section}>
            <Text style={typography.label}>Observation</Text>
            <Text style={typography.body}>{finding.description}</Text>
          </View>
        ) : null}

        {finding.recommendation ? (
          <View style={styles.section}>
            <Text style={typography.label}>Recommendation</Text>
            <Text style={typography.body}>{finding.recommendation}</Text>
          </View>
        ) : null}

        {photos.length > 0 ? (
          <View style={styles.section}>
            <Text style={typography.label}>Photos</Text>
            <View style={styles.photoRow}>
              {photos.map((photo) =>
                photo.signedUrl ? (
                  <Image
                    key={photo.id}
                    source={{ uri: photo.signedUrl }}
                    style={styles.thumbnail}
                    contentFit="cover"
                  />
                ) : (
                  <View key={photo.id} style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
                ),
              )}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={typography.label}>Resident access required</Text>
          <View style={styles.pillRow}>
            {[
              { value: true, label: 'Yes' },
              { value: false, label: 'No' },
            ].map((option) => {
              const isSelected = finding.residentAccessRequired === option.value;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => canManage && handleResidentAccessChange(option.value)}
                  disabled={!canManage}
                  style={({ pressed }) => [
                    styles.pill,
                    isSelected && styles.pillSelected,
                    pressed && canManage && styles.rowPressed,
                  ]}
                >
                  <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={typography.label}>Escalation</Text>
          {finding.escalated ? (
            <View style={styles.escalationCard}>
              <Text style={[typography.body, styles.escalatedText]}>Escalated</Text>
              {finding.escalationNote ? (
                <Text style={typography.caption}>{finding.escalationNote}</Text>
              ) : null}
              {canManage ? (
                <Button
                  label="Clear escalation"
                  variant="secondary"
                  onPress={handleClearEscalation}
                  loading={isSubmittingEscalation}
                />
              ) : null}
            </View>
          ) : canManage ? (
            isEscalating ? (
              <View style={styles.escalationCard}>
                <TextField
                  label="Escalation note"
                  value={escalationNoteDraft}
                  onChangeText={setEscalationNoteDraft}
                  multiline
                  numberOfLines={2}
                  style={styles.multilineInput}
                />
                <View style={styles.escalationActions}>
                  <View style={styles.escalationActionButton}>
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={() => setIsEscalating(false)}
                    />
                  </View>
                  <View style={styles.escalationActionButton}>
                    <Button
                      label="Confirm"
                      onPress={handleConfirmEscalate}
                      loading={isSubmittingEscalation}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <Button
                label={overdueForEscalation ? 'Escalate (overdue)' : 'Escalate'}
                variant={overdueForEscalation ? 'danger' : 'secondary'}
                onPress={() => setIsEscalating(true)}
              />
            )
          ) : (
            <Text style={typography.body}>Not escalated.</Text>
          )}
          {escalationError ? <Text style={styles.errorText}>{escalationError}</Text> : null}
        </View>

        {previousAttempts.length > 0 ? (
          <View style={styles.section}>
            <Text style={typography.label}>Previous attempts</Text>
            {previousAttempts.map((action) => (
              <CorrectiveActionCard key={action.id} action={action} />
            ))}
          </View>
        ) : null}

        {currentAction ? (
          <View style={styles.section}>
            <Text style={typography.label}>Corrective action</Text>
            <CorrectiveActionCard action={currentAction} />
            {isOverdueForCompletion(currentAction.targetCompletionDate, currentAction.status) ? (
              <Text style={[typography.caption, styles.overdueText]}>
                Past its target completion date.
              </Text>
            ) : null}
            {canManage ? (
              <Button
                label="Manage"
                variant="secondary"
                onPress={() => handleOpenModal(currentAction)}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <ManageCorrectiveActionModal
        visible={isModalVisible}
        form={form}
        profiles={profiles}
        vendors={vendors}
        isSubmitting={isSavingModal}
        error={modalError}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        onAddVendor={handleAddVendor}
        onCancel={() => setIsModalVisible(false)}
        onSave={handleSaveModal}
      />

      <Modal
        visible={isAddVendorVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsAddVendorVisible(false)}
      >
        <View style={styles.escalationOverlay}>
          <View style={styles.addVendorSheet}>
            <Text style={typography.sectionTitle}>Add vendor</Text>
            <TextField label="Name" value={newVendorName} onChangeText={setNewVendorName} />
            <TextField
              label="Trade (optional)"
              value={newVendorTrade}
              onChangeText={setNewVendorTrade}
              placeholder="e.g. roofing, plumbing, electrical"
            />
            {addVendorError ? <Text style={styles.errorText}>{addVendorError}</Text> : null}
            <View style={styles.escalationActions}>
              <View style={styles.escalationActionButton}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setIsAddVendorVisible(false)}
                />
              </View>
              <View style={styles.escalationActionButton}>
                <Button label="Save" onPress={handleSaveVendor} loading={isSavingVendor} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function CorrectiveActionCard({ action }: { action: CorrectiveAction }) {
  return (
    <View style={styles.actionCard}>
      <Text style={typography.bodyStrong}>
        {CORRECTIVE_ACTION_STATUS_LABELS[action.status] ?? action.status}
      </Text>
      {action.assignedToName ? (
        <Text style={typography.caption}>Assigned to {action.assignedToName}</Text>
      ) : null}
      {action.vendorName ? (
        <Text style={typography.caption}>Vendor: {action.vendorName}</Text>
      ) : null}
      {action.scheduledDate ? (
        <Text style={typography.caption}>Scheduled: {action.scheduledDate}</Text>
      ) : null}
      {action.targetCompletionDate ? (
        <Text style={typography.caption}>Target: {action.targetCompletionDate}</Text>
      ) : null}
      {action.accessNotes ? (
        <Text style={typography.caption}>Access: {action.accessNotes}</Text>
      ) : null}
      {action.completionNotes ? (
        <Text style={typography.caption}>Completion notes: {action.completionNotes}</Text>
      ) : null}
      {action.statusReason ? (
        <Text style={typography.caption}>Reason: {action.statusReason}</Text>
      ) : null}
    </View>
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
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  subtitle: {
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillSelected: {
    backgroundColor: colors.slate,
    borderColor: colors.slate,
  },
  pillTextSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  rowPressed: {
    opacity: 0.7,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  thumbnailPlaceholder: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  escalationCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  escalatedText: {
    color: colors.danger,
    fontWeight: '700',
  },
  escalationActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  escalationActionButton: {
    flex: 1,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  overdueText: {
    color: colors.warning,
  },
  actionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  escalationOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  addVendorSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
