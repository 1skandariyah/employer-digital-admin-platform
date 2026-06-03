import json
import unittest

from server import candidate_row_to_payload


class CandidateImportTests(unittest.TestCase):
    def test_candidate_csv_row_converts_to_json_payloads(self):
        row = {
            "code": "C-900",
            "pseudonym": "Candidate Z",
            "gender": "Female",
            "date_of_birth": "2002-01-15",
            "current_address": "Jakarta",
            "education": "Diploma, design",
            "relevant_experience": "1 year 3 months",
            "skills": "Canva, scheduling",
            "reach_indicator": "Median reach",
            "interaction_indicator": "Above median interaction",
            "benchmark": "Talent-pool median score: 50",
            "hobby": "Photography",
        }

        code, pseudonym, baseline_json, productivity_json, placebo_json = candidate_row_to_payload(row)
        baseline = json.loads(baseline_json)
        productivity = json.loads(productivity_json)
        placebo = json.loads(placebo_json)

        self.assertEqual(code, "C-900")
        self.assertEqual(pseudonym, "Candidate Z")
        self.assertIn("gpa", baseline)
        self.assertNotIn("place_of_birth", baseline)
        self.assertEqual(productivity["reach_indicator"], "Median reach")
        self.assertEqual(placebo["hobby"], "Photography")


if __name__ == "__main__":
    unittest.main()
