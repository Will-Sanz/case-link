import type {
  PdfFieldDescriptor,
  PdfFieldMapping,
  PdfOverlayField,
} from "@/types/paperwork";

const DATABASE_NAME = "caselink-paperwork-drafts";
const DATABASE_VERSION = 1;
const DRAFT_STORE = "drafts";
const FILE_STORE = "blank-files";

export type LocalPaperworkDraft = {
  v: 1;
  familyId: string;
  planId: string;
  reviewedAt: string;
  paperworkMode: "fillable" | "scanned";
  fields: PdfFieldDescriptor[];
  overlayFields: PdfOverlayField[];
  mappings: PdfFieldMapping[];
  documentTitle: string;
  warnings: string[];
  assistedByAi: boolean;
  updatedAt: string;
};

type LocalBlankFile = {
  familyId: string;
  bytes: ArrayBuffer;
  updatedAt: string;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Browser draft storage is unavailable"));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: "familyId" });
      }
      if (!database.objectStoreNames.contains(FILE_STORE)) {
        database.createObjectStore(FILE_STORE, { keyPath: "familyId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open browser draft storage"));
    };
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser draft request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Browser draft save failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Browser draft save stopped"));
  });
}

export async function saveLocalPaperworkBlank(
  familyId: string,
  bytes: Uint8Array,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(FILE_STORE, "readwrite");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  transaction.objectStore(FILE_STORE).put({
    familyId,
    bytes: copy.buffer,
    updatedAt: new Date().toISOString(),
  } satisfies LocalBlankFile);
  await transactionComplete(transaction);
}

export async function saveLocalPaperworkDraft(
  draft: LocalPaperworkDraft,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(DRAFT_STORE, "readwrite");
  transaction.objectStore(DRAFT_STORE).put(draft);
  await transactionComplete(transaction);
}

export async function loadLocalPaperworkDraft(familyId: string): Promise<{
  draft: LocalPaperworkDraft | null;
  bytes: Uint8Array | null;
}> {
  const database = await openDatabase();
  const transaction = database.transaction([DRAFT_STORE, FILE_STORE], "readonly");
  const draftRequest = transaction.objectStore(DRAFT_STORE).get(familyId);
  const fileRequest = transaction.objectStore(FILE_STORE).get(familyId);
  const [draft, file] = await Promise.all([
    requestResult(draftRequest) as Promise<LocalPaperworkDraft | undefined>,
    requestResult(fileRequest) as Promise<LocalBlankFile | undefined>,
  ]);
  return {
    draft: draft?.v === 1 ? draft : null,
    bytes: file?.bytes ? new Uint8Array(file.bytes) : null,
  };
}

export async function deleteLocalPaperworkDraft(familyId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([DRAFT_STORE, FILE_STORE], "readwrite");
  transaction.objectStore(DRAFT_STORE).delete(familyId);
  transaction.objectStore(FILE_STORE).delete(familyId);
  await transactionComplete(transaction);
}
