import json
import sqlite3


PRODUCTIVITY_BY_CODE = {
    "C-101": {
        "reach_indicator": "Average accounts reached per post: 1,240",
        "interaction_indicator": "Average interactions per post: 58 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-102": {
        "reach_indicator": "Average accounts reached per post: 910",
        "interaction_indicator": "Average interactions per post: 95 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-103": {
        "reach_indicator": "Average accounts reached per post: 520",
        "interaction_indicator": "Average interactions per post: 50 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-104": {
        "reach_indicator": "Average accounts reached per post: 2,300",
        "interaction_indicator": "Average interactions per post: 150 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-105": {
        "reach_indicator": "Average accounts reached per post: 990",
        "interaction_indicator": "Average interactions per post: 76 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-106": {
        "reach_indicator": "Average accounts reached per post: 1,510",
        "interaction_indicator": "Average interactions per post: 43 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-107": {
        "reach_indicator": "Average accounts reached per post: 790",
        "interaction_indicator": "Average interactions per post: 35 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-108": {
        "reach_indicator": "Average accounts reached per post: 4,100",
        "interaction_indicator": "Average interactions per post: 24 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-109": {
        "reach_indicator": "Average accounts reached per post: 680",
        "interaction_indicator": "Average interactions per post: 280 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
    "C-110": {
        "reach_indicator": "Average accounts reached per post: 320",
        "interaction_indicator": "Average interactions per post: 12 (likes, comments, shares, and saves combined)",
        "benchmark": "Talent-pool median: 950 accounts reached per post; 54 interactions per post",
    },
}


def seed_database(conn: sqlite3.Connection) -> None:
    user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if user_count:
        return

    conn.executemany(
        "INSERT INTO users (name, role) VALUES (?, ?)",
        [
            ("Admin Researcher", "admin"),
            ("Enumerator A", "enumerator"),
            ("Enumerator B", "enumerator"),
        ],
    )

    candidates = [
        {
            "code": "C-101",
            "pseudonym": "Candidate A",
            "baseline": {
                "gender": "Female",
                "date_of_birth": "2002-04-12",
                "current_address": "Bandung, West Java",
                "education": "Vocational high school, multimedia major",
                "average_score": 67.7,
                "relevant_experience": "0 years 6 months",
                "skills": "Canva, CapCut, Instagram captions, basic analytics",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-101"],
            "placebo": {
                "hobby": "Cooking and trying new recipes",
            },
        },
        {
            "code": "C-102",
            "pseudonym": "Candidate B",
            "baseline": {
                "gender": "Male",
                "date_of_birth": "2001-09-03",
                "current_address": "Sidoarjo, East Java",
                "education": "Diploma, information systems",
                "gpa": 2.24,
                "relevant_experience": "1 year 0 months",
                "skills": "Content scheduling, photography, spreadsheet reporting",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-102"],
            "placebo": {
                "hobby": "Playing futsal on weekends",
            },
        },
        {
            "code": "C-103",
            "pseudonym": "Candidate C",
            "baseline": {
                "gender": "Female",
                "date_of_birth": "2000-11-27",
                "current_address": "Sleman, Yogyakarta",
                "education": "Bachelor's degree, communication",
                "gpa": 3.36,
                "relevant_experience": "2 years 0 months",
                "skills": "Copywriting, Meta Business Suite, simple design briefs",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-103"],
            "placebo": {
                "hobby": "Reading novels and journaling",
            },
        },
        {
            "code": "C-104",
            "pseudonym": "Candidate D",
            "baseline": {
                "gender": "Male",
                "date_of_birth": "2003-02-19",
                "current_address": "Makassar, South Sulawesi",
                "education": "Senior high school",
                "average_score": 90.0,
                "relevant_experience": "0 years 6 months",
                "skills": "Short-form video, basic photo editing, trend monitoring",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-104"],
            "placebo": {
                "hobby": "Cycling and short-form video editing",
            },
        },
        {
            "code": "C-105",
            "pseudonym": "Candidate E",
            "baseline": {
                "gender": "Female",
                "date_of_birth": "2002-08-15",
                "current_address": "Jakarta, DKI Jakarta",
                "education": "Vocational high school, visual communication design",
                "average_score": 77.7,
                "relevant_experience": "1 year 2 months",
                "skills": "Canva, Instagram Reels, product photography, caption writing",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-105"],
            "placebo": {
                "hobby": "Baking and food photography",
            },
        },
        {
            "code": "C-106",
            "pseudonym": "Candidate F",
            "baseline": {
                "gender": "Male",
                "date_of_birth": "2001-05-22",
                "current_address": "Semarang, Central Java",
                "education": "Diploma, communication",
                "gpa": 0.3,
                "relevant_experience": "1 year 6 months",
                "skills": "Content calendar planning, Canva, basic video editing, customer replies",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-106"],
            "placebo": {
                "hobby": "Playing guitar",
            },
        },
        {
            "code": "C-107",
            "pseudonym": "Candidate G",
            "baseline": {
                "gender": "Female",
                "date_of_birth": "2003-01-10",
                "current_address": "Denpasar, Bali",
                "education": "Senior high school",
                "average_score": 84.2,
                "relevant_experience": "0 years 8 months",
                "skills": "TikTok content, CapCut, simple graphic design, trend monitoring",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-107"],
            "placebo": {
                "hobby": "Traditional dance",
            },
        },
        {
            "code": "C-108",
            "pseudonym": "Candidate H",
            "baseline": {
                "gender": "Male",
                "date_of_birth": "2000-07-30",
                "current_address": "Medan, North Sumatra",
                "education": "Bachelor's degree, management",
                "gpa": 3.46,
                "relevant_experience": "2 years 0 months",
                "skills": "Meta Business Suite, spreadsheet reporting, copywriting, campaign scheduling",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-108"],
            "placebo": {
                "hobby": "Badminton",
            },
        },
        {
            "code": "C-109",
            "pseudonym": "Candidate I",
            "baseline": {
                "gender": "Female",
                "date_of_birth": "2002-12-05",
                "current_address": "Malang, East Java",
                "education": "Vocational high school, office administration",
                "average_score": 82.7,
                "relevant_experience": "1 year 0 months",
                "skills": "Instagram admin, WhatsApp Business replies, Canva, basic analytics",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-109"],
            "placebo": {
                "hobby": "Reading web novels",
            },
        },
        {
            "code": "C-110",
            "pseudonym": "Candidate J",
            "baseline": {
                "gender": "Male",
                "date_of_birth": "2001-11-18",
                "current_address": "Palembang, South Sumatra",
                "education": "Diploma, multimedia",
                "gpa": 3.83,
                "relevant_experience": "1 year 4 months",
                "skills": "Short-form video editing, product photos, content scheduling, Canva",
            },
            "productivity": PRODUCTIVITY_BY_CODE["C-110"],
            "placebo": {
                "hobby": "Fishing",
            },
        },
    ]

    for candidate in candidates:
        conn.execute(
            """
            INSERT INTO candidates (code, pseudonym, baseline_json, productivity_json, placebo_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                candidate["code"],
                candidate["pseudonym"],
                json.dumps(candidate["baseline"]),
                json.dumps(candidate["productivity"]),
                json.dumps(candidate["placebo"]),
            ),
        )

    conn.execute(
        "INSERT INTO candidate_sets (name, notes) VALUES (?, ?)",
        ("Balanced pilot set 1", "Seed set balanced for education, gender, and prior experience."),
    )
    set_id = conn.execute("SELECT id FROM candidate_sets WHERE name = ?", ("Balanced pilot set 1",)).fetchone()[0]
    candidate_ids = [row[0] for row in conn.execute("SELECT id FROM candidates ORDER BY id")]
    conn.executemany(
        "INSERT INTO candidate_set_members (candidate_set_id, candidate_id, position) VALUES (?, ?, ?)",
        [(set_id, candidate_id, idx) for idx, candidate_id in enumerate(candidate_ids, start=1)],
    )

    reasons = [
        ("yes", "Relevant social media experience", 1),
        ("yes", "Strong creative skills", 2),
        ("yes", "Education fits the role", 3),
        ("yes", "Looks easy to train", 4),
        ("no", "Insufficient relevant experience", 1),
        ("no", "Education does not fit the role", 2),
        ("no", "Skills look too limited", 3),
        ("no", "Expected productivity is too low", 4),
    ]
    conn.executemany(
        "INSERT INTO reason_options (applies_to, label, sort_order) VALUES (?, ?, ?)",
        reasons,
    )
    conn.commit()
