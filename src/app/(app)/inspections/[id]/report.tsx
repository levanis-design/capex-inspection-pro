import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { logger } from '@/lib/logger';
import {
  ApprovedReportSummary,
  approveReport,
  getApprovedReport,
  previewReport,
  shareApprovedReport,
} from '@/lib/reports';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, radius, spacing, typography } from '@/theme';

// Same three roles PRODUCT_SPEC.md section 4's "Review & approve reports"
// row grants Y to -- matches the gate approve_report() itself enforces
// server-side (supabase/migrations/0021), this is just the client-side
// mirror of it so an inspector/viewer never sees a button that would
// just come back with `insufficient_permission`.
const APPROVER_ROLES = ['org_admin', 'portfolio_manager', 'supervisor'];

// Maps approve_report()'s exception codes (0021) to messages a
// non-technical user can act on -- same pattern as inspections/new.tsx's
// start_inspection() error mapping. Falls through to Storage/network
// error messages unchanged, since those are already reasonably plain.
const ERROR_MESSAGES: Record<string, string> = {
  insufficient_permission:
    'Only an organization admin, portfolio manager, or supervisor can approve a report.',
  inspection_not_completed: 'This inspection must be submitted before its report can be approved.',
  report_already_approved: 'This inspection already has an approved report.',
  inspection_not_found: 'Could not find this inspection.',
  not_authenticated:
    'We could not confirm your account. Try signing out and back in — if this keeps happening, contact support.',
};

function friendlyError(rawMessage: string): string {
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return ERROR_MESSAGES[code];
  }
  return rawMessage;
}

/**
 * Report preview / PDF viewer screen (PRODUCT_SPEC.md section 6). Reached
 * from the review screen once an inspection is submitted. Three states:
 * no report yet + can't approve (waiting on someone else), no report yet
 * + can approve (preview and/or approve), or an approved report already
 * exists (view/share only -- approving again is not offered, matching
 * `approve_report()`'s one-shot, immutable design).
 */
export default function InspectionReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: organization } = useCurrentOrganization();
  const canApprove = organization ? APPROVER_ROLES.includes(organization.role) : false;

  const [report, setReport] = useState<ApprovedReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    const result = await getApprovedReport(id);
    setIsLoading(false);
    if (result.error) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setReport(result.report);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handlePreview() {
    if (!id) return;
    setActionError(null);
    setIsPreviewing(true);
    const { error } = await previewReport(id);
    setIsPreviewing(false);
    if (error) {
      logger.warn('inspection-report', 'Preview failed', { message: error });
      setActionError(friendlyError(error));
    }
  }

  async function handleApprove() {
    if (!id) return;
    setActionError(null);
    setIsApproving(true);
    const { error } = await approveReport(id);
    setIsApproving(false);
    setConfirmingApprove(false);
    if (error) {
      logger.warn('inspection-report', 'Approve failed', { message: error });
      setActionError(friendlyError(error));
      return;
    }
    await load();
  }

  async function handleShare() {
    if (!id || !report?.signedUrl) return;
    setActionError(null);
    setIsSharing(true);
    const { error } = await shareApprovedReport(report.signedUrl, id);
    setIsSharing(false);
    if (error) setActionError(error);
  }

  if (isLoading && !report && !loadError) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.slate} />
        </View>
      </Screen>
    );
  }

  if (loadError && !report) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={[typography.body, styles.errorText]}>{loadError}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen noPadding>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.screenTitle}>Inspection Report</Text>

        {report ? (
          <View style={styles.approvedCard}>
            <Text style={[typography.bodyStrong, styles.approvedTitle]}>Report approved</Text>
            <Text style={typography.body}>
              Approved by {report.approverName ?? 'Unknown'} on{' '}
              {new Date(report.approvedAt).toLocaleDateString()}
            </Text>
            <Text style={[typography.caption, styles.immutableNote]}>
              This report is final and cannot be edited or re-approved.
            </Text>
          </View>
        ) : (
          <View style={styles.pendingCard}>
            <Text style={typography.body}>
              This inspection has been submitted, but no report has been approved yet.
            </Text>
            {!canApprove ? (
              <Text style={[typography.caption, styles.waitingNote]}>
                Waiting for an organization admin, portfolio manager, or supervisor to approve the
                report.
              </Text>
            ) : null}
          </View>
        )}

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        {report ? (
          <Button
            label="Email / share report"
            onPress={handleShare}
            loading={isSharing}
            disabled={!report.signedUrl}
          />
        ) : canApprove ? (
          <View style={styles.footerButtons}>
            <View style={styles.footerButton}>
              <Button
                label="Preview"
                variant="secondary"
                onPress={handlePreview}
                loading={isPreviewing}
              />
            </View>
            <View style={styles.footerButton}>
              {confirmingApprove ? (
                <View style={styles.confirmRow}>
                  <Text style={[typography.caption, styles.confirmText]}>
                    Approve this report? It becomes final and can&apos;t be edited or redone.
                  </Text>
                  <View style={styles.confirmActions}>
                    <View style={styles.confirmActionButton}>
                      <Button
                        label="Cancel"
                        variant="secondary"
                        onPress={() => setConfirmingApprove(false)}
                      />
                    </View>
                    <View style={styles.confirmActionButton}>
                      <Button label="Approve" onPress={handleApprove} loading={isApproving} />
                    </View>
                  </View>
                </View>
              ) : (
                <Button label="Approve & finalize" onPress={() => setConfirmingApprove(true)} />
              )}
            </View>
          </View>
        ) : null}
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
  errorText: {
    color: colors.danger,
  },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  approvedCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  approvedTitle: {
    color: colors.success,
  },
  immutableNote: {
    marginTop: spacing.xs,
  },
  pendingCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  waitingNote: {
    marginTop: spacing.xs,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerButton: {
    flex: 1,
  },
  confirmRow: {
    gap: spacing.sm,
  },
  confirmText: {
    color: colors.danger,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmActionButton: {
    flex: 1,
  },
});
