import unittest

from server import normalize_session_code, validate_custom_session_code


class SessionCodeTests(unittest.TestCase):
    def test_session_code_is_trimmed_and_accepts_simple_labels(self):
        self.assertEqual(normalize_session_code(" PILOT-A1 "), "PILOT-A1")
        self.assertEqual(normalize_session_code("GROUP_03"), "GROUP_03")

    def test_session_code_rejects_spaces_and_symbols(self):
        with self.assertRaisesRegex(ValueError, "letters, numbers"):
            normalize_session_code("PILOT A1")

        with self.assertRaisesRegex(ValueError, "letters, numbers"):
            normalize_session_code("PILOT/A1")

    def test_custom_session_code_cannot_be_only_numeric(self):
        with self.assertRaisesRegex(ValueError, "must include"):
            validate_custom_session_code("13")


if __name__ == "__main__":
    unittest.main()
