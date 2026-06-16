from __future__ import annotations

import csv
import io
import json
import math
import os
import random
import sqlite3
import time
from datetime import date, datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from experiment import build_flow, next_resume_step, randomized_candidate_order
from seed_data import (
    ADDITIONAL_INFORMATION_BY_CODE,
    PRODUCTIVITY_BY_CODE,
    REASON_OPTIONS,
    seed_database,
)


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "experiment.db"
STATIC_DIR = BASE_DIR / "static"


def years_months_between(start: date, end: date) -> tuple[int, int]:
    years = end.year - start.year
    months = end.month - start.month
    if end.day < start.day:
        months -= 1
    if months < 0:
        years -= 1
        months += 12
    return years, months


def age_from_date_of_birth(date_of_birth: str, as_of: date | None = None) -> str:
    as_of = as_of or date.today()
    born = datetime.strptime(date_of_birth, "%Y-%m-%d").date()
    years, months = years_months_between(born, as_of)
    return f"{years} years {months} months"


def deterministic_left_skewed_value(
    key: str,
    low: float,
    high: float,
    target_median: float,
    decimals: int,
) -> float:
    """Return a reproducible bounded value concentrated near the high end.

    The value is generated as high minus an exponential lower-tail draw. This
    creates a negatively skewed distribution: most mass is near the high end,
    with a tail toward lower values. The rate is calibrated so the median is
    approximately the requested target median.
    """
    seed = sum((idx + 1) * ord(char) for idx, char in enumerate(key))
    rng = random.Random(seed)
    if not low < target_median < high:
        raise ValueError("Target median must be between low and high")
    rate = math.log(2) / (high - target_median)
    lower_tail = -math.log(1 - rng.random()) / rate
    value = max(low, min(high, high - lower_tail))
    return round(value, decimals)


def score_field_for_education(code: str, education: str) -> tuple[str, float]:
    education_lower = education.lower()
    if "diploma" in education_lower or "bachelor" in education_lower:
        return "gpa", deterministic_left_skewed_value(f"{code}:gpa", 0, 4, 3.0, 2)
    return "average_score", deterministic_left_skewed_value(f"{code}:average_score", 0, 100, 75, 1)


def randomized_distinct_candidate_order(candidate_ids: list[int], seed: int, previous_order: list[int]) -> list[int]:
    """Return a reproducible randomized order that differs from the previous order when possible."""
    order = randomized_candidate_order(candidate_ids, seed)
    if len(order) > 1 and order == previous_order:
        order = order[1:] + order[:1]
    return order


def normalize_baseline(code: str, baseline: dict) -> dict:
    baseline.pop("place_of_birth", None)
    baseline.pop("experience", None)

    education = baseline.get("education", "")
    score_key, score_value = score_field_for_education(code, education)
    baseline.pop("average_score", None)
    baseline.pop("gpa", None)
    baseline[score_key] = score_value

    ordered = {}
    for key in [
        "gender",
        "date_of_birth",
        "current_address",
        "education",
        score_key,
        "relevant_experience",
        "skills",
    ]:
        if key in baseline:
            ordered[key] = baseline[key]
    return ordered


def baseline_for_display(code: str, baseline: dict) -> dict:
    normalized = normalize_baseline(code, dict(baseline))
    display = {}

    for key, value in normalized.items():
        if key == "date_of_birth":
            display["age"] = age_from_date_of_birth(str(value))
            continue
        if key in {"current_address", "average_score", "gpa"}:
            continue
        display[key] = value
    return display


def parse_csv_body(handler: SimpleHTTPRequestHandler) -> list[dict]:
    raw = handler.rfile.read(int(handler.headers.get("Content-Length", "0"))).decode("utf-8-sig")
    if not raw.strip():
        raise ValueError("CSV upload is empty")
    return list(csv.DictReader(io.StringIO(raw)))


def candidate_row_to_payload(row: dict) -> tuple[str, str, str, str, str]:
    code = (row.get("code") or "").strip()
    pseudonym = (row.get("pseudonym") or "").strip()
    if not code or not pseudonym:
        raise ValueError("Each candidate row must include code and pseudonym")

    baseline = {
        "gender": (row.get("gender") or "").strip(),
        "date_of_birth": (row.get("date_of_birth") or "").strip(),
        "current_address": (row.get("current_address") or "").strip(),
        "education": (row.get("education") or "").strip(),
        "relevant_experience": (row.get("relevant_experience") or "").strip(),
        "skills": (row.get("skills") or "").strip(),
    }
    if row.get("average_score"):
        baseline["average_score"] = float(row["average_score"])
    if row.get("gpa"):
        baseline["gpa"] = float(row["gpa"])
    baseline = normalize_baseline(code, baseline)

    productivity = {
        "reach_indicator": (row.get("reach_indicator") or "").strip(),
        "interaction_indicator": (row.get("interaction_indicator") or "").strip(),
        "benchmark": (row.get("benchmark") or "").strip(),
    }
    placebo = {
        "additional_information": (
            row.get("additional_information") or row.get("hobby") or ""
        ).strip(),
    }
    return code, pseudonym, json.dumps(baseline), json.dumps(productivity), json.dumps(placebo)


def should_replace_placeholder_productivity(productivity: dict) -> bool:
    text = " ".join(str(value).lower() for value in productivity.values())
    placeholder_terms = [
        "above median",
        "below median",
        "median reach",
        "median interaction",
        "score: 50",
        "talent-pool median score",
    ]
    return any(term in text for term in placeholder_terms)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_database() -> None:
    with connect() as conn:
        conn.executescript((BASE_DIR / "schema.sql").read_text(encoding="utf-8"))
        seed_database(conn)
        migrate_database(conn)


def migrate_database(conn: sqlite3.Connection) -> None:
    session_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)")}
    if "requested_candidate_count" not in session_columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN requested_candidate_count INTEGER NOT NULL DEFAULT 20")

    candidate_columns = {row["name"] for row in conn.execute("PRAGMA table_info(candidates)")}
    if "placebo_json" not in candidate_columns:
        conn.execute("ALTER TABLE candidates ADD COLUMN placebo_json TEXT")

    session_candidate_columns = {row["name"] for row in conn.execute("PRAGMA table_info(session_candidates)")}
    if "post_order_index" not in session_candidate_columns:
        conn.execute("ALTER TABLE session_candidates ADD COLUMN post_order_index INTEGER")
        conn.execute("UPDATE session_candidates SET post_order_index = order_index WHERE post_order_index IS NULL")

    response_columns = {row["name"] for row in conn.execute("PRAGMA table_info(responses)")}
    if "reason_scores_json" not in response_columns:
        conn.execute(
            "ALTER TABLE responses ADD COLUMN reason_scores_json TEXT NOT NULL DEFAULT '{}'"
        )

    for applies_to, label, sort_order in REASON_OPTIONS:
        conn.execute(
            """
            UPDATE reason_options
            SET label = ?
            WHERE applies_to = ? AND sort_order = ?
            """,
            (label, applies_to, sort_order),
        )

    experience_by_code = {
        "C-101": "0 years 6 months",
        "C-102": "1 year 0 months",
        "C-103": "2 years 0 months",
        "C-104": "0 years 6 months",
    }
    for row in conn.execute("SELECT code, baseline_json, productivity_json FROM candidates"):
        baseline = json.loads(row["baseline_json"])
        baseline["relevant_experience"] = experience_by_code.get(row["code"], baseline.get("relevant_experience", "0 years 0 months"))
        baseline = normalize_baseline(row["code"], baseline)
        conn.execute(
            "UPDATE candidates SET baseline_json = ? WHERE code = ?",
            (json.dumps(baseline), row["code"]),
        )
        additional_information = ADDITIONAL_INFORMATION_BY_CODE.get(
            row["code"], "Additional information not yet configured"
        )
        placebo = {"additional_information": additional_information}
        conn.execute(
            "UPDATE candidates SET placebo_json = ? WHERE code = ?",
            (json.dumps(placebo), row["code"]),
        )
        productivity = json.loads(row["productivity_json"] or "{}")
        if row["code"] in PRODUCTIVITY_BY_CODE and should_replace_placeholder_productivity(productivity):
            conn.execute(
                "UPDATE candidates SET productivity_json = ? WHERE code = ?",
                (json.dumps(PRODUCTIVITY_BY_CODE[row["code"]]), row["code"]),
            )

    hidden_sessions = conn.execute(
        "SELECT id, randomization_seed FROM sessions WHERE treatment_arm = 'hidden'"
    ).fetchall()
    for session in hidden_sessions:
        post_response_count = conn.execute(
            "SELECT COUNT(*) FROM responses WHERE session_id = ? AND stage = 'post'",
            (session["id"],),
        ).fetchone()[0]
        if post_response_count:
            continue

        rows = conn.execute(
            """
            SELECT candidate_id, order_index, post_order_index
            FROM session_candidates
            WHERE session_id = ?
            ORDER BY order_index
            """,
            (session["id"],),
        ).fetchall()
        pre_order = [row["candidate_id"] for row in rows]
        post_order = [row["candidate_id"] for row in sorted(rows, key=lambda item: item["post_order_index"])]
        if len(pre_order) > 1 and pre_order == post_order:
            new_post_order = randomized_distinct_candidate_order(
                pre_order,
                session["randomization_seed"] + 1,
                pre_order,
            )
            for index, candidate_id in enumerate(new_post_order, start=1):
                conn.execute(
                    """
                    UPDATE session_candidates
                    SET post_order_index = ?
                    WHERE session_id = ? AND candidate_id = ?
                    """,
                    (index, session["id"], candidate_id),
                )
    conn.commit()


def row_to_dict(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


def read_json_body(handler: SimpleHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


CHARACTERISTIC_CHOICES = {
    "gender": {"male", "female", "prefer_not_to_say"},
    "education": {
        "primary_or_below",
        "junior_secondary",
        "senior_or_vocational",
        "diploma",
        "bachelor",
        "master_or_above",
    },
    "business_role": {"owner", "co_owner", "manager", "hr_recruitment", "other"},
    "business_sector": {
        "manufacturing",
        "accommodation_food",
        "wholesale_retail",
        "personal_services",
        "other",
    },
    "workers": {"1_4", "5_19", "20_99", "100_plus"},
    "annual_revenue": {
        "less_300m",
        "300m_to_2_5b",
        "2_5b_to_50b",
        "50b_plus",
        "prefer_not_to_say",
    },
    "active_social_media": {"yes", "no"},
    "previous_digital_hiring": {"yes", "no"},
    "work_arrangement": {
        "full_time",
        "part_time",
        "freelancer",
        "family_informal",
        "other",
    },
}

PLATFORM_CHOICES = {
    "instagram",
    "tiktok",
    "facebook",
    "whatsapp_business",
    "youtube",
    "x_twitter",
    "other",
}


def validate_employer_characteristics(payload: dict) -> dict:
    required = [
        "gender",
        "birthMonth",
        "birthYear",
        "education",
        "businessRole",
        "businessSector",
        "establishedYear",
        "workers",
        "annualRevenue",
        "city",
        "province",
        "activeSocialMedia",
        "previousDigitalHiring",
        "workArrangement",
        "participationFeeImportance",
        "matchingBenefitImportance",
    ]
    missing = [key for key in required if payload.get(key) in (None, "")]
    if missing:
        raise ValueError(f"Missing required characteristics: {', '.join(missing)}")

    field_map = {
        "gender": ("gender", payload["gender"]),
        "education": ("education", payload["education"]),
        "business_role": ("businessRole", payload["businessRole"]),
        "business_sector": ("businessSector", payload["businessSector"]),
        "workers": ("workers", payload["workers"]),
        "annual_revenue": ("annualRevenue", payload["annualRevenue"]),
        "active_social_media": ("activeSocialMedia", payload["activeSocialMedia"]),
        "previous_digital_hiring": ("previousDigitalHiring", payload["previousDigitalHiring"]),
        "work_arrangement": ("workArrangement", payload["workArrangement"]),
    }
    for choice_key, (payload_key, value) in field_map.items():
        if value not in CHARACTERISTIC_CHOICES[choice_key]:
            raise ValueError(f"Invalid value for {payload_key}")

    current_year = date.today().year
    birth_month = int(payload["birthMonth"])
    birth_year = int(payload["birthYear"])
    established_year = int(payload["establishedYear"])
    if not 1 <= birth_month <= 12:
        raise ValueError("Birth month must be between 1 and 12")
    if not 1900 <= birth_year <= current_year - 15:
        raise ValueError("Birth year is outside the accepted range")
    if not 1800 <= established_year <= current_year:
        raise ValueError("Business establishment year is outside the accepted range")

    platforms = payload.get("platforms") or []
    if not isinstance(platforms, list) or any(item not in PLATFORM_CHOICES for item in platforms):
        raise ValueError("Invalid social media platform selection")
    if payload["activeSocialMedia"] == "yes" and not platforms:
        raise ValueError("Select at least one platform currently used")
    if payload["activeSocialMedia"] == "no":
        platforms = []

    conditional_other_fields = [
        (payload["businessRole"] == "other", "businessRoleOther"),
        (payload["businessSector"] == "other", "businessSectorOther"),
        ("other" in platforms, "platformOther"),
        (payload["workArrangement"] == "other", "workArrangementOther"),
    ]
    for required_if_selected, key in conditional_other_fields:
        if required_if_selected and not str(payload.get(key, "")).strip():
            raise ValueError(f"Please specify {key}")

    fee_importance = int(payload["participationFeeImportance"])
    match_importance = int(payload["matchingBenefitImportance"])
    if fee_importance not in range(1, 6) or match_importance not in range(1, 6):
        raise ValueError("Importance ratings must be between 1 and 5")

    return {
        "gender": payload["gender"],
        "birth_month": birth_month,
        "birth_year": birth_year,
        "education": payload["education"],
        "business_role": payload["businessRole"],
        "business_role_other": str(payload.get("businessRoleOther", "")).strip(),
        "business_sector": payload["businessSector"],
        "business_sector_other": str(payload.get("businessSectorOther", "")).strip(),
        "established_year": established_year,
        "workers": payload["workers"],
        "annual_revenue": payload["annualRevenue"],
        "city": str(payload["city"]).strip(),
        "province": str(payload["province"]).strip(),
        "active_social_media": payload["activeSocialMedia"],
        "platforms": platforms,
        "platform_other": str(payload.get("platformOther", "")).strip(),
        "previous_digital_hiring": payload["previousDigitalHiring"],
        "work_arrangement": payload["workArrangement"],
        "work_arrangement_other": str(payload.get("workArrangementOther", "")).strip(),
        "participation_fee_importance": fee_importance,
        "matching_benefit_importance": match_importance,
    }


class ExperimentHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path.startswith("/api/"):
            return str(BASE_DIR)
        relative = parsed.path.lstrip("/") or "index.html"
        return str(STATIC_DIR / relative)

    def send_json(self, payload: object, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_csv(self, filename: str, content: str) -> None:
        data = content.encode("utf-8-sig")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/bootstrap":
                self.handle_bootstrap()
            elif parsed.path == "/api/sessions":
                self.handle_list_sessions()
            elif parsed.path.startswith("/api/session/"):
                self.handle_get_session(parsed.path)
            elif parsed.path == "/api/candidates.csv":
                self.handle_export_candidates()
            elif parsed.path == "/api/export/responses.csv":
                self.handle_export_responses()
            elif parsed.path == "/api/export/employer-characteristics.csv":
                self.handle_export_employer_characteristics()
            else:
                super().do_GET()
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/sessions":
                self.handle_create_session()
            elif parsed.path == "/api/candidates/import":
                self.handle_import_candidates()
            elif parsed.path.startswith("/api/session/") and parsed.path.endswith("/response"):
                self.handle_save_response(parsed.path)
            elif parsed.path.startswith("/api/session/") and parsed.path.endswith("/characteristics"):
                self.handle_save_employer_characteristics(parsed.path)
            else:
                self.send_json({"error": "Unknown endpoint"}, status=404)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith("/api/session/"):
                self.handle_delete_session(parsed.path)
            else:
                self.send_json({"error": "Unknown endpoint"}, status=404)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def handle_bootstrap(self) -> None:
        with connect() as conn:
            payload = {
                "enumerators": [row_to_dict(row) for row in conn.execute("SELECT id, name FROM users WHERE role = 'enumerator' ORDER BY name")],
                "candidateSets": [row_to_dict(row) for row in conn.execute("SELECT id, name, notes FROM candidate_sets ORDER BY id")],
            }
        self.send_json(payload)

    def handle_list_sessions(self) -> None:
        with connect() as conn:
            sessions = []
            for row in conn.execute(
                """
                SELECT
                  s.*,
                  e.name AS employer_name,
                  e.business_name,
                  u.name AS enumerator_name,
                  cs.name AS candidate_set_name,
                  COUNT(DISTINCT sc.candidate_id) AS candidate_count,
                  COUNT(DISTINCT r.id) AS response_count
                FROM sessions s
                JOIN employers e ON e.id = s.employer_id
                JOIN users u ON u.id = s.enumerator_id
                JOIN candidate_sets cs ON cs.id = s.candidate_set_id
                LEFT JOIN session_candidates sc ON sc.session_id = s.id
                LEFT JOIN responses r ON r.session_id = s.id
                GROUP BY s.id
                ORDER BY s.created_at DESC, s.id DESC
                """
            ):
                item = row_to_dict(row)
                expected = item["candidate_count"] if item["treatment_arm"] == "transparent" else item["candidate_count"] * 2
                item["expected_response_count"] = expected
                sessions.append(item)
        self.send_json({"sessions": sessions})

    def handle_get_session(self, path: str) -> None:
        session_id = int(path.split("/")[3])
        with connect() as conn:
            session = conn.execute(
                """
                SELECT s.*, e.name AS employer_name, e.business_name, u.name AS enumerator_name
                FROM sessions s
                JOIN employers e ON e.id = s.employer_id
                JOIN users u ON u.id = s.enumerator_id
                WHERE s.id = ?
                """,
                (session_id,),
            ).fetchone()
            if session is None:
                self.send_json({"error": "Session not found"}, status=404)
                return

            candidates = [
                row_to_dict(row)
                for row in conn.execute(
                    """
                    SELECT
                      c.id,
                      c.code,
                      c.pseudonym,
                      c.baseline_json,
                      c.productivity_json,
                      c.placebo_json,
                      sc.order_index,
                      sc.post_order_index
                    FROM session_candidates sc
                    JOIN candidates c ON c.id = sc.candidate_id
                    WHERE sc.session_id = ?
                    ORDER BY sc.order_index
                    """,
                    (session_id,),
                )
            ]
            for candidate in candidates:
                candidate["baseline"] = baseline_for_display(
                    candidate["code"],
                    json.loads(candidate.pop("baseline_json")),
                )
                candidate["productivity"] = json.loads(candidate.pop("productivity_json") or "{}")
                candidate["placebo"] = json.loads(candidate.pop("placebo_json") or "{}")

            responses = [
                row_to_dict(row)
                for row in conn.execute("SELECT * FROM responses WHERE session_id = ?", (session_id,))
            ]
            characteristics_row = conn.execute(
                "SELECT response_json FROM employer_characteristics WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            characteristics = (
                json.loads(characteristics_row["response_json"])
                if characteristics_row is not None
                else None
            )
            answered = {(response["candidate_id"], response["stage"]) for response in responses}
            candidate_order = [candidate["id"] for candidate in candidates]
            post_candidate_order = [
                candidate["id"]
                for candidate in sorted(candidates, key=lambda item: item["post_order_index"])
            ]
            flow_steps = build_flow(
                session["treatment_arm"],
                candidate_order,
                session["reveal_type"],
                post_candidate_order,
            )
            flow = [step.__dict__ for step in flow_steps]

            resume_step_index = next_resume_step(
                flow_steps,
                answered,
                characteristics_completed=characteristics is not None,
            )

            payload = {
                "session": row_to_dict(session),
                "candidates": candidates,
                "reasons": [row_to_dict(row) for row in conn.execute("SELECT * FROM reason_options WHERE active = 1 ORDER BY applies_to, sort_order, id")],
                "responses": responses,
                "characteristics": characteristics,
                "flow": flow,
                "resumeStepIndex": resume_step_index,
            }
        self.send_json(payload)

    def handle_create_session(self) -> None:
        payload = read_json_body(self)
        required = ["employerName", "enumeratorId", "treatmentArm", "revealType", "candidateSetId", "candidateLimit", "mode"]
        missing = [key for key in required if not payload.get(key)]
        if missing:
            raise ValueError(f"Missing required fields: {', '.join(missing)}")

        seed = int(payload.get("randomizationSeed") or int(time.time() * 1000) % 2_147_483_647)
        requested_candidate_count = int(payload["candidateLimit"])
        if requested_candidate_count not in (3, 5, 10, 15, 20):
            raise ValueError("Candidate count must be one of 3, 5, 10, 15, or 20")
        with connect() as conn:
            employer = conn.execute(
                "INSERT INTO employers (name, business_name, contact) VALUES (?, ?, ?)",
                (payload["employerName"], payload.get("businessName"), payload.get("contact")),
            )
            employer_id = employer.lastrowid
            session = conn.execute(
                """
                INSERT INTO sessions (
                  employer_id, enumerator_id, treatment_arm, reveal_type,
                  candidate_set_id, requested_candidate_count, mode, randomization_seed
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    employer_id,
                    int(payload["enumeratorId"]),
                    payload["treatmentArm"],
                    payload["revealType"],
                    int(payload["candidateSetId"]),
                    requested_candidate_count,
                    payload["mode"],
                    seed,
                ),
            )
            session_id = session.lastrowid
            candidate_ids = [
                row[0]
                for row in conn.execute(
                    """
                    SELECT candidate_id
                    FROM candidate_set_members
                    WHERE candidate_set_id = ?
                    ORDER BY position
                    """,
                    (int(payload["candidateSetId"]),),
                )
            ]
            if not candidate_ids:
                raise ValueError("Selected candidate set has no candidates")
            order = randomized_candidate_order(candidate_ids, seed)[:requested_candidate_count]
            if payload["treatmentArm"] == "hidden":
                post_order = randomized_distinct_candidate_order(order, seed + 1, order)
            else:
                post_order = order
            post_order_positions = {
                candidate_id: idx for idx, candidate_id in enumerate(post_order, start=1)
            }
            conn.executemany(
                """
                INSERT INTO session_candidates (
                  session_id, candidate_id, order_index, post_order_index
                )
                VALUES (?, ?, ?, ?)
                """,
                [
                    (session_id, candidate_id, idx, post_order_positions[candidate_id])
                    for idx, candidate_id in enumerate(order, start=1)
                ],
            )
            conn.execute(
                "INSERT INTO randomization_logs (session_id, event_type, payload_json) VALUES (?, ?, ?)",
                (
                    session_id,
                    "session_assignment",
                    json.dumps(
                        {
                            "treatment_arm": payload["treatmentArm"],
                            "reveal_type": payload["revealType"],
                            "candidate_set_id": int(payload["candidateSetId"]),
                            "requested_candidate_count": requested_candidate_count,
                            "available_candidate_count": len(candidate_ids),
                            "candidate_order": order,
                            "post_reveal_candidate_order": post_order,
                            "randomization_seed": seed,
                        }
                    ),
                ),
            )
            conn.commit()
        self.send_json({"sessionId": session_id})

    def handle_delete_session(self, path: str) -> None:
        session_id = int(path.split("/")[3])
        with connect() as conn:
            row = conn.execute("SELECT employer_id FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if row is None:
                self.send_json({"error": "Session not found"}, status=404)
                return

            employer_id = row["employer_id"]
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            remaining = conn.execute("SELECT COUNT(*) FROM sessions WHERE employer_id = ?", (employer_id,)).fetchone()[0]
            if remaining == 0:
                conn.execute("DELETE FROM employers WHERE id = ?", (employer_id,))
            conn.commit()
        self.send_json({"ok": True})

    def handle_export_candidates(self) -> None:
        fieldnames = [
            "code",
            "pseudonym",
            "gender",
            "date_of_birth",
            "current_address",
            "education",
            "average_score",
            "gpa",
            "relevant_experience",
            "skills",
            "reach_indicator",
            "interaction_indicator",
            "benchmark",
            "additional_information",
        ]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        with connect() as conn:
            for row in conn.execute("SELECT code, pseudonym, baseline_json, productivity_json, placebo_json FROM candidates ORDER BY code"):
                baseline = json.loads(row["baseline_json"])
                productivity = json.loads(row["productivity_json"] or "{}")
                placebo = json.loads(row["placebo_json"] or "{}")
                writer.writerow(
                    {
                        "code": row["code"],
                        "pseudonym": row["pseudonym"],
                        "gender": baseline.get("gender", ""),
                        "date_of_birth": baseline.get("date_of_birth", ""),
                        "current_address": baseline.get("current_address", ""),
                        "education": baseline.get("education", ""),
                        "average_score": baseline.get("average_score", ""),
                        "gpa": baseline.get("gpa", ""),
                        "relevant_experience": baseline.get("relevant_experience", ""),
                        "skills": baseline.get("skills", ""),
                        "reach_indicator": productivity.get("reach_indicator", ""),
                        "interaction_indicator": productivity.get("interaction_indicator", ""),
                        "benchmark": productivity.get("benchmark", ""),
                        "additional_information": placebo.get(
                            "additional_information", placebo.get("hobby", "")
                        ),
                    }
                )
        self.send_csv("candidates.csv", output.getvalue())

    def handle_import_candidates(self) -> None:
        rows = parse_csv_body(self)
        if not rows:
            raise ValueError("CSV upload has no candidate rows")

        imported = 0
        with connect() as conn:
            set_row = conn.execute("SELECT id FROM candidate_sets ORDER BY id LIMIT 1").fetchone()
            if set_row is None:
                set_id = conn.execute(
                    "INSERT INTO candidate_sets (name, notes) VALUES (?, ?)",
                    ("Imported candidate set", "Created by CSV import."),
                ).lastrowid
            else:
                set_id = set_row["id"]

            for row in rows:
                code, pseudonym, baseline_json, productivity_json, placebo_json = candidate_row_to_payload(row)
                existing = conn.execute("SELECT id FROM candidates WHERE code = ?", (code,)).fetchone()
                if existing:
                    candidate_id = existing["id"]
                    conn.execute(
                        """
                        UPDATE candidates
                        SET pseudonym = ?, baseline_json = ?, productivity_json = ?, placebo_json = ?
                        WHERE id = ?
                        """,
                        (pseudonym, baseline_json, productivity_json, placebo_json, candidate_id),
                    )
                else:
                    candidate_id = conn.execute(
                        """
                        INSERT INTO candidates (code, pseudonym, baseline_json, productivity_json, placebo_json)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (code, pseudonym, baseline_json, productivity_json, placebo_json),
                    ).lastrowid

                member = conn.execute(
                    "SELECT 1 FROM candidate_set_members WHERE candidate_set_id = ? AND candidate_id = ?",
                    (set_id, candidate_id),
                ).fetchone()
                if member is None:
                    next_position = conn.execute(
                        "SELECT COALESCE(MAX(position), 0) + 1 FROM candidate_set_members WHERE candidate_set_id = ?",
                        (set_id,),
                    ).fetchone()[0]
                    conn.execute(
                        "INSERT INTO candidate_set_members (candidate_set_id, candidate_id, position) VALUES (?, ?, ?)",
                        (set_id, candidate_id, next_position),
                    )
                imported += 1
            conn.commit()
        self.send_json({"ok": True, "imported": imported})

    def handle_save_employer_characteristics(self, path: str) -> None:
        session_id = int(path.split("/")[3])
        characteristics = validate_employer_characteristics(read_json_body(self))
        with connect() as conn:
            if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
                self.send_json({"error": "Session not found"}, status=404)
                return
            conn.execute(
                """
                INSERT INTO employer_characteristics (session_id, response_json)
                VALUES (?, ?)
                ON CONFLICT(session_id)
                DO UPDATE SET
                  response_json = excluded.response_json,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (session_id, json.dumps(characteristics)),
            )
            conn.execute(
                """
                UPDATE sessions
                SET status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
                WHERE id = ?
                """,
                (session_id,),
            )
            conn.commit()
        self.send_json({"ok": True, "characteristics": characteristics})

    def handle_save_response(self, path: str) -> None:
        session_id = int(path.split("/")[3])
        payload = read_json_body(self)
        required = [
            "candidateId",
            "stage",
            "wageValue",
            "hireInterest",
            "selectedReasons",
            "reasonScores",
            "conditionalWageOffer",
        ]
        missing = [key for key in required if payload.get(key) in (None, "")]
        if missing:
            raise ValueError(f"Missing required fields: {', '.join(missing)}")

        for key in ("wageValue", "conditionalWageOffer"):
            value = payload[key]
            if isinstance(value, bool) or not str(value).isdigit():
                raise ValueError("Salary responses must contain whole numbers only")

        wage = int(payload["wageValue"])
        conditional_wage = int(payload["conditionalWageOffer"])
        if wage < 0 or conditional_wage < 0:
            raise ValueError("Wage values must be non-negative")
        if payload["hireInterest"] not in ("yes", "no"):
            raise ValueError("Hiring interest must be yes or no")
        if not payload["selectedReasons"]:
            raise ValueError("Select at least one reason")

        selected_reason_ids = [int(reason_id) for reason_id in payload["selectedReasons"]]
        try:
            reason_scores = {
                int(reason_id): int(score)
                for reason_id, score in payload["reasonScores"].items()
            }
        except (AttributeError, TypeError, ValueError) as exc:
            raise ValueError("Reason importance scores must be whole numbers") from exc
        if set(reason_scores) != set(selected_reason_ids):
            raise ValueError("Every selected reason must have an importance score")
        if any(score < 0 or score > 100 for score in reason_scores.values()):
            raise ValueError("Reason importance scores must be between 0 and 100")
        selected_positions = {
            reason_id: index for index, reason_id in enumerate(selected_reason_ids)
        }
        ranked_reasons = sorted(
            selected_reason_ids,
            key=lambda reason_id: (-reason_scores[reason_id], selected_positions[reason_id]),
        )

        with connect() as conn:
            conn.execute(
                "UPDATE sessions SET status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?",
                (session_id,),
            )
            conn.execute(
                """
                INSERT INTO responses (
                  session_id, candidate_id, stage, wage_value, hire_interest,
                  selected_reasons_json, ranked_reasons_json, reason_scores_json,
                  conditional_wage_offer, started_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, candidate_id, stage)
                DO UPDATE SET
                  wage_value = excluded.wage_value,
                  hire_interest = excluded.hire_interest,
                  selected_reasons_json = excluded.selected_reasons_json,
                  ranked_reasons_json = excluded.ranked_reasons_json,
                  reason_scores_json = excluded.reason_scores_json,
                  conditional_wage_offer = excluded.conditional_wage_offer,
                  submitted_at = CURRENT_TIMESTAMP
                """,
                (
                    session_id,
                    int(payload["candidateId"]),
                    payload["stage"],
                    wage,
                    payload["hireInterest"],
                    json.dumps(selected_reason_ids),
                    json.dumps(ranked_reasons),
                    json.dumps(reason_scores),
                    conditional_wage,
                    payload.get("startedAt"),
                ),
            )

            candidate_count = conn.execute("SELECT COUNT(*) FROM session_candidates WHERE session_id = ?", (session_id,)).fetchone()[0]
            treatment = conn.execute("SELECT treatment_arm FROM sessions WHERE id = ?", (session_id,)).fetchone()[0]
            expected = candidate_count if treatment == "transparent" else candidate_count * 2
            actual = conn.execute("SELECT COUNT(*) FROM responses WHERE session_id = ?", (session_id,)).fetchone()[0]
            if actual >= expected:
                conn.execute(
                    "UPDATE sessions SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE id = ?",
                    (session_id,),
                )
            conn.commit()
        self.send_json({"ok": True})

    def handle_export_employer_characteristics(self) -> None:
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT
                  s.id AS session_id,
                  e.id AS employer_id,
                  e.name AS employer_name,
                  e.business_name,
                  u.name AS enumerator_name,
                  s.treatment_arm,
                  s.reveal_type,
                  s.mode,
                  ec.response_json,
                  ec.created_at AS characteristics_created_at,
                  ec.updated_at AS characteristics_updated_at
                FROM employer_characteristics ec
                JOIN sessions s ON s.id = ec.session_id
                JOIN employers e ON e.id = s.employer_id
                JOIN users u ON u.id = s.enumerator_id
                ORDER BY s.id
                """
            ).fetchall()

        characteristic_fields = [
            "gender",
            "birth_month",
            "birth_year",
            "education",
            "business_role",
            "business_role_other",
            "business_sector",
            "business_sector_other",
            "established_year",
            "workers",
            "annual_revenue",
            "city",
            "province",
            "active_social_media",
            "platforms",
            "platform_other",
            "previous_digital_hiring",
            "work_arrangement",
            "work_arrangement_other",
            "participation_fee_importance",
            "matching_benefit_importance",
        ]
        fieldnames = [
            "session_id",
            "employer_id",
            "employer_name",
            "business_name",
            "enumerator_name",
            "treatment_arm",
            "reveal_type",
            "mode",
            *characteristic_fields,
            "characteristics_created_at",
            "characteristics_updated_at",
        ]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            item = row_to_dict(row)
            characteristics = json.loads(item.pop("response_json"))
            characteristics["platforms"] = json.dumps(characteristics.get("platforms", []))
            writer.writerow({**item, **characteristics})
        self.send_csv("employer-characteristics.csv", output.getvalue())

    def handle_export_responses(self) -> None:
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT
                  s.id AS session_id,
                  e.id AS employer_id,
                  e.name AS employer_name,
                  e.business_name,
                  u.name AS enumerator_name,
                  s.treatment_arm,
                  s.reveal_type,
                  s.mode,
                  s.candidate_set_id,
                  s.requested_candidate_count,
                  s.randomization_seed,
                  sc.order_index AS pre_order_index,
                  sc.post_order_index,
                  CASE
                    WHEN r.stage = 'post' THEN sc.post_order_index
                    ELSE sc.order_index
                  END AS shown_order_index,
                  c.id AS candidate_id,
                  c.code AS candidate_code,
                  r.stage,
                  r.wage_value AS perceived_typical_monthly_pay,
                  r.hire_interest,
                  r.selected_reasons_json,
                  r.ranked_reasons_json,
                  r.reason_scores_json AS reason_importance_scores_json,
                  r.conditional_wage_offer AS hypothetical_monthly_salary_offer,
                  r.submitted_at,
                  s.created_at AS session_created_at,
                  s.completed_at AS session_completed_at
                FROM responses r
                JOIN sessions s ON s.id = r.session_id
                JOIN employers e ON e.id = s.employer_id
                JOIN users u ON u.id = s.enumerator_id
                JOIN candidates c ON c.id = r.candidate_id
                JOIN session_candidates sc ON sc.session_id = s.id AND sc.candidate_id = c.id
                ORDER BY
                  s.id,
                  CASE r.stage
                    WHEN 'transparent' THEN 1
                    WHEN 'pre' THEN 1
                    WHEN 'post' THEN 2
                    ELSE 9
                  END,
                  shown_order_index
                """
            ).fetchall()

        output = io.StringIO()
        fieldnames = [key for key in rows[0].keys()] if rows else [
            "session_id",
            "employer_id",
            "employer_name",
            "business_name",
            "enumerator_name",
            "treatment_arm",
            "reveal_type",
            "mode",
            "candidate_set_id",
            "requested_candidate_count",
            "randomization_seed",
            "pre_order_index",
            "post_order_index",
            "shown_order_index",
            "candidate_id",
            "candidate_code",
            "stage",
            "perceived_typical_monthly_pay",
            "hire_interest",
            "selected_reasons_json",
            "ranked_reasons_json",
            "reason_importance_scores_json",
            "hypothetical_monthly_salary_offer",
            "submitted_at",
            "session_created_at",
            "session_completed_at",
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row_to_dict(row))
        self.send_csv("responses.csv", output.getvalue())


def main() -> None:
    init_database()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), ExperimentHandler)
    local_url = f"http://localhost:{port}"
    print(f"Social Media / Digital Admin Preference running at {local_url}")
    server.serve_forever()


if __name__ == "__main__":
    main()
