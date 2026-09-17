import os
import unittest
from unittest import mock

import drive_storage


class _Request:
    def __init__(self, payload):
        self.payload = payload

    def execute(self):
        return self.payload


class _Files:
    def __init__(self, handler):
        self.handler = handler
        self.calls = []

    def list(self, **kwargs):
        self.calls.append(kwargs)
        return _Request(self.handler(kwargs))


class _Service:
    def __init__(self, handler):
        self.files_api = _Files(handler)

    def files(self):
        return self.files_api


class DriveStorageTests(unittest.TestCase):
    def test_paths_are_normalized_and_traversal_is_rejected(self):
        self.assertEqual(drive_storage.normalize_relative_path("/tenders\\42//docs/"), "tenders/42/docs")
        with self.assertRaises(ValueError):
            drive_storage.normalize_relative_path("tenders/../private")
        with mock.patch.dict(os.environ, {"GOOGLE_DRIVE_FOLDER_ID": "root"}, clear=False):
            self.assertIsNone(drive_storage.resolve_path("", require_folder=False))

    def test_list_files_follows_every_drive_page(self):
        def handler(kwargs):
            if not kwargs.get("pageToken"):
                return {"files": [{"id": "1", "name": "a"}], "nextPageToken": "page-2"}
            return {"files": [{"id": "2", "name": "b"}]}

        service = _Service(handler)
        with mock.patch.object(drive_storage, "_drive_service", return_value=service):
            items = drive_storage._list_files("root")
        self.assertEqual([item["id"] for item in items], ["1", "2"])
        self.assertEqual(len(service.files_api.calls), 2)
        self.assertEqual(service.files_api.calls[1]["pageToken"], "page-2")
        self.assertTrue(service.files_api.calls[0]["supportsAllDrives"])

    def test_nested_path_resolution_uses_each_parent_folder(self):
        folder_mime = drive_storage.DRIVE_FOLDER_MIME

        def handler(kwargs):
            query = kwargs["q"]
            if "'root' in parents" in query and "name='tenders'" in query:
                return {"files": [{"id": "folder-a", "name": "tenders", "mimeType": folder_mime}]}
            if "'folder-a' in parents" in query and "name='42'" in query:
                return {"files": [{"id": "folder-b", "name": "42", "mimeType": folder_mime}]}
            if "'folder-b' in parents" in query and "name='spec.pdf'" in query:
                return {"files": [{"id": "file-c", "name": "spec.pdf", "mimeType": "application/pdf"}]}
            return {"files": []}

        service = _Service(handler)
        with mock.patch.dict(os.environ, {"GOOGLE_DRIVE_FOLDER_ID": "root"}, clear=False), mock.patch.object(
            drive_storage, "_drive_service", return_value=service
        ):
            item = drive_storage.resolve_path("tenders/42/spec.pdf", require_folder=False)
        self.assertEqual(item["id"], "file-c")
        queries = [call["q"] for call in service.files_api.calls]
        self.assertTrue(any("'folder-a' in parents" in query for query in queries))
        self.assertTrue(any("'folder-b' in parents" in query for query in queries))

    def test_duplicate_names_are_rejected_as_ambiguous(self):
        service = _Service(
            lambda _kwargs: {
                "files": [
                    {"id": "one", "name": "same", "mimeType": "application/pdf"},
                    {"id": "two", "name": "same", "mimeType": "application/pdf"},
                ]
            }
        )
        with mock.patch.object(drive_storage, "_drive_service", return_value=service):
            with self.assertRaises(ValueError):
                drive_storage._find_child("root", "same", file_only=True)


if __name__ == "__main__":
    unittest.main()
