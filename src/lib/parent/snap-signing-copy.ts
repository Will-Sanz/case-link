import { PDFName } from "pdf-lib";
import { prepareSnapApplicationPages, type SnapApplicationPageReadiness } from "./snap-draft";

export const SNAP_SIGNING_COPY_ERROR = "The SNAP signing copy could not be created from the supplied information.";
export type SnapSigningCopyReadiness = SnapApplicationPageReadiness & {
  kind: "unsigned_nonprotected_official_signing_copy";
};

/** Official-size copy for personal completion; it is not a final packet or delivery permission. */
export async function renderSnapSigningCopy(template: Uint8Array, input: unknown, now: Date): Promise<{bytes:Uint8Array|null;readiness:SnapSigningCopyReadiness}> {
  try {
    const {document,readiness:assessment}=await prepareSnapApplicationPages(template,input,now);
    const readiness: SnapSigningCopyReadiness={...assessment,kind:'unsigned_nonprotected_official_signing_copy'};
    if(!document||!readiness.nonProtectedDataReadyForReview)return {bytes:null,readiness};
    document.setTitle('SNAP official signing copy - protected fields blank - not submission-ready - not sent');
    document.setSubject('Signing copy only. Required identifiers and personal certification signatures/dates remain blank. Not a final application packet or submission confirmation.');
    document.setKeywords([readiness.kind,readiness.source.templateId]);
    document.setCreationDate(now);document.setModificationDate(now);
    // The validated static source has no fields; pdf-lib inspection creates an empty form tree.
    document.catalog.delete(PDFName.of('AcroForm'));
    return {bytes:await document.save(),readiness};
  }catch{throw new Error(SNAP_SIGNING_COPY_ERROR);}
}
