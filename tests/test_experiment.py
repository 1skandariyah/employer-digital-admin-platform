import unittest

from experiment import (
    build_flow,
    next_resume_step,
    randomized_candidate_order,
    visibility_for_stage,
)


class ExperimentFlowTests(unittest.TestCase):
    def test_randomized_order_is_reproducible(self):
        candidates = [1, 2, 3, 4, 5]

        first = randomized_candidate_order(candidates, seed=12345)
        second = randomized_candidate_order(candidates, seed=12345)

        self.assertEqual(first, second)
        self.assertCountEqual(first, candidates)

    def test_transparent_shows_productivity_in_one_review(self):
        flow = build_flow("transparent", [10, 11])
        candidates = [step for step in flow if step.kind == "candidate"]

        self.assertEqual([step.kind for step in flow[:5]], [
            "transparent_intro",
            "employer_characteristics",
            "candidate_review_intro",
            "transparent_productivity_definition",
            "transparent_productivity_reading",
        ])
        self.assertEqual([step.candidate_id for step in candidates], [10, 11])
        self.assertTrue(all(step.stage == "transparent" for step in candidates))
        self.assertTrue(all(step.show_productivity for step in candidates))
        self.assertTrue(all(not step.show_additional_information for step in candidates))

    def test_transparent_placebo_shows_both_information_blocks(self):
        flow = build_flow("transparent_placebo", [10, 11])
        candidates = [step for step in flow if step.kind == "candidate"]

        self.assertTrue(all(step.show_productivity for step in candidates))
        self.assertTrue(all(step.show_additional_information for step in candidates))
        self.assertEqual(len(candidates), 2)

    def test_hidden_reuses_ids_and_adds_productivity_only_in_post_review(self):
        flow = build_flow("hidden", [10, 11, 12], [12, 10, 11])
        candidates = [step for step in flow if step.kind == "candidate"]
        pre = [step for step in candidates if step.stage == "pre"]
        post = [step for step in candidates if step.stage == "post"]

        self.assertEqual([step.candidate_id for step in pre], [10, 11, 12])
        self.assertEqual([step.candidate_id for step in post], [12, 10, 11])
        self.assertCountEqual(
            [step.candidate_id for step in pre],
            [step.candidate_id for step in post],
        )
        self.assertTrue(all(not step.show_productivity for step in pre))
        self.assertTrue(all(not step.show_additional_information for step in pre))
        self.assertTrue(all(step.show_productivity for step in post))
        self.assertTrue(all(not step.show_additional_information for step in post))
        self.assertIn(
            "hidden_reveal_productivity_definition", [step.kind for step in flow]
        )
        self.assertIn("hidden_reveal_productivity_reading", [step.kind for step in flow])

    def test_hidden_placebo_keeps_additional_information_and_adds_productivity(self):
        flow = build_flow("hidden_placebo", [10, 11], [11, 10])
        candidates = [step for step in flow if step.kind == "candidate"]
        pre = [step for step in candidates if step.stage == "pre"]
        post = [step for step in candidates if step.stage == "post"]

        self.assertTrue(all(not step.show_productivity for step in pre))
        self.assertTrue(all(step.show_additional_information for step in pre))
        self.assertTrue(all(step.show_productivity for step in post))
        self.assertTrue(all(step.show_additional_information for step in post))
        self.assertEqual([step.candidate_id for step in post], [11, 10])

    def test_visibility_mapping_is_explicit(self):
        self.assertEqual(visibility_for_stage("hidden", "pre"), (False, False))
        self.assertEqual(visibility_for_stage("hidden", "post"), (True, False))
        self.assertEqual(visibility_for_stage("hidden_placebo", "pre"), (False, True))
        self.assertEqual(visibility_for_stage("hidden_placebo", "post"), (True, True))
        self.assertEqual(visibility_for_stage("transparent", "transparent"), (True, False))
        self.assertEqual(
            visibility_for_stage("transparent_placebo", "transparent"), (True, True)
        )

    def test_visibility_mapping_rejects_a_stage_from_the_wrong_design(self):
        with self.assertRaises(ValueError):
            visibility_for_stage("hidden", "transparent")
        with self.assertRaises(ValueError):
            visibility_for_stage("transparent", "pre")

    def test_hidden_resume_preserves_productivity_instruction_page(self):
        flow = build_flow("hidden_placebo", [10, 11], [11, 10])

        resume_index = next_resume_step(flow, {(10, "pre"), (11, "pre")})

        self.assertEqual(
            flow[resume_index].kind, "hidden_reveal_productivity_definition"
        )

    def test_empty_session_resumes_at_intro(self):
        flow = build_flow("transparent", [10, 11])

        self.assertEqual(next_resume_step(flow, set()), 0)

    def test_completed_characteristics_resumes_at_candidate_review_intro(self):
        transparent = build_flow("transparent", [10, 11])
        hidden = build_flow("hidden", [10, 11])

        self.assertEqual(
            transparent[next_resume_step(transparent, set(), characteristics_completed=True)].kind,
            "candidate_review_intro",
        )
        self.assertEqual(
            hidden[next_resume_step(hidden, set(), characteristics_completed=True)].kind,
            "candidate_review_intro",
        )


if __name__ == "__main__":
    unittest.main()
