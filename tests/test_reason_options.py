import unittest

from seed_data import REASON_OPTIONS


class ReasonOptionTests(unittest.TestCase):
    def test_hiring_reason_order(self):
        labels = [label for applies_to, label, _ in REASON_OPTIONS if applies_to == "yes"]

        self.assertEqual(
            labels,
            [
                "Education fits the role",
                "Relevant experience is sufficient",
                "Skills are suitable for the role",
                "Expected productivity is high",
                "Task performance is impressive",
                "Additional Information suggests good fit",
                "Other reason (please specify)",
            ],
        )

    def test_not_hiring_reason_order(self):
        labels = [label for applies_to, label, _ in REASON_OPTIONS if applies_to == "no"]

        self.assertEqual(
            labels,
            [
                "Education does not fit the role",
                "Candidate may be overqualified for this role",
                "Insufficient relevant experience",
                "Skills look too limited",
                "Expected productivity is too low",
                "Task performance is disappointing",
                "Additional Information suggests poor fit",
                "Other reason (please specify)",
            ],
        )


if __name__ == "__main__":
    unittest.main()
