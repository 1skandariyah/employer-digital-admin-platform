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
        self.assertNotIn("current_address", display)

    def test_score_fields_are_not_shown_in_profile(self):
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
        self.assertEqual(high_school["education_level"], "Vocational high school")
        self.assertEqual(high_school["education_major"], "multimedia major")
        self.assertNotIn("gpa", diploma)
        self.assertEqual(diploma["education_level"], "Diploma")
        self.assertEqual(diploma["education_major"], "information systems")


if __name__ == "__main__":
    unittest.main()
