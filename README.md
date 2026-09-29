# Online Examination System — v2 (Express + PostgreSQL)

This is a rebuild of the original localStorage prototype onto a real backend.
The browser is now a display for content the server sends it — it authenticates
nobody, calculates no scores, and owns no clock. Every rule described in the
original flaw review has a corresponding fix here; see `CHANGES.md` for the
full list mapped old-flaw → new-behaviour.

## Architecture

```
Browser (public/*.html + public/js/*.js)
        │  fetch(), HttpOnly session cookie, CSRF header
        ▼
Express API (server/routes/*.js)
        │
        ▼
PostgreSQL via `pg` (server/db.js)
```

No build step. The server creates the PostgreSQL schema automatically on first startup.

## Running it

```bash
npm install
ADMIN_PASSWORD='ChangeMe123' node server/create-admin.js "Your Name" you@school.edu.ng STAFF001
npm start
# → http://localhost:3000
```

For a quick local demo with sample data instead of a fresh install:

```bash
NODE_ENV=development SEED_DEMO=1 npm start
```
This seeds a demo admin/lecturer/student set (see `server/seed.js` for the
credentials) and **refuses to run if `NODE_ENV=production`** or if the
database already has users.

Run the automated test suite (34 checks covering auth, registration rules,
exam integrity, timers, and data-integrity guarantees):

```bash
npm test
```

## What changed, in one paragraph

Passwords are hashed (scrypt) and checked server-side. Sessions are random
tokens in HttpOnly/SameSite cookies, not `localStorage`. Every role check,
score calculation, and exam deadline is enforced by the server; the browser
never receives a correct answer until the lecturer releases results, and
never enforces its own clock. Course registration is a separate, lockable
workflow from account creation, with an admin-approval step and no self-drop
after registration is submitted or after an exam has been sat. Publishing an
exam freezes a snapshot of its questions, so editing or deleting bank
questions afterwards can't change a result that's already on the books.
Deleting a course, exam, or user with any academic history is refused in
favour of archiving/deactivating. Every sensitive change (marks, approvals,
status changes, penalty waivers) is written to an audit log with old/new
values where relevant.

See `CHANGES.md` for the flaw-by-flaw mapping.

## PostgreSQL setup

This version uses PostgreSQL instead of SQLite/better-sqlite3. The database schema is created automatically on first startup.

1. Create a PostgreSQL database (Neon works well with Vercel).
2. Copy its connection string into the `DATABASE_URL` environment variable.
3. Run `npm install`.
4. Run `npm start`.

For local development in PowerShell:

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
npm install
npm start
```

Do not commit the real `DATABASE_URL` to GitHub. Add it as an environment variable in Vercel as well.



## Exam import/export
Lecturers can export an exam from the Exams page as an ExamSuite `.json` package. The package includes the exam settings and its question set, so another lecturer can use **Import exam** to create a new draft in one of their assigned courses. Imported exams are always drafts and must be reviewed before publishing.

## Request loading
All API requests now display a lightweight global loading indicator while waiting for the server/database response, including initial page loads and save/action requests.


## Exam import/export
Lecturers can export exams as **Excel (.xlsx)** or **JSON (.json)** and import either format. Excel files use two sheets: `Exam Info` for exam settings and `Questions` for question rows. The Exams page also provides an **Excel Template** download. Imported exams are created as drafts for review before publishing.

For Excel questions, use `Type` values `mcq`, `truefalse`, `short`, or `essay`. For MCQ, `Correct Answer` can be `A`–`F` or the exact option text. For short-answer questions, put accepted answers in `Accepted Answers` separated by `|`.


### Department + level course registration
Students register their own courses during the administrator-controlled registration window. The server exposes only active courses whose `department` and `level` exactly match the student's profile. Registration is immediate; there is no normal admin approval queue. A course cannot be dropped after the student has started/sat an exam for that course. Exam access is checked again on the server at the exam gate/start.

For existing databases migrated from an earlier version, populate `users.department` for existing students and `courses.department` for existing courses before opening registration.


## Student levels

The system uses exactly four academic levels for student and course eligibility:

- ND I
- ND II
- HND I
- HND II

Student course registration is filtered by both department and level.
