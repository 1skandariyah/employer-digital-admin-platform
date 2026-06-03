import unittest
from datetime import date

from server import age_from_date_of_birth, baseline_for_display


class ProfileFieldTests(unittest.TestCase):
    def test_age_is_displayed_without_date_of_birth(self):
        baseline = {
            "gender": "Female",
            "date_of_birth": "2002-04-12",
            "place_of_birth": "Bandung",
            "current_address": "Bandung",
            "education": "Vocational high school, multimedia major",
            "relevant_experience": "0 years 6 months",
            "skills": "Canva",
        }

        display = baseline_for_display("C-101", baseline)
        keys = list(display.keys())

        self.assertEqual(age_from_date_of_birth("2002-04-12", date(2026, 5, 25)), "24 years 1 months")
        self.assertNotIn("date_of_birth", display)
        self.assertIn("age", display)
        self.assertNotIn("place_of_birth", display)

    def test_score_field_is_combined_with_education(self):
        high_school = baseline_for_display(
            "C-101",
            {
                "date_of_birth": "2002-04-12",
                "education": "Vocational high school, multimedia major",
            },
        )
        diploma = baseline_for_display(
            "C-102",
            {
                "date_of_birth": "2001-09-03",
                "education": "Diploma, information systems",
            },
        )

        self.assertNotIn("average_score", high_school)
        self.assertIn("average score = 67.7", high_school["education"])
        self.assertNotIn("gpa", diploma)
        self.assertIn("GPA = 2.24", diploma["education"])


if __name__ == "__main__":
    unittest.main()
