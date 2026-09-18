import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ComplianceTaskCompletion } from '@/lib/compliance-tasks';
import { colors, radius, spacing, typography } from '@/theme';

type TaskCompletionHistoryModalProps = {
  visible: boolean;
  taskTitle: string;
  completions: ComplianceTaskCompletion[];
  isLoading: boolean;
  notes: string;
  isSubmitting: boolean;
  error: string | null;
  onChangeNotes: (notes: string) => void;
  onRecordCompletion: () => void;
  onClose: () => void;
};

/**
 * Combines "record a new review" and "see the review history" for one
 * compliance task in a single modal -- a completion is a log entry, so
 * the natural view is the log itself with an "add an entry" form at the
 * top, rather than splitting recording and reviewing history into two
 * separate screens.
 */
export function TaskCompletionHistoryModal({
  visible,
  taskTitle,
  completions,
  isLoading,
  notes,
  isSubmitting,
  error,
  onChangeNotes,
  onRecordCompletion,
  onClose,
}: TaskCompletionHistoryModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>{taskTitle}</Text>

          <TextField
            label="Record a review (optional notes)"
            value={notes}
            onChangeText={onChangeNotes}
            placeholder="What did you find?"
            multiline
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Mark reviewed today" onPress={onRecordCompletion} loading={isSubmitting} />

          <Text style={[typography.label, styles.historyLabel]}>Review history</Text>
          <ScrollView style={styles.history}>
            {isLoading ? (
              <Text style={typography.caption}>Loading…</Text>
            ) : completions.length === 0 ? (
              <Text style={[typography.caption, styles.hint]}>No reviews recorded yet.</Text>
            ) : (
              completions.map((completion) => (
                <View key={completion.id} style={styles.historyRow}>
                  <Text style={typography.bodyStrong}>
                    {new Date(completion.completedAt).toLocaleDateString()}
                    {completion.completedByName ? ` · ${completion.completedByName}` : ''}
                  </Text>
                  {completion.notes ? (
                    <Text style={typography.caption}>{completion.notes}</Text>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>

          <Button label="Close" variant="secondary" onPress={onClose} />
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
    maxHeight: '90%',
  },
  historyLabel: {
    marginTop: spacing.sm,
  },
  history: {
    maxHeight: 220,
  },
  historyRow: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hint: {
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
