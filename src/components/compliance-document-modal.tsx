import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import {
  COMPLIANCE_DOCUMENT_STATUS_LABELS,
  COMPLIANCE_DOCUMENT_STATUSES,
  COMPLIANCE_DOCUMENT_TYPE_LABELS,
  COMPLIANCE_DOCUMENT_TYPES,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from '@/lib/compliance-document-types';
import { ComplianceDocumentInput } from '@/lib/compliance-documents';
import { colors, radius, spacing, typography } from '@/theme';

type ComplianceDocumentModalProps = {
  visible: boolean;
  isEditing: boolean;
  input: ComplianceDocumentInput;
  isSubmitting: boolean;
  error: string | null;
  onChange: (input: ComplianceDocumentInput) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * Add/edit modal for the Phase 14 Compliance Documents feature, styled
 * consistently with add-area-modal.tsx (bottom sheet, checkbox-style
 * single-select rows) and corrective-actions/[id].tsx's pill-style status
 * picker. Photo/scan attachment is a separate action on the list screen
 * itself (attachComplianceDocumentPhoto needs a saved document id to
 * upload against), not part of this form.
 */
export function ComplianceDocumentModal({
  visible,
  isEditing,
  input,
  isSubmitting,
  error,
  onChange,
  onCancel,
  onSubmit,
}: ComplianceDocumentModalProps) {
  function set<K extends keyof ComplianceDocumentInput>(key: K, value: ComplianceDocumentInput[K]) {
    onChange({ ...input, [key]: value });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            <Text style={typography.sectionTitle}>
              {isEditing ? 'Edit compliance document' : 'Add compliance document'}
            </Text>

            <Text style={[typography.label, styles.fieldLabel]}>Document type</Text>
            <View style={styles.typeList}>
              {COMPLIANCE_DOCUMENT_TYPES.map((type: ComplianceDocumentType) => {
                const isSelected = input.documentType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => set('documentType', type)}
                    style={({ pressed }) => [
                      styles.typeRow,
                      isSelected && styles.typeRowSelected,
                      pressed && styles.rowPressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                  >
                    <Text style={isSelected ? typography.bodyStrong : typography.body}>
                      {COMPLIANCE_DOCUMENT_TYPE_LABELS[type]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextField
              label="Title"
              value={input.title}
              onChangeText={(text) => set('title', text)}
              placeholder="e.g. Boiler Certificate #12345"
            />
            <TextField
              label="Issuing authority (optional)"
              value={input.issuingAuthority}
              onChangeText={(text) => set('issuingAuthority', text)}
              placeholder="e.g. NYC Dept. of Buildings"
            />
            <TextField
              label="Expiration date (optional)"
              value={input.expirationDate ?? ''}
              onChangeText={(text) => set('expirationDate', text || null)}
              placeholder="YYYY-MM-DD (blank for none)"
            />

            <Text style={[typography.label, styles.fieldLabel]}>Status</Text>
            <View style={styles.statusRow}>
              {COMPLIANCE_DOCUMENT_STATUSES.map((status: ComplianceDocumentStatus) => {
                const isSelected = input.status === status;
                return (
                  <Pressable
                    key={status}
                    onPress={() => set('status', status)}
                    style={({ pressed }) => [
                      styles.pill,
                      isSelected && styles.pillSelected,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                      {COMPLIANCE_DOCUMENT_STATUS_LABELS[status]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {input.status === 'valid' ? (
              <Text style={[typography.caption, styles.hint]}>
                With an expiration date set, this will show as &ldquo;Valid,&rdquo; &ldquo;Expiring
                soon,&rdquo; or &ldquo;Expired&rdquo; automatically based on today&apos;s date.
              </Text>
            ) : null}

            <TextField
              label="Notes (optional)"
              value={input.notes}
              onChangeText={(text) => set('notes', text)}
              placeholder="Any other detail worth recording"
              multiline
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.actionButton}>
              <Button
                label={isEditing ? 'Save changes' : 'Add document'}
                onPress={onSubmit}
                loading={isSubmitting}
                disabled={!input.title.trim()}
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
    maxHeight: '90%',
  },
  scroll: {
    gap: spacing.md,
  },
  fieldLabel: {
    marginTop: spacing.sm,
  },
  hint: {
    color: colors.textSecondary,
  },
  typeList: {
    gap: spacing.xs,
  },
  typeRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeRowSelected: {
    backgroundColor: colors.background,
    borderColor: colors.slate,
  },
  rowPressed: {
    opacity: 0.6,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  pillSelected: {
    backgroundColor: colors.slate,
    borderColor: colors.slate,
  },
  pillTextSelected: {
    color: colors.textInverse,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
