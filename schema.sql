PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'enumerator')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  business_name TEXT,
  contact TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  pseudonym TEXT NOT NULL,
  baseline_json TEXT NOT NULL,
  productivity_json TEXT,
  placebo_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS candidate_set_members (
  candidate_set_id INTEGER NOT NULL REFERENCES candidate_sets(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (candidate_set_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id INTEGER NOT NULL REFERENCES employers(id),
  enumerator_id INTEGER NOT NULL REFERENCES users(id),
  treatment_arm TEXT NOT NULL CHECK (treatment_arm IN ('transparent', 'hidden')),
  reveal_type TEXT NOT NULL CHECK (reveal_type IN ('productivity', 'placebo')),
  candidate_set_id INTEGER NOT NULL REFERENCES candidate_sets(id),
  requested_candidate_count INTEGER NOT NULL DEFAULT 20,
  mode TEXT NOT NULL CHECK (mode IN ('online', 'offline')),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'in_progress', 'completed', 'interrupted')),
  randomization_seed INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS session_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  order_index INTEGER NOT NULL,
  post_order_index INTEGER NOT NULL,
  UNIQUE(session_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS reason_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('yes', 'no')),
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  stage TEXT NOT NULL CHECK (stage IN ('transparent', 'pre', 'post')),
  wage_value INTEGER NOT NULL,
  hire_interest TEXT NOT NULL CHECK (hire_interest IN ('yes', 'no')),
  selected_reasons_json TEXT NOT NULL,
  ranked_reasons_json TEXT NOT NULL,
  conditional_wage_offer INTEGER NOT NULL,
  started_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, candidate_id, stage)
);

CREATE TABLE IF NOT EXISTS randomization_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_session_candidates_session ON session_candidates(session_id, order_index);
