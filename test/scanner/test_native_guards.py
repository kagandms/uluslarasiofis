"""Verify native acceptance tools cannot silently operate against remote authority."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch


def import_harness(filename: str) -> ModuleType:
    """Load a hyphenated acceptance module for tests without invoking its entry point."""
    module_name = filename.replace('-', '_').replace('.', '_')
    specification = importlib.util.spec_from_file_location(module_name, Path(__file__).with_name(filename))
    if specification is None or specification.loader is None:
        raise RuntimeError('harness_import_failed')
    module = importlib.util.module_from_spec(specification)
    sys.modules[module_name] = module
    specification.loader.exec_module(module)
    return module


ACCEPTANCE = import_harness('native-acceptance.py')
PREPARATION = import_harness('prepare-native-proof.py')


class NativeAuthorityTests(unittest.TestCase):
    """Reject remote authority before network/CLI calls or synthetic credential writes."""

    def test_acceptance_rejects_remote_and_plaintext_origins(self) -> None:
        for origin in ('https://remote.example.invalid', 'http://127.0.0.1:8799',
                       'https://127.0.0.1:8799/path', 'https://user@127.0.0.1:8799'):
            with self.subTest(origin=origin), patch.dict(os.environ, {'NATIVE_ORIGIN': origin}, clear=True):
                with self.assertRaisesRegex(ValueError, 'local_https_origin_required'):
                    ACCEPTANCE.load_settings()

    def test_acceptance_rejects_remote_bindings_before_loading_private_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            configuration = Path(directory) / 'wrangler.json'
            configuration.write_text(json.dumps({'vars': {'APP_ENV': 'local'},
                'd1_databases': [{'remote': True}], 'r2_buckets': []}))

            with patch.dict(os.environ, {'NATIVE_ORIGIN': 'https://127.0.0.1:8799',
                'NATIVE_CONFIG': str(configuration)}, clear=True):
                with self.assertRaisesRegex(ValueError, 'remote_binding_rejected'):
                    ACCEPTANCE.load_settings()

    def test_preparation_rejects_remote_binding_before_writing_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            output = repository / 'proof'
            output.mkdir()
            (repository / 'wrangler.jsonc').write_text(json.dumps({'env': {},
                'd1_databases': [{'remote': False}], 'r2_buckets': [{'remote': True}]}))

            with self.assertRaisesRegex(ValueError, 'remote_binding_rejected'):
                PREPARATION.write_configuration(repository, output)

            self.assertEqual(list(output.iterdir()), [])
