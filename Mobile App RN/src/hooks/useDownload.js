import { useState, useCallback } from "react";
import {
  downloadDocument as doDownloadDocument,
  requestTenderDownload as doRequestTenderDownload,
  useDocumentsForTender,
} from "../lib/documents.js";

export function useDocumentDownload(onError) {
  const [pendingId, setPendingId] = useState(null);
  // `tender` is the live tender the server document list came from.
  const download = useCallback(async (tender, doc) => {
    setPendingId(doc.id);
    try {
      await doDownloadDocument({
        id: doc.id, tender_db_id: tender.id, tender_id: tender.tender_id, file_name: doc.name,
      });
    } catch (e) {
      onError?.(e);
    } finally {
      setPendingId(null);
    }
  }, [onError]);
  return { download, pendingId };
}

export function useRequestDownload(tender) {
  const rows = useDocumentsForTender(tender);
  const placeholder = rows.find((r) => r.id === -Number(tender.id)) || null;
  const [starting, setStarting] = useState(false);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      await doRequestTenderDownload(tender);
    } finally {
      setStarting(false);
    }
  }, [tender]);

  return {
    start,
    starting,
    status: placeholder?.client_status || null,
    error: placeholder?.error || null,
  };
}
