# Social Media / Digital Admin Preference MVP

Research MVP for guided candidate-profile review sessions with Indonesian MSME
employers considering entry-level social media or digital admin workers.

This first implementation is intentionally plain:

- Python standard-library HTTP server
- SQLite database
- Vanilla HTML/CSS/JS frontend
- Deterministic randomization with stored seeds and realized candidate order

It is designed to validate the research flow before investing in a fuller
Next.js/Postgres/Supabase implementation.

## Run Locally

```powershell
python server.py
```

Then open:

```text
http://localhost:8000
```

If the database does not exist, `server.py` creates `experiment.db`, applies
`schema.sql`, and seeds pilot candidates, reasons, users, and a
candidate set.

## Deploy On Render

This project is intentionally dependency-light. It can run as a Python web
service on Render.

Suggested settings:

- Build command: `python -m pip install -r requirements.txt`
- Start command: `python server.py`
- Environment variable: `HOST=0.0.0.0`

Render provides the `PORT` environment variable automatically. The server reads
that value and binds to it.

For supervisor testing, the local SQLite database is acceptable. For real
fieldwork, move the database to persistent hosted storage such as Postgres.

## MVP Coverage

- Enumerator dashboard
- Guided session creation
- Transparent and hidden treatment flows
- Hidden-arm pre/post repeated candidate IDs
- Productivity and placebo reveal type metadata
- Candidate-level questionnaire
- Resume by saved responses
- CSV response export
- Randomization seed and realized candidate order logging

## Important Research Notes

This is not a commercial hiring workflow. Candidate pages are deliberately
minimal, readable, and auditable. Treatment logic is centralized in
`experiment.py` so the hidden-arm repeat behavior is easy to test.
