import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app_core
import storage_runtime


class StorageRuntimeTests(unittest.TestCase):
    def test_cloud_paths_use_only_the_configured_runtime_root(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-runtime-") as tmp, mock.patch.dict(
            os.environ,
            {"K_SERVICE": "bidmanager", "BIDMANAGER_RUNTIME_DIR": tmp},
            clear=False,
        ):
            paths = app_core.load_app_paths_config()
            root = Path(tmp).resolve()
            for value in paths.values():
                self.assertTrue(Path(value).resolve() == root or root in Path(value).resolve().parents)

    def test_cloud_mode_requires_remote_document_storage(self):
        with mock.patch.dict(
            os.environ,
            {"K_SERVICE": "bidmanager", "GOOGLE_DRIVE_FOLDER_ID": ""},
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                storage_runtime.require_durable_cloud_storage()

    def test_oci_volume_is_accepted_and_never_cleaned_as_scratch(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-oci-volume-") as tmp, mock.patch.dict(
            os.environ,
            {
                "BIDMANAGER_ENV": "production",
                "BIDMANAGER_STORAGE_PROVIDER": "oci-block-volume",
                "BIDMANAGER_RUNTIME_DIR": tmp,
                "GOOGLE_DRIVE_FOLDER_ID": "",
            },
            clear=False,
        ):
            storage_runtime.require_durable_cloud_storage()
            child = Path(tmp) / "downloads" / "42"
            child.mkdir(parents=True)
            document = child / "tender.pdf"
            document.write_bytes(b"durable")
            storage_runtime.cleanup_scratch_folder(str(child))
            self.assertTrue(document.exists())

    def test_cloud_mode_refuses_ephemeral_sqlite_database(self):
        clean_env = {
            "K_SERVICE": "bidmanager",
            "DATABASE_URL": "",
            "POSTGRES_URL": "",
            "POSTGRES_CONNECTION_STRING": "",
        }
        with mock.patch.dict(os.environ, clean_env, clear=False):
            with self.assertRaises(RuntimeError):
                storage_runtime.require_durable_cloud_database()
        with mock.patch.dict(
            os.environ,
            {**clean_env, "DATABASE_URL": "postgresql://database.example/bidmanager"},
            clear=False,
        ):
            storage_runtime.require_durable_cloud_database()

    def test_drive_adapter_returns_durable_reference_and_cleanup_instruction(self):
        adapter = storage_runtime.DriveDocumentStorage()
        with mock.patch.object(
            storage_runtime.drive_storage, "upload_file", return_value="gdrive://file-id"
        ) as upload:
            stored = adapter.persist("scratch/spec.pdf", "42", "notice", "tenders/")
        self.assertEqual(stored.reference, "gdrive://file-id")
        self.assertTrue(stored.remove_local_copy)
        upload.assert_called_once_with(
            "scratch/spec.pdf", tender_id="42", file_type="notice", prefix="tenders/"
        )

    def test_scratch_cleanup_cannot_remove_the_runtime_root(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-cleanup-") as tmp, mock.patch.dict(
            os.environ,
            {"K_SERVICE": "bidmanager", "BIDMANAGER_RUNTIME_DIR": tmp},
            clear=False,
        ):
            child = Path(tmp) / "downloads" / "42"
            child.mkdir(parents=True)
            (child / "temporary.pdf").write_bytes(b"temporary")
            storage_runtime.cleanup_scratch_folder(str(child))
            self.assertFalse(child.exists())
            storage_runtime.cleanup_scratch_folder(tmp)
            self.assertTrue(Path(tmp).exists())


if __name__ == "__main__":
    unittest.main()
