import * as ImagePicker from 'expo-image-picker';

import { ComplianceDocumentStatus, ComplianceDocumentType } from '@/lib/compliance-document-types';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Data layer for the Phase 14 Compliance Documents feature
 * (supabase/migrations/0025). Deliberately a plain online-only CRUD
 * module -- see that migration's header comment for why this doesn't
 * reuse the offline-first encrypted local mirror that inspection photos
 * use (offline-photos.ts): managing compliance records is an admin/office
 * task, not a field-inspector one taken with unreliable signal.
 */

export const COMPLIANCE_DOCUMENTS_BUCKET = 'compliance-documents';
const SIGNED_URL_TTL_SECONDS = 3600;

export type ComplianceDocument = {
  id: string;
  propertyId: string;
  documentType: ComplianceDocumentType;
  title: string;
  issuingAuthority: string | null;
  expirationDate: string | null;
  status: ComplianceDocumentStatus;
  notes: string | null;
  storagePath: string | null;
  createdAt: string;
  updatedAt: string;
};

type ComplianceDocumentRow = {
  id: string;
  property_id: string;
  document_type: string;
  title: string;
  issuing_authority: string | null;
  expiration_date: string | null;
  status: string;
  notes: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: ComplianceDocumentRow): ComplianceDocument {
  return {
    id: row.id,
    propertyId: row.property_id,
    documentType: row.document_type as ComplianceDocumentType,
    title: row.title,
    issuingAuthority: row.issuing_authority,
    expirationDate: row.expiration_date,
    status: row.status as ComplianceDocumentStatus,
    notes: row.notes,
    storagePath: row.storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS =
  'id, property_id, document_type, title, issuing_authority, expiration_date, status, notes, storage_path, created_at, updated_at';

/**
 * Loads every compliance document for a property, plus a short-lived
 * signed URL for whichever ones have a photo/scan attached (the bucket is
 * private -- see migration 0025 -- same reasoning as
 * inspection-photos.ts's fetchPhotosForItems).
 */
export async function fetchComplianceDocuments(propertyId: string): Promise<{
  documents: ComplianceDocument[];
  signedUrlByPath: Record<string, string>;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('compliance_documents')
    .select(SELECT_COLUMNS)
    .eq('property_id', propertyId)
    .order('expiration_date', { ascending: true, nullsFirst: false });

  if (error) {
    logger.error('compliance-documents', 'Failed to load compliance documents', error);
    return { documents: [], signedUrlByPath: {}, error: 'Could not load compliance documents.' };
  }

  const rows = (data ?? []) as ComplianceDocumentRow[];
  const documents = rows.map(fromRow);

  const pathsNeedingUrls = documents
    .map((d) => d.storagePath)
    .filter((path): path is string => !!path);

  const signedUrlByPath: Record<string, string> = {};
  if (pathsNeedingUrls.length > 0) {
    const { data: signedData, error: signedError } = await supabase.storage
      .from(COMPLIANCE_DOCUMENTS_BUCKET)
      .createSignedUrls(pathsNeedingUrls, SIGNED_URL_TTL_SECONDS);
    if (signedError) {
      logger.error('compliance-documents', 'Failed to create signed URLs', signedError);
    } else {
      for (const entry of signedData ?? []) {
        if (entry.path && entry.signedUrl) signedUrlByPath[entry.path] = entry.signedUrl;
      }
    }
  }

  return { documents, signedUrlByPath, error: null };
}

export type ComplianceDocumentInput = {
  documentType: ComplianceDocumentType;
  title: string;
  issuingAuthority: string;
  expirationDate: string | null;
  status: ComplianceDocumentStatus;
  notes: string;
};

export async function createComplianceDocument(
  organizationId: string,
  propertyId: string,
  input: ComplianceDocumentInput,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('compliance_documents')
    .insert({
      organization_id: organizationId,
      property_id: propertyId,
      document_type: input.documentType,
      title: input.title.trim(),
      issuing_authority: input.issuingAuthority.trim() || null,
      expiration_date: input.expirationDate,
      status: input.status,
      notes: input.notes.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    logger.error('compliance-documents', 'Failed to create compliance document', error);
    return { id: null, error: error.message };
  }
  return { id: (data as { id: string }).id, error: null };
}

export async function updateComplianceDocument(
  id: string,
  input: ComplianceDocumentInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('compliance_documents')
    .update({
      document_type: input.documentType,
      title: input.title.trim(),
      issuing_authority: input.issuingAuthority.trim() || null,
      expiration_date: input.expirationDate,
      status: input.status,
      notes: input.notes.trim() || null,
    })
    .eq('id', id);

  if (error) {
    logger.error('compliance-documents', 'Failed to update compliance document', error);
    return { error: error.message };
  }
  return { error: null };
}

export async function deleteComplianceDocument(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('compliance_documents').delete().eq('id', id);
  if (error) {
    logger.error('compliance-documents', 'Failed to delete compliance document', error);
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Opens the camera or photo library (caller's choice), uploads the result
 * to the private bucket at `{organizationId}/{propertyId}/{uuid}.jpg`, and
 * records the path on the given document row. Online-only, unlike
 * offline-photos.ts's capturePhotoOffline -- see this module's header
 * comment. Never throws on a denied permission or a cancelled picker,
 * same convention as capturePhotoOffline.
 */
export async function attachComplianceDocumentPhoto(
  organizationId: string,
  propertyId: string,
  documentId: string,
  source: 'camera' | 'library',
): Promise<{ error: string | null; canceled: boolean }> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      error:
        source === 'camera'
          ? 'Camera access is needed to take a photo. You can enable it in your device settings.'
          : 'Photo library access is needed to attach a photo. You can enable it in your device settings.',
      canceled: false,
    };
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsEditing: false });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { error: null, canceled: true };
  }

  try {
    const asset = result.assets[0];
    // fetch()/arrayBuffer(), not the File API -- asset.uri comes from
    // expo-image-picker, not a uri this app created itself, same
    // reasoning as capturePhotoOffline's identical read.
    const response = await fetch(asset.uri);
    const bytes = new Uint8Array(await response.arrayBuffer());

    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const storagePath = `${organizationId}/${propertyId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(COMPLIANCE_DOCUMENTS_BUCKET)
      .upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: false });

    if (uploadError) {
      logger.error('compliance-documents', 'Failed to upload document photo', uploadError);
      return {
        error: 'Could not upload the photo. Please check your connection and try again.',
        canceled: false,
      };
    }

    const { error: updateError } = await supabase
      .from('compliance_documents')
      .update({ storage_path: storagePath })
      .eq('id', documentId);

    if (updateError) {
      logger.error('compliance-documents', 'Failed to record uploaded photo path', updateError);
      return {
        error: 'Photo uploaded, but could not be linked to this document. Please try again.',
        canceled: false,
      };
    }

    return { error: null, canceled: false };
  } catch (err) {
    logger.error('compliance-documents', 'Unexpected error attaching document photo', err);
    return {
      error: 'Something went wrong attaching the photo. Please try again.',
      canceled: false,
    };
  }
}
