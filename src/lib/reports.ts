import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { fetchPhotosForItems } from '@/lib/inspection-photos';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme';

/**
 * Phase 7: reports (supabase/migrations/0021). PRODUCT_SPEC.md section 11
 * only ever said "branded PDF report, generated client-side, immutable
 * once approved" -- the actual content/layout was never spelled out (the
 * v0.1 detail behind that line was never carried into v0.2), so this
 * module defines it: a cover header, a scope summary (every area
 * inspected/skipped/inaccessible, with required reasons), a findings
 * section for anything needing attention (sorted P1 first), and a full
 * item-by-item checklist appendix. See DATABASE_SCHEMA.md's "reports"
 * entry and CHANGELOG.md's Phase 7 entry for the design rationale.
 *
 * The PDF is rendered on-device from HTML via expo-print -- nothing is
 * generated server-side. `approveReport()` uploads the rendered file to
 * the private `inspection-reports` Storage bucket itself (same
 * `{organization_id}/...` path-prefix RLS shape as inspection-photos),
 * then calls `approve_report()` to record it -- only once that RPC
 * succeeds does a report formally exist. A network failure between the
 * upload and the RPC call leaves an orphaned Storage object with no
 * matching `reports` row -- same acceptable-for-now class of orphan this
 * project already accepts for photos on `delete_inspection()` (see
 * 0015's comment) -- the user just retries "Approve", which uploads a
 * fresh file under a new name.
 */

export const INSPECTION_REPORTS_BUCKET = 'inspection-reports';
const SIGNED_URL_TTL_SECONDS = 3600;

// Both mean "this needs attention" for report purposes -- 'deficiency' is
// the ordinary case, 'pending_verification' is an item whose corrective
// work is done but not yet supervisor-verified, so it still belongs in
// the findings section rather than being silently folded into "OK."
const NEEDS_ATTENTION_STATUSES = new Set(['deficiency', 'pending_verification']);

const PRIORITY_SORT_ORDER: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

type ReportItem = {
  id: string;
  title: string;
  status: string;
  observation: string | null;
  recommendation: string | null;
  priority: string | null;
  codeReference: string | null;
  measurementValue: number | null;
  measurementUnit: string | null;
  responsibleDepartment: string | null;
  correctiveActionStatus: string | null;
  escalated: boolean;
  photoUrls: string[];
};

type ReportLocation = {
  id: string;
  name: string;
  status: string;
  statusReason: string | null;
  items: ReportItem[];
};

export type ReportData = {
  inspectionId: string;
  organizationName: string;
  propertyName: string;
  address: string | null;
  inspectionType: string;
  scheduledDate: string | null;
  completedAt: string | null;
  inspectorName: string | null;
  approverName: string;
  approverOrgId: string;
  approvedAtIso: string;
  locations: ReportLocation[];
};

function toArray<T>(value: T | T[] | null): T[] {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function formatAddress(row: {
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  const parts = [row.street_address, [row.city, row.state].filter(Boolean).join(', '), row.zip]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(' — ') : null;
}

/**
 * Pure fetch, no PDF rendering -- separated so the preview and approve
 * flows both start from the exact same data instead of drifting.
 */
export async function fetchReportData(
  inspectionId: string,
): Promise<{ data: ReportData | null; error: string | null }> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) {
    return { data: null, error: 'Not signed in.' };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, full_name, organizations(name)')
    .eq('id', userId)
    .single();

  if (profileError || !profileRow) {
    logger.error('reports', 'Failed to load approver profile', profileError);
    return { data: null, error: 'Could not load your account details.' };
  }

  const profile = profileRow as unknown as {
    organization_id: string;
    full_name: string | null;
    organizations: { name: string } | { name: string }[] | null;
  };
  const org = toArray(profile.organizations)[0];

  const { data: snapshotRow, error: snapshotError } = await supabase
    .from('inspection_snapshots')
    .select(
      'id, inspections(id, status, inspection_type, scheduled_date, completed_at, assigned_inspector_id, properties(name, street_address, city, state, zip))',
    )
    .eq('inspection_id', inspectionId)
    .single();

  if (snapshotError || !snapshotRow) {
    logger.error('reports', 'Failed to load inspection', snapshotError);
    return { data: null, error: 'Could not load this inspection.' };
  }

  const snapshot = snapshotRow as unknown as {
    id: string;
    inspections:
      | {
          id: string;
          status: string;
          inspection_type: string;
          scheduled_date: string | null;
          completed_at: string | null;
          assigned_inspector_id: string | null;
          properties:
            | {
                name: string;
                street_address: string | null;
                city: string | null;
                state: string | null;
                zip: string | null;
              }
            | {
                name: string;
                street_address: string | null;
                city: string | null;
                state: string | null;
                zip: string | null;
              }[]
            | null;
        }
      | {
          id: string;
          status: string;
          inspection_type: string;
          scheduled_date: string | null;
          completed_at: string | null;
          assigned_inspector_id: string | null;
          properties:
            | {
                name: string;
                street_address: string | null;
                city: string | null;
                state: string | null;
                zip: string | null;
              }
            | {
                name: string;
                street_address: string | null;
                city: string | null;
                state: string | null;
                zip: string | null;
              }[]
            | null;
        }[]
      | null;
  };
  const inspection = toArray(snapshot.inspections)[0];
  if (!inspection) {
    return { data: null, error: 'Could not load this inspection.' };
  }
  const property = toArray(inspection.properties)[0];

  if (inspection.status !== 'completed') {
    return { data: null, error: 'This inspection has not been submitted yet.' };
  }

  let inspectorName: string | null = null;
  if (inspection.assigned_inspector_id) {
    const { data: inspectorRow } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', inspection.assigned_inspector_id)
      .single();
    inspectorName = (inspectorRow as { full_name: string | null } | null)?.full_name ?? null;
  }

  const { data: locationRows, error: locationsError } = await supabase
    .from('inspection_snapshot_locations')
    .select('id, status, status_reason, sequence_order, property_locations(name)')
    .eq('inspection_snapshot_id', snapshot.id)
    .order('sequence_order');

  if (locationsError) {
    logger.error('reports', 'Failed to load areas', locationsError);
    return { data: null, error: 'Could not load this inspection’s areas.' };
  }

  const locationsRaw = (locationRows ?? []) as {
    id: string;
    status: string;
    status_reason: string | null;
    property_locations: { name: string } | { name: string }[] | null;
  }[];
  const locationIds = locationsRaw.map((l) => l.id);

  const { data: itemRows, error: itemsError } =
    locationIds.length > 0
      ? await supabase
          .from('inspection_snapshot_items')
          .select(
            'id, inspection_snapshot_location_id, title, status, observation, recommendation, priority, code_reference, measurement_value, measurement_unit, responsible_department, created_at',
          )
          .in('inspection_snapshot_location_id', locationIds)
          .order('created_at')
      : { data: [], error: null };

  if (itemsError) {
    logger.error('reports', 'Failed to load checklist items', itemsError);
    return { data: null, error: 'Could not load this inspection’s checklist items.' };
  }

  const items = (itemRows ?? []) as {
    id: string;
    inspection_snapshot_location_id: string;
    title: string;
    status: string;
    observation: string | null;
    recommendation: string | null;
    priority: string | null;
    code_reference: string | null;
    measurement_value: number | null;
    measurement_unit: string | null;
    responsible_department: string | null;
  }[];
  const itemIds = items.map((i) => i.id);

  const { photosByItem, error: photosError } = await fetchPhotosForItems(itemIds);
  if (photosError) {
    logger.error('reports', 'Failed to load photos for report', { photosError });
  }

  const { data: findingRows, error: findingsError } = await supabase
    .from('findings')
    .select('inspection_snapshot_item_id, current_status, escalated')
    .eq('inspection_id', inspectionId);

  if (findingsError) {
    logger.error('reports', 'Failed to load findings for report', findingsError);
  }
  const findingByItem = new Map<string, { current_status: string; escalated: boolean }>();
  for (const row of (findingRows ?? []) as {
    inspection_snapshot_item_id: string | null;
    current_status: string;
    escalated: boolean;
  }[]) {
    if (row.inspection_snapshot_item_id) findingByItem.set(row.inspection_snapshot_item_id, row);
  }

  const itemsByLocation = new Map<string, ReportItem[]>();
  for (const item of items) {
    const finding = findingByItem.get(item.id);
    const reportItem: ReportItem = {
      id: item.id,
      title: item.title,
      status: item.status,
      observation: item.observation,
      recommendation: item.recommendation,
      priority: item.priority,
      codeReference: item.code_reference,
      measurementValue: item.measurement_value,
      measurementUnit: item.measurement_unit,
      responsibleDepartment: item.responsible_department,
      correctiveActionStatus: finding?.current_status ?? null,
      escalated: finding?.escalated ?? false,
      photoUrls: (photosByItem[item.id] ?? [])
        .map((p) => p.signedUrl)
        .filter((u): u is string => !!u),
    };
    const list = itemsByLocation.get(item.inspection_snapshot_location_id) ?? [];
    list.push(reportItem);
    itemsByLocation.set(item.inspection_snapshot_location_id, list);
  }

  const locations: ReportLocation[] = locationsRaw.map((l) => ({
    id: l.id,
    name: toArray(l.property_locations)[0]?.name ?? 'Area',
    status: l.status,
    statusReason: l.status_reason,
    items: itemsByLocation.get(l.id) ?? [],
  }));

  return {
    data: {
      inspectionId,
      organizationName: org?.name ?? 'Organization',
      propertyName: property?.name ?? 'Property',
      address: property ? formatAddress(property) : null,
      inspectionType: inspection.inspection_type,
      scheduledDate: inspection.scheduled_date,
      completedAt: inspection.completed_at,
      inspectorName,
      approverName: profile.full_name ?? 'Unknown',
      approverOrgId: profile.organization_id,
      approvedAtIso: new Date().toISOString(),
      locations,
    },
    error: null,
  };
}

const LOCATION_STATUS_LABELS: Record<string, string> = {
  complete: 'Complete',
  skipped: 'Skipped',
  inaccessible: 'Inaccessible',
  not_applicable: 'Not applicable',
  pending: 'Not inspected',
  in_progress: 'Partially inspected',
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  satisfactory: 'Satisfactory',
  deficiency: 'Deficiency',
  not_applicable: 'Not applicable',
  not_inspected: 'Not inspected',
  pending_verification: 'Pending verification',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function priorityColor(priority: string | null): string {
  switch (priority) {
    case 'P1':
      return colors.priorityP1;
    case 'P2':
      return colors.priorityP2;
    case 'P3':
      return colors.priorityP3;
    case 'P4':
      return colors.priorityP4;
    default:
      return colors.statusNeutral;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Pure function: report data in, a full standalone HTML document out.
 * Rendered to PDF by expo-print (a WebView-based renderer), so this is
 * plain HTML/CSS -- no React Native styling APIs apply here.
 */
export function buildReportHtml(data: ReportData): string {
  const allItemsWithFindings = data.locations.flatMap((l) =>
    l.items
      .filter((i) => NEEDS_ATTENTION_STATUSES.has(i.status))
      .map((i) => ({ ...i, locationName: l.name })),
  );
  allItemsWithFindings.sort(
    (a, b) =>
      (PRIORITY_SORT_ORDER[a.priority ?? ''] ?? 9) - (PRIORITY_SORT_ORDER[b.priority ?? ''] ?? 9),
  );

  const skippedOrInaccessible = data.locations.filter((l) =>
    ['skipped', 'inaccessible'].includes(l.status),
  );

  const findingsHtml =
    allItemsWithFindings.length === 0
      ? `<p class="muted">No deficiencies were recorded during this inspection.</p>`
      : allItemsWithFindings
          .map(
            (item) => `
        <div class="finding-card" style="border-left-color: ${priorityColor(item.priority)}">
          <div class="finding-header">
            <span class="priority-badge" style="background: ${priorityColor(item.priority)}">${
              item.priority ?? 'N/A'
            }</span>
            <span class="finding-title">${escapeHtml(item.title)}</span>
            <span class="finding-location">${escapeHtml(item.locationName)}</span>
          </div>
          ${item.observation ? `<p><strong>Observation:</strong> ${escapeHtml(item.observation)}</p>` : ''}
          ${item.recommendation ? `<p><strong>Recommendation:</strong> ${escapeHtml(item.recommendation)}</p>` : ''}
          ${item.codeReference ? `<p><strong>Code reference:</strong> ${escapeHtml(item.codeReference)}</p>` : ''}
          ${item.responsibleDepartment ? `<p><strong>Responsible department:</strong> ${escapeHtml(item.responsibleDepartment)}</p>` : ''}
          <p><strong>Corrective action status:</strong> ${escapeHtml(item.correctiveActionStatus ?? 'open')}${
            item.escalated
              ? ' — <strong style="color:' + colors.danger + '">Escalated</strong>'
              : ''
          }</p>
          ${
            item.photoUrls.length > 0
              ? `<div class="photo-row">${item.photoUrls
                  .map((u) => `<img src="${u}" class="finding-photo" />`)
                  .join('')}</div>`
              : ''
          }
        </div>`,
          )
          .join('');

  const scopeHtml = data.locations
    .map(
      (l) => `
        <tr>
          <td>${escapeHtml(l.name)}</td>
          <td>${LOCATION_STATUS_LABELS[l.status] ?? l.status}</td>
          <td>${l.statusReason ? escapeHtml(l.statusReason) : '—'}</td>
        </tr>`,
    )
    .join('');

  const appendixHtml = data.locations
    .map(
      (l) => `
      <h3>${escapeHtml(l.name)}</h3>
      <table class="appendix-table">
        <thead><tr><th>Item</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${l.items
            .map(
              (i) => `
            <tr>
              <td>${escapeHtml(i.title)}</td>
              <td>${ITEM_STATUS_LABELS[i.status] ?? i.status}</td>
              <td>${i.observation ? escapeHtml(i.observation) : '—'}${
                i.measurementValue !== null
                  ? ` (${i.measurementValue}${i.measurementUnit ? ' ' + escapeHtml(i.measurementUnit) : ''})`
                  : ''
              }</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`,
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 36px; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: ${colors.textPrimary}; font-size: 12px; }
  h1 { color: ${colors.slate}; font-size: 22px; margin-bottom: 4px; }
  h2 { color: ${colors.slate}; font-size: 16px; border-bottom: 2px solid ${colors.border}; padding-bottom: 4px; margin-top: 28px; }
  h3 { color: ${colors.textSecondary}; font-size: 13px; margin-top: 18px; margin-bottom: 6px; }
  .muted { color: ${colors.textSecondary}; font-style: italic; }
  .cover { border-bottom: 4px solid ${colors.slate}; padding-bottom: 16px; margin-bottom: 8px; }
  .cover-org { color: ${colors.textSecondary}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .meta-table td { padding: 4px 8px 4px 0; vertical-align: top; }
  .meta-label { color: ${colors.textSecondary}; width: 160px; }
  table.appendix-table, table.scope-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.appendix-table th, table.appendix-table td,
  table.scope-table th, table.scope-table td {
    border: 1px solid ${colors.border}; padding: 6px 8px; text-align: left; font-size: 11px;
  }
  table.appendix-table th, table.scope-table th { background: ${colors.background}; }
  .finding-card {
    border: 1px solid ${colors.border}; border-left-width: 6px; border-radius: 6px;
    padding: 10px 14px; margin-bottom: 12px; page-break-inside: avoid;
  }
  .finding-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .priority-badge { color: ${colors.textInverse}; font-weight: bold; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
  .finding-title { font-weight: bold; font-size: 13px; }
  .finding-location { color: ${colors.textSecondary}; font-size: 11px; }
  .photo-row { margin-top: 8px; }
  .finding-photo { width: 140px; height: 105px; object-fit: cover; border-radius: 4px; margin-right: 6px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid ${colors.border}; color: ${colors.textSecondary}; font-size: 10px; }
</style>
</head>
<body>
  <div class="cover">
    <div class="cover-org">${escapeHtml(data.organizationName)}</div>
    <h1>Inspection Report</h1>
    <div>${escapeHtml(data.propertyName)}${data.address ? ' — ' + escapeHtml(data.address) : ''}</div>
  </div>

  <table class="meta-table">
    <tr><td class="meta-label">Inspection type</td><td>${escapeHtml(data.inspectionType)}</td></tr>
    <tr><td class="meta-label">Scheduled date</td><td>${formatDate(data.scheduledDate)}</td></tr>
    <tr><td class="meta-label">Completed</td><td>${formatDate(data.completedAt)}</td></tr>
    <tr><td class="meta-label">Inspector</td><td>${escapeHtml(data.inspectorName ?? 'Unassigned')}</td></tr>
    <tr><td class="meta-label">Approved by</td><td>${escapeHtml(data.approverName)}</td></tr>
    <tr><td class="meta-label">Approved on</td><td>${formatDate(data.approvedAtIso)}</td></tr>
  </table>

  <h2>Scope summary</h2>
  <table class="scope-table">
    <thead><tr><th>Area</th><th>Status</th><th>Reason (if skipped/inaccessible)</th></tr></thead>
    <tbody>${scopeHtml}</tbody>
  </table>
  ${
    skippedOrInaccessible.length > 0
      ? `<p class="muted">${skippedOrInaccessible.length} area(s) were not inspected -- see reasons above.</p>`
      : ''
  }

  <h2>Findings requiring attention</h2>
  ${findingsHtml}

  <h2>Full checklist</h2>
  ${appendixHtml}

  <div class="footer">
    Generated by Capex Inspection Pro. This report is a documentation and workflow record; it does not replace
    inspections or certifications performed by licensed or qualified professionals and does not itself
    constitute a code-compliance determination.
  </div>
</body>
</html>`;
}

async function renderPdfFile(data: ReportData): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html: buildReportHtml(data) });
  return uri;
}

/**
 * Renders the current state of the inspection to a PDF and opens the
 * device's share/preview sheet -- lets an approver look over the report
 * before committing to "Approve," per PRODUCT_SPEC.md's "Preview before
 * approval" screen note. Does not touch the network beyond whatever
 * fetchReportData() itself reads; nothing is uploaded or recorded here.
 */
export async function previewReport(inspectionId: string): Promise<{ error: string | null }> {
  const { data, error } = await fetchReportData(inspectionId);
  if (error || !data) return { error: error ?? 'Could not load this report.' };

  try {
    const uri = await renderPdfFile(data);
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { error: 'Sharing is not available on this device.' };
    }
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Preview report' });
    return { error: null };
  } catch (err) {
    logger.error('reports', 'Failed to render report preview', err);
    return { error: 'Could not generate the report preview.' };
  }
}

/**
 * Renders a fresh PDF from the inspection's current data, uploads it to
 * the private `inspection-reports` bucket, then calls `approve_report()`
 * to record it. Regenerating at approval time (rather than reusing
 * whatever was last previewed) means the approved PDF always reflects
 * exactly what was true the moment it was approved, even if the preview
 * happened earlier -- for a 'completed' inspection nothing about its own
 * checklist can change anymore, so in practice this only matters if a
 * corrective action's status changed between preview and approval.
 */
export async function approveReport(
  inspectionId: string,
): Promise<{ error: string | null; reportId?: string }> {
  const { data, error } = await fetchReportData(inspectionId);
  if (error || !data) return { error: error ?? 'Could not load this report.' };

  let uri: string;
  try {
    uri = await renderPdfFile(data);
  } catch (err) {
    logger.error('reports', 'Failed to render report for approval', err);
    return { error: 'Could not generate the report.' };
  }

  let plainBytes: Uint8Array;
  try {
    const response = await fetch(uri);
    plainBytes = new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    logger.error('reports', 'Failed to read generated PDF', err);
    return { error: 'Could not prepare the report for upload.' };
  }

  const storagePath = `${data.approverOrgId}/${inspectionId}/${Crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(INSPECTION_REPORTS_BUCKET)
    .upload(storagePath, plainBytes, { contentType: 'application/pdf' });

  if (uploadError) {
    logger.error('reports', 'Failed to upload report PDF', uploadError);
    return { error: uploadError.message };
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('approve_report', {
    p_inspection_id: inspectionId,
    p_storage_path: storagePath,
  });

  if (rpcError) {
    logger.error('reports', 'approve_report failed', rpcError);
    return { error: rpcError.message };
  }

  return { error: null, reportId: (rpcData as { id: string } | null)?.id };
}

export type ApprovedReportSummary = {
  approvedAt: string;
  approverName: string | null;
  signedUrl: string | null;
};

/**
 * Looks up whether this inspection already has an approved report, and if
 * so, a short-lived signed URL to view/share it. Returns
 * `{ report: null }` (not an error) when no report exists yet -- that's
 * the ordinary case for any inspection that hasn't been approved.
 */
export async function getApprovedReport(
  inspectionId: string,
): Promise<{ report: ApprovedReportSummary | null; error: string | null }> {
  const { data, error } = await supabase
    .from('reports')
    .select('storage_path, approved_at, profiles(full_name)')
    .eq('inspection_id', inspectionId)
    .maybeSingle();

  if (error) {
    logger.error('reports', 'Failed to check for an approved report', error);
    return { report: null, error: 'Could not check this inspection’s report status.' };
  }
  if (!data) return { report: null, error: null };

  const row = data as unknown as {
    storage_path: string;
    approved_at: string;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  };

  const { data: signedData, error: signedError } = await supabase.storage
    .from(INSPECTION_REPORTS_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signedError) {
    logger.error('reports', 'Failed to create a signed URL for the report', signedError);
  }

  return {
    report: {
      approvedAt: row.approved_at,
      approverName: toArray(row.profiles)[0]?.full_name ?? null,
      signedUrl: signedData?.signedUrl ?? null,
    },
    error: null,
  };
}

/**
 * Downloads an already-approved report to this device's cache and opens
 * the share sheet -- the "download/share after" half of PRODUCT_SPEC.md's
 * Report preview / PDF viewer screen.
 */
export async function shareApprovedReport(
  signedUrl: string,
  inspectionId: string,
): Promise<{ error: string | null }> {
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { error: 'Sharing is not available on this device.' };
    }
    const dir = new Directory(Paths.cache, 'report-downloads');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

    const response = await fetch(signedUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const file = new File(dir, `${inspectionId}.pdf`);
    file.create({ overwrite: true });
    file.write(bytes);

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share report',
    });
    return { error: null };
  } catch (err) {
    logger.error('reports', 'Failed to share approved report', err);
    return { error: 'Could not share this report.' };
  }
}
