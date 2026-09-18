import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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

import { ComplianceDocumentModal } from '@/components/compliance-document-modal';
import { Screen } from '@/components/screen';
import {
  COMPLIANCE_DISPLAY_STATUS_COLORS,
  COMPLIANCE_DISPLAY_STATUS_LABELS,
  COMPLIANCE_DOCUMENT_TYPE_LABELS,
  computeDisplayStatus,
  friendlyComplianceDocumentError,
} from '@/lib/compliance-document-types';
import {
  attachComplianceDocumentPhoto,
  ComplianceDocument,
  ComplianceDocumentInput,
  createComplianceDocument,
  deleteComplianceDocument,
  fetchComplianceDocuments,
  updateComplianceDocument,
} from '@/lib/compliance-documents';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, radius, spacing, typography } from '@/theme';

const EMPTY_INPUT: ComplianceDocumentInput = {
  documentType: 'other',
  title: '',
  issuingAuthority: '',
  expirationDate: null,
  status: 'valid',
  notes: '',
};

function inputFromDocument(doc: ComplianceDocument): ComplianceDocumentInput {
  return {
    documentType: doc.documentType,
    title: doc.title,
    issuingAuthority: doc.issuingAuthority ?? '',
    expirationDate: doc.expirationDate,
    status: doc.status,
    notes: doc.notes ?? '',
  };
}

/**
 * Phase 14: Compliance Documents. Property-level tracking for the
 * certificate-expiration/permit-status half of the checklist the user
 * shared -- deliberately kept separate from Phase 13's checklist-content
 * migration (0024) since this is document/date state, not a per-location
 * checkbox item. See supabase/migrations/0025's header comment.
 *
 * Read is open to the whole org; add/edit/delete and photo attachment are
 * gated to org_admin/portfolio_manager/supervisor, matching the table's
 * RLS -- `canManage` below is a UX convenience (hide controls a write
 * would be rejected for anyway), not the actual enforcement boundary.
 */
export default function PropertyComplianceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: organization } = useCurrentOrganization();
  const canManage = organization
    ? ['org_admin', 'portfolio_manager', 'supervisor'].includes(organization.role)
    : false;

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ComplianceDocument[] | null>(null);
  const [signedUrlByPath, setSignedUrlByPath] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ComplianceDocument | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalInput, setModalInput] = useState<ComplianceDocumentInput>(EMPTY_INPUT);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;

    const propertyResult = await supabase
      .from('properties')
      .select('name, organization_id')
      .eq('id', id)
      .single();

    if (propertyResult.error) {
      logger.error('property-compliance', 'Failed to load property', propertyResult.error);
      setLoadError('Could not load this property.');
      return;
    }
    const property = propertyResult.data as { name: string; organization_id: string };
    setPropertyName(property.name);
    setOrganizationId(property.organization_id);

    const { documents: docs, signedUrlByPath: urls, error } = await fetchComplianceDocuments(id);
    if (error) {
      setLoadError(error);
      return;
    }
    setLoadError(null);
    setDocuments(docs);
    setSignedUrlByPath(urls);
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

  function openEditModal(doc: ComplianceDocument) {
    setEditing(doc);
    setModalInput(inputFromDocument(doc));
    setModalError(null);
    setModalVisible(true);
  }

  async function handleSubmit() {
    if (!id || !organizationId) return;
    if (!modalInput.title.trim()) {
      setModalError('A title is required.');
      return;
    }

    setIsSaving(true);
    const result = editing
      ? await updateComplianceDocument(editing.id, modalInput)
      : await createComplianceDocument(organizationId, id, modalInput);
    setIsSaving(false);

    if (result.error) {
      setModalError(friendlyComplianceDocumentError(result.error));
      return;
    }
    setModalVisible(false);
    load();
  }

  function confirmDelete(doc: ComplianceDocument) {
    Alert.alert('Delete this document?', `This removes "${doc.title}" permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteComplianceDocument(doc.id);
          if (error) {
            Alert.alert('Could not delete', friendlyComplianceDocumentError(error));
            return;
          }
          load();
        },
      },
    ]);
  }

  function promptAttachPhoto(doc: ComplianceDocument) {
    if (!organizationId || !id) return;
    Alert.alert('Attach photo or scan', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photo', onPress: () => handleAttachPhoto(doc, 'camera') },
      { text: 'Choose from library', onPress: () => handleAttachPhoto(doc, 'library') },
    ]);
  }

  async function handleAttachPhoto(doc: ComplianceDocument, source: 'camera' | 'library') {
    if (!organizationId || !id) return;
    setUploadingId(doc.id);
    const { error } = await attachComplianceDocumentPhoto(organizationId, id, doc.id, source);
    setUploadingId(null);
    if (error) {
      Alert.alert('Could not attach photo', error);
      return;
    }
    load();
  }

  if (documents === null) {
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
        <Text style={typography.screenTitle}>Compliance documents</Text>
        <Text style={[typography.body, styles.hint]}>{propertyName}</Text>

        {documents.length === 0 ? (
          <Text style={[typography.body, styles.hint]}>
            No compliance documents yet. Track certificate expirations, permits, and filings here —
            boiler and elevator certificates, fire safety permits, FISP/LL11 status, and anything
            else with a renewal date.
          </Text>
        ) : (
          documents.map((doc) => {
            const displayStatus = computeDisplayStatus(doc.status, doc.expirationDate);
            const statusColor = COMPLIANCE_DISPLAY_STATUS_COLORS[displayStatus];
            const photoUrl = doc.storagePath ? signedUrlByPath[doc.storagePath] : null;

            return (
              <Pressable
                key={doc.id}
                onPress={() => canManage && openEditModal(doc)}
                disabled={!canManage}
                style={({ pressed }) => [styles.row, pressed && canManage && styles.rowPressed]}
              >
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.thumbnail} contentFit="cover" />
                ) : (
                  <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                    <Ionicons name="document-text-outline" size={22} color={colors.textDisabled} />
                  </View>
                )}

                <View style={styles.rowText}>
                  <Text style={typography.bodyStrong}>{doc.title}</Text>
                  <Text style={typography.caption}>
                    {COMPLIANCE_DOCUMENT_TYPE_LABELS[doc.documentType]}
                    {doc.issuingAuthority ? ` · ${doc.issuingAuthority}` : ''}
                  </Text>
                  {doc.expirationDate ? (
                    <Text style={typography.caption}>Expires {doc.expirationDate}</Text>
                  ) : null}
                  <View style={[styles.statusBadge, { borderColor: statusColor }]}>
                    <Text style={[typography.caption, { color: statusColor }]}>
                      {COMPLIANCE_DISPLAY_STATUS_LABELS[displayStatus]}
                    </Text>
                  </View>
                </View>

                {canManage ? (
                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => promptAttachPhoto(doc)}
                      disabled={uploadingId === doc.id}
                      accessibilityRole="button"
                      accessibilityLabel="Attach photo or scan"
                      style={({ pressed }) => [styles.iconButton, pressed && styles.rowPressed]}
                    >
                      {uploadingId === doc.id ? (
                        <ActivityIndicator size="small" color={colors.slate} />
                      ) : (
                        <Ionicons name="camera-outline" size={20} color={colors.slate} />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDelete(doc)}
                      accessibilityRole="button"
                      accessibilityLabel="Delete document"
                      style={({ pressed }) => [styles.iconButton, pressed && styles.rowPressed]}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  </View>
                ) : null}
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
            <Text style={typography.bodyStrong}>Add compliance document</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <ComplianceDocumentModal
        visible={modalVisible}
        isEditing={!!editing}
        input={modalInput}
        isSubmitting={isSaving}
        error={modalError}
        onChange={setModalInput}
        onCancel={() => setModalVisible(false)}
        onSubmit={handleSubmit}
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
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
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
