from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Iterable


HIDDEN = "hidden"
HIDDEN_PLACEBO = "hidden_placebo"
TRANSPARENT = "transparent"
TRANSPARENT_PLACEBO = "transparent_placebo"
HIDDEN_TREATMENTS = {HIDDEN, HIDDEN_PLACEBO}
TRANSPARENT_TREATMENTS = {TRANSPARENT, TRANSPARENT_PLACEBO}
TREATMENT_ARMS = HIDDEN_TREATMENTS | TRANSPARENT_TREATMENTS

STAGE_TRANSPARENT = "transparent"
STAGE_PRE = "pre"
STAGE_POST = "post"


@dataclass(frozen=True)
class FlowStep:
    kind: str
    stage: str | None = None
    candidate_id: int | None = None
    show_productivity: bool = False
    show_additional_information: bool = False
    order_index: int | None = None


def randomized_candidate_order(candidate_ids: Iterable[int], seed: int) -> list[int]:
    """Return a deterministic randomized order for a session."""
    ordered = list(candidate_ids)
    rng = random.Random(seed)
    rng.shuffle(ordered)
    return ordered


def is_hidden_treatment(treatment_arm: str) -> bool:
    return treatment_arm in HIDDEN_TREATMENTS


def visibility_for_stage(treatment_arm: str, stage: str) -> tuple[bool, bool]:
    """Return productivity and additional-information visibility for one response stage."""
    if treatment_arm == HIDDEN:
        if stage not in {STAGE_PRE, STAGE_POST}:
            raise ValueError(f"Unsupported hidden stage: {stage}")
        return (stage == STAGE_POST, False)
    if treatment_arm == HIDDEN_PLACEBO:
        if stage not in {STAGE_PRE, STAGE_POST}:
            raise ValueError(f"Unsupported hidden stage: {stage}")
        return (stage == STAGE_POST, True)
    if treatment_arm == TRANSPARENT:
        if stage != STAGE_TRANSPARENT:
            raise ValueError(f"Unsupported transparent stage: {stage}")
        return (True, False)
    if treatment_arm == TRANSPARENT_PLACEBO:
        if stage != STAGE_TRANSPARENT:
            raise ValueError(f"Unsupported transparent stage: {stage}")
        return (True, True)
    raise ValueError(f"Unsupported treatment arm: {treatment_arm}")


def build_flow(
    treatment_arm: str,
    candidate_order: list[int],
    post_candidate_order: list[int] | None = None,
) -> list[FlowStep]:
    """Build the V2 employer-screen sequence for one treatment assignment."""
    if treatment_arm not in TREATMENT_ARMS:
        raise ValueError(f"Unsupported treatment arm: {treatment_arm}")

    if treatment_arm in TRANSPARENT_TREATMENTS:
        show_productivity, show_additional_information = visibility_for_stage(
            treatment_arm, STAGE_TRANSPARENT
        )
        return [
            FlowStep(kind="transparent_intro"),
            FlowStep(kind="employer_characteristics"),
            FlowStep(kind="candidate_review_intro"),
            FlowStep(kind="transparent_productivity_definition", stage=STAGE_TRANSPARENT),
            FlowStep(kind="transparent_productivity_reading", stage=STAGE_TRANSPARENT),
            *[
                FlowStep(
                    kind="candidate",
                    stage=STAGE_TRANSPARENT,
                    candidate_id=candidate_id,
                    show_productivity=show_productivity,
                    show_additional_information=show_additional_information,
                    order_index=index,
                )
                for index, candidate_id in enumerate(candidate_order, start=1)
            ],
            FlowStep(kind="complete"),
        ]

    post_order = post_candidate_order or candidate_order
    pre_productivity, pre_additional = visibility_for_stage(treatment_arm, STAGE_PRE)
    post_productivity, post_additional = visibility_for_stage(treatment_arm, STAGE_POST)
    return [
        FlowStep(kind="hidden_intro"),
        FlowStep(kind="employer_characteristics"),
        FlowStep(kind="candidate_review_intro"),
        *[
            FlowStep(
                kind="candidate",
                stage=STAGE_PRE,
                candidate_id=candidate_id,
                show_productivity=pre_productivity,
                show_additional_information=pre_additional,
                order_index=index,
            )
            for index, candidate_id in enumerate(candidate_order, start=1)
        ],
        FlowStep(kind="hidden_reveal_productivity_definition", stage=STAGE_POST),
        FlowStep(kind="hidden_reveal_productivity_reading", stage=STAGE_POST),
        *[
            FlowStep(
                kind="candidate",
                stage=STAGE_POST,
                candidate_id=candidate_id,
                show_productivity=post_productivity,
                show_additional_information=post_additional,
                order_index=index,
            )
            for index, candidate_id in enumerate(post_order, start=1)
        ],
        FlowStep(kind="complete"),
    ]


def next_unanswered_candidate_step(
    flow: list[FlowStep],
    answered_keys: set[tuple[int, str]],
) -> int:
    """Find the first candidate step without a saved response."""
    for index, step in enumerate(flow):
        if step.kind != "candidate" or step.candidate_id is None or step.stage is None:
            continue
        if (step.candidate_id, step.stage) not in answered_keys:
            return index
    return len(flow) - 1


def next_resume_step(
    flow: list[FlowStep],
    answered_keys: set[tuple[int, str]],
    characteristics_completed: bool = False,
) -> int:
    """Find the correct resume point while preserving required instruction screens."""
    characteristics_index = next(
        (index for index, step in enumerate(flow) if step.kind == "employer_characteristics"),
        None,
    )
    if not answered_keys:
        if characteristics_completed and characteristics_index is not None:
            return min(characteristics_index + 1, len(flow) - 1)
        return 0

    first_unanswered = next_unanswered_candidate_step(flow, answered_keys)
    if first_unanswered >= len(flow):
        return len(flow) - 1

    step = flow[first_unanswered]
    if step.stage == STAGE_POST:
        has_post_response = any(stage == STAGE_POST for _, stage in answered_keys)
        if not has_post_response:
            for index, flow_step in enumerate(flow):
                if flow_step.kind == "hidden_reveal_productivity_definition":
                    return index

    return first_unanswered
