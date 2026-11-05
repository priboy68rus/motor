import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "next_patch_version.py"
SPEC = importlib.util.spec_from_file_location("next_patch_version", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
next_patch_version = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(next_patch_version)


class ReleaseVersionTests(unittest.TestCase):
    def test_current_release_is_incremented(self):
        self.assertEqual(
            next_patch_version.choose_release_version(
                ["v0.1.0", "v0.1.1"], [], "0.1.1"
            ),
            ("0.1.2", "v0.1.2"),
        )

    def test_highest_semantic_version_is_incremented(self):
        self.assertEqual(
            next_patch_version.choose_release_version(
                ["v0.9.8", "v0.10.3", "not-a-release"], [], "0.1.1"
            ),
            ("0.10.4", "v0.10.4"),
        )

    def test_existing_head_tag_is_reused_on_retry(self):
        self.assertEqual(
            next_patch_version.choose_release_version(
                ["v1.4.7", "v1.4.8"], ["v1.4.7"], "0.1.1"
            ),
            ("1.4.7", "v1.4.7"),
        )

    def test_non_canonical_tags_are_ignored(self):
        self.assertEqual(
            next_patch_version.choose_release_version(
                ["1.2.3", "v1.2", "v1.2.3rc1"], [], "0.1.1"
            ),
            ("0.1.2", "v0.1.2"),
        )

    def test_invalid_fallback_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "X.Y.Z"):
            next_patch_version.choose_release_version([], [], "0.1")


if __name__ == "__main__":
    unittest.main()
