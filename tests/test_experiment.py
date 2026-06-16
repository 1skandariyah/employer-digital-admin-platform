import unittest

from experiment import build_flow, next_resume_step, randomized_candidate_order


class ExperimentFlowTests(unittest.TestCase):
    def test_randomized_order_is_reproducible(self):
        candidates = [1, 2, 3, 4, 5]

        first = randomized_candidate_order(candidates, seed=12345)
        second = randomized_candidate_order(candidates, seed=12345)

        self.assertEqual(first, second)
        self.assertCountEqual(first, candidates)

    def test_transparent_flow_shows_productivity_once(self):
        flow = build_flow("transparent", [10, 11], "productivity")
        candidate_steps = [step for step in flow if step.kind == "candidate"]

        self.assertEqual(flow[0].kind, "transparent_intro")
        self.assertEqual(flow[1].kind, "employer_characteristics")
        self.assertEqual(flow[2].kind, "transparent_productivity_definition")
        self.assertEqual([step.candidate_id for step in candidate_steps], [10, 11])
        self.assertEqual({step.stage for step in candidate_steps}, {"transparent"})
        self.assertTrue(all(step.show_productivity for step in candidate_steps))
        self.assertEqual({step.info_type for step in candidate_steps}, {"productivity"})

    def test_hidden_flow_reuses_same_ids_with_separate_post_order(self):
        flow = build_flow("hidden", [10, 11, 12], "productivity", [12, 10, 11])
        candidate_steps = [step for step in flow if step.kind == "candidate"]
        pre = [step for step in candidate_steps if step.stage == "pre"]
        post = [step for step in candidate_steps if step.stage == "post"]

        self.assertEqual(flow[0].kind, "hidden_intro")
        self.assertEqual(flow[1].kind, "employer_characteristics")
        self.assertEqual(flow[5].kind, "hidden_reveal_productivity_definition")
        self.assertEqual([step.candidate_id for step in pre], [10, 11, 12])
        self.assertEqual([step.candidate_id for step in post], [12, 10, 11])
        self.assertCountEqual([step.candidate_id for step in pre], [step.candidate_id for step in post])
        self.assertTrue(all(not step.show_productivity for step in pre))
        self.assertTrue(all(step.show_productivity for step in post))
        self.assertEqual({step.info_type for step in post}, {"productivity"})

    def test_hidden_placebo_repeats_without_productivity_visibility(self):
        flow = build_flow("hidden", [10, 11], "placebo", [11, 10])
        post = [step for step in flow if step.kind == "candidate" and step.stage == "post"]

        self.assertEqual([step.candidate_id for step in post], [11, 10])
        self.assertTrue(all(not step.show_productivity for step in post))
        self.assertEqual({step.info_type for step in post}, {"placebo"})

    def test_transparent_placebo_shows_placebo_not_productivity(self):
        flow = build_flow("transparent", [10, 11], "placebo")
        candidate_steps = [step for step in flow if step.kind == "candidate"]

        self.assertTrue(all(not step.show_productivity for step in candidate_steps))
        self.assertEqual({step.info_type for step in candidate_steps}, {"placebo"})

    def test_hidden_resume_preserves_reveal_instruction_page(self):
        flow = build_flow("hidden", [10, 11], "productivity")

        resume_index = next_resume_step(flow, {(10, "pre"), (11, "pre")})

        self.assertEqual(flow[resume_index].kind, "hidden_reveal_productivity_definition")

    def test_empty_session_resumes_at_intro(self):
        flow = build_flow("transparent", [10, 11], "productivity")

        self.assertEqual(next_resume_step(flow, set()), 0)

    def test_completed_characteristics_resumes_at_next_step(self):
        transparent = build_flow("transparent", [10, 11], "productivity")
        hidden = build_flow("hidden", [10, 11], "productivity")

        transparent_index = next_resume_step(
            transparent, set(), characteristics_completed=True
        )
        hidden_index = next_resume_step(hidden, set(), characteristics_completed=True)

        self.assertEqual(
            transparent[transparent_index].kind,
            "transparent_productivity_definition",
        )
        self.assertEqual(hidden[hidden_index].kind, "candidate")
        self.assertEqual(hidden[hidden_index].stage, "pre")


if __name__ == "__main__":
    unittest.main()
