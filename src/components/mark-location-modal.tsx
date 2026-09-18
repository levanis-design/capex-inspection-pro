import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { LOCATION_STATUS_LABELS } from '@/lib/inspection-types';
import { colors, radius, spacing, typography } from '@/theme';

type MarkLocationModalProps = {
  visible: boolean;
  locationName: string;
  targetStatus: 'skipped' | 'inaccessible' | 'not_applicable' | null;
  reason: string;
  isSubmitting: boolean;
  error: string | null;
  onChangeReason: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Captures the required reason for marking a snapshot location skipped,
 * inaccessible, or not applicable (0011's
 * inspection_snapshot_location_reason_required constraint enforces this
 * at the database level; this modal is just where the reason gets
 * typed). Used from the walkthrough screen ([id]/index.tsx).
 */
export function MarkLocationModal({
  visible,
  locationName,
  targetStatus,
  reason,
  isSubmitting,
  error,
  onChangeReason,
  onCancel,
  onConfirm,
}: MarkLocationModalProps) {
  if (!targetStatus) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>
            Mark {locationName} as {LOCATION_STATUS_LABELS[targetStatus].toLowerCase()}
          </Text>
          <TextField
            label="Reason (required)"
            value={reason}
            onChangeText={onChangeReason}
            multiline
            numberOfLines={3}
            style={styles.reasonInput}
            autoFocus
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.actionButton}>
              <Button
                label="Confirm"
                onPress={onConfirm}
                loading={isSubmitting}
                disabled={!reason.trim()}
              />
            </View>
          </View>
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
  },
  reasonInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
