import unittest

from server import validate_employer_characteristics


def valid_payload():
    return {
        "gender": "male",
        "birthMonth": "6",
        "birthYear": "1988",
        "education": "bachelor",
        "businessRole": "owner",
        "businessSector": "wholesale_retail",
        "establishedYear": "2018",
        "workers": "5_19",
        "annualRevenue": "300m_to_2_5b",
        "city": "Surabaya",
        "province": "East Java",
        "activeSocialMedia": "yes",
        "platforms": ["instagram", "whatsapp_business"],
        "previousDigitalHiring": "no",
        "workArrangement": "freelancer",
        "matchingBenefitImportance": "5",
    }


class EmployerCharacteristicsValidationTests(unittest.TestCase):
    def test_valid_payload_is_normalized_for_storage(self):
        result = validate_employer_characteristics(valid_payload())

        self.assertEqual(result["birth_month"], 6)
        self.assertEqual(result["established_year"], 2018)
        self.assertEqual(result["platforms"], ["instagram", "whatsapp_business"])
        self.assertEqual(result["matching_benefit_importance"], 5)

    def test_active_social_media_requires_a_platform(self):
        payload = valid_payload()
        payload["platforms"] = []

        with self.assertRaisesRegex(ValueError, "at least one platform"):
            validate_employer_characteristics(payload)

    def test_other_choice_requires_description(self):
        payload = valid_payload()
        payload["businessRole"] = "other"

        with self.assertRaisesRegex(ValueError, "businessRoleOther"):
            validate_employer_characteristics(payload)

    def test_rejects_future_or_implausibly_old_years(self):
        future_birth_year = valid_payload()
        future_birth_year["birthYear"] = "2026"
        with self.assertRaisesRegex(ValueError, "Birth year"):
            validate_employer_characteristics(future_birth_year)

        old_business_year = valid_payload()
        old_business_year["establishedYear"] = "1899"
        with self.assertRaisesRegex(ValueError, "Business establishment year"):
            validate_employer_characteristics(old_business_year)


if __name__ == "__main__":
    unittest.main()
