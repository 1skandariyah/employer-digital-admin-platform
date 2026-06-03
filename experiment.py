from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Iterable


TRANSPARENT = "transparent"
HIDDEN = "hidden"
STAGE_TRANSPARENT = "transparent"
STAGE_PRE = "pre"
STAGE_POST = "post"


@dataclass(frozen=True)
class FlowStep:
    kind: str
    stage: str | None = None
    candidate_id: int | None = None
    show_productivity: bool = False
    info_type: str | None = None
    order_index: int | None = None


def randomized_candidate_order(candidate_ids: Iterable[int], seed: int) -> list[int]:
    """Return a deterministic randomized order for a session."""
    ordered = list(candidate_ids)
    rng = random.Random(seed)
    rng.shuffle(ordered)
    return ordered


def build_flow(
    treatment_arm: str,
    candidate_order: list[int],
    reveal_type: str,
    post_candidate_order: list[int] | None = None,
) -> list[FlowStep]:
    """Build the screen sequence for a session.

    Hidden-arm sessions always repeat the exact same candidate IDs after reveal.
    The reveal type is metadata for exports and copy, but candidate visibility is
    governed by the treatment/stage rule here.
    """
    if treatment_arm == TRANSPARENT:
        info_type = reveal_type
        return [
            FlowStep(kind="transparent_intro"),
            FlowStep(
                kind="transparent_productivity_definition",
                stage=STAGE_TRANSPARENT,
                show_productivity=(info_type == "productivity"),
                info_type=info_type,
            ),
            *[
                FlowStep(
                    kind="candidate",
                    stage=STAGE_TRANSPARENT,
                    candidate_id=candidate_id,
                    show_productivity=(info_type == "productivity"),
                    info_type=info_type,
                    order_index=index,
                )
                for index, candidate_id in enumerate(candidate_order, start=1)
            ],
            FlowStep(kind="complete"),
        ]

    if treatment_arm == HIDDEN:
        info_type = reveal_type
        post_order = post_candidate_order or candidate_order
        return [
            FlowStep(kind="hidden_intro"),
            *[
                FlowStep(
                    kind="candidate",
                    stage=STAGE_PRE,
                    candidate_id=candidate_id,
                    show_productivity=False,
                    info_type=None,
                    order_index=index,
                )
                for index, candidate_id in enumerate(candidate_order, start=1)
            ],
            FlowStep(
                kind="hidden_reveal_productivity_definition",
                stage=STAGE_POST,
                show_productivity=(info_type == "productivity"),
                info_type=info_type,
            ),
            *[
                FlowStep(
                    kind="candidate",
                    stage=STAGE_POST,
                    candidate_id=candidate_id,
                    show_productivity=(info_type == "productivity"),
                    info_type=info_type,
                    order_index=index,
                )
                for index, candidate_id in enumerate(post_order, start=1)
            ],
            FlowStep(kind="complete"),
        ]

    raise ValueError(f"Unsupported treatment arm: {treatment_arm}")


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


def next_resume_step(flow: list[FlowStep], answered_keys: set[tuple[int, str]]) -> int:
    """Find the correct resume point while preserving required instruction screens."""
    if not answered_keys:
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
