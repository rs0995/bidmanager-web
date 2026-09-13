import { useState, useCallback } from "react";
import {
  downloadDocument as doDownloadDocument,
  requestTenderDownload as doRequestTenderDownload,
  useDocumentsForTender,
} from "../lib/documents.js";

export function useDocumentDownload(onError) {
  const [pendingId, setPendingId] = useState(null);
  const download = useCallback(async (tenderId, doc) => {
    setPendingId(doc.id);
    try {
      await doDownloadDocument({
        id: doc.id, tender_db_id: tenderId, tender_id: doc.tender_id, file_name: doc.name,
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
  const rows = useDocumentsForTender(tender.id);
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
