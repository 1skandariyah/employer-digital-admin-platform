import unittest

from seed_data import REASON_OPTIONS


class ReasonOptionTests(unittest.TestCase):
    def test_hiring_reason_order(self):
        labels = [label for applies_to, label, _ in REASON_OPTIONS if applies_to == "yes"]

        self.assertEqual(
            labels,
            [
                "Pendidikan sesuai dengan posisi ini",
                "Pengalaman relevan mencukupi",
                "Keahlian sesuai dengan posisi ini",
                "Perkiraan produktivitas tinggi",
                "Kinerja tugas mengesankan",
                "Informasi Tambahan menunjukkan kecocokan yang baik",
                "Alasan lain (sebutkan)",
            ],
        )

    def test_not_hiring_reason_order(self):
        labels = [label for applies_to, label, _ in REASON_OPTIONS if applies_to == "no"]

        self.assertEqual(
            labels,
            [
                "Kandidat mungkin kurang memenuhi kualifikasi",
                "Kandidat mungkin terlalu tinggi kualifikasinya",
                "Pengalaman relevan kurang mencukupi",
                "Keahlian terlihat terlalu terbatas",
                "Perkiraan produktivitas terlalu rendah",
                "Kinerja tugas mengecewakan",
                "Informasi Tambahan menunjukkan kecocokan yang kurang baik",
                "Alasan lain (sebutkan)",
            ],
        )


if __name__ == "__main__":
    unittest.main()
