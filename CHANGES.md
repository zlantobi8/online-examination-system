# Flaw → fix map

Numbers match the review you were given. "File" points at the main place the
fix lives; most fixes touch several files.

## Architecture / security

1. **No real backend** → Express API + SQLite (`server/db.js`, `server/server.js`).
   The browser calls `fetch('/api/...')`; it holds no authoritative data at all.
2. **Plaintext passwords, client-side auth** → `server/lib/auth.js`: scrypt
   password hashing, constant-time comparison, a dummy hash checked on unknown
   emails so "no such user" and "wrong password" cost the same time and return
   the same message. Auth happens in `routes/auth.js`, never in the browser.
3. **Students can modify their own scores** → `server/lib/exam.js:finalizeAttempt`
   computes the score from the exam's server-held snapshot. The client only
   ever POSTs an answer value; grading, totals and penalties are computed and
   stored server-side.
4. **Correct answers shipped to the browser** → `routes/student.js:attemptPayload`
   strips `correctOptionId` / `acceptedAnswers` before sending a paper. Covered
   by an automated test (`server/test.js`: "paper sent to browser contains NO
   answers").
5. **Anti-cheat bypassable client-side** → still true of any browser signal, so
   it's now explicitly a *logged signal*, not a security boundary: events are
   recorded via `POST /attempts/:id/integrity` (server-counted, server decides
   the auto-submit threshold), and the UI copy says so plainly. Mark penalties
   for these events default to **0%** and require an explicit opt-in per exam;
   a lecturer can waive a penalty per candidate with a reasoned audit entry.
6. **Essay type advertised but not implemented** → `essay` is a real question
   type end-to-end: bank editor, exam builder ("Fixed set" only — random draws
   exclude essays), server-side snapshot, marking queue, and result review.
7. **Uncontrolled self-enrollment** → replaced by a real registration workflow,
   below.
8. **Anyone can register as a lecturer** → `POST /api/auth/register` always
   creates a `student`; the `role` field in the request body is flatly ignored
   server-side. Lecturer/admin accounts can only be created by an admin
   (`POST /api/users`, `requireRole('admin')`).

## Course registration model (flaws 1–8 of the second review, and #7/#33)

- `registrations` table: one row per student/course/session/semester, with
  status `draft → submitted → approved` (or `withdrawn`). Public sign-up
  (`routes/auth.js`) creates only an account — no course selection there.
- An admin-controlled **registration window** (`settings` table, toggled from
  Admin → Registration) gates whether students can add/drop at all.
- While `draft`, a student can add/drop freely. `POST /registrations/submit`
  **locks** the set — no more self-service changes. An admin then approves
  (`POST /admin/registrations/:id/approve`), which is what actually makes the
  student an exam candidate.
- A student can never drop a course once they've sat an exam on it — checked
  independently of the draft/locked state (`routes/student.js`, the `DELETE
  /registrations/:courseId` handler).
- Level is enforced: a course's `level` must match the student's `level`.

## Examination integrity

- **Server-side timer**: `attempts.deadline` is computed and stored by the
  server at start time (`min(startedAt + duration, exam.closesAt)`). The
  client shows a countdown corrected for clock skew but the server independently
  rejects any answer write after the deadline (`server/lib/exam.js` `GRACE_MS`)
  and a 30-second background sweep (`reapExpired`, wired in `server.js`) grades
  abandoned papers even if no browser ever reconnects.
- **Frozen exam snapshot**: publishing an exam (`POST /exams/:id/publish`)
  copies the current question data into `exams.snapshot` (JSON). All scoring,
  the candidate's paper, and later result review read from that snapshot —
  editing or archiving a bank question afterwards cannot change a result
  already on the books (tested explicitly).
- **Frozen candidate list**: `exam_candidates` is populated from approved
  registrations at publish time and kept in sync as registrations change
  later — but a student who has already sat the exam is never removed from it,
  so "who was absent" stays accurate even if their registration is later
  withdrawn (also tested explicitly).
- **Published exam is immutable**: `PUT /exams/:id` refuses once
  `status != 'draft'`; unpublish is refused once any attempt exists. Lecturers
  duplicate an exam to make a new version instead.
- **Answers withheld while an exam is live**: results are hidden from students
  until the lecturer explicitly releases them (`exams.results_released`), and
  correct-answer review is withheld until the exam has actually closed (or
  permanently, if the lecturer sets "never show answers"), so a fast finisher
  can't leak the key to a friend still writing.

## Data integrity ("nothing academic gets silently destroyed")

- Deleting a **course**, **exam**, or **user** with any linked history
  (questions, exams, attempts, registrations) is refused (HTTP 409) in favour
  of an explicit status change: `courses.status` → closed/archived,
  `exams.status` → closed/archived, `users.status` → suspended/inactive. A
  hard delete is only allowed for records with zero academic footprint.
- Deleting a bank **question** that is inside a published exam's snapshot
  archives it (hidden from new use) instead of removing it; the exam's frozen
  copy is untouched either way.
- Admin removal of a course registration after an exam was sat keeps the
  attempt/result forever — verified by a test that withdraws a registration
  and checks the student is still on the results roster, not the absent list.

## Accountability

- `audit_logs` records key actions with actor, before/after where relevant,
  and an optional free-text reason: logins, registrations and approvals,
  exam publish/close/archive, essay mark changes (old → new value), penalty
  waivers, user status changes, account creation. Visible to admins at
  `GET /api/admin/audit` and on the admin dashboard.
- Essay marking is a controlled two-step: score with an optional note
  (`PUT /attempts/:id/marks`), which is exactly the kind of change that used
  to be silently overwritten in the old code.

## Things intentionally left as a next step

This is still a single-instance SQLite app suitable for a department, not a
university-wide deployment — see the architecture note in the README for what
changes to reach Postgres. Email verification and self-service password reset
are not implemented (an admin resets a password instead). Rate limiting is
applied to login/register; other endpoints rely on session auth + CSRF only.


## Safe exam import preview
- JSON and Excel imports now show a review preview before anything is saved.
- Lecturers can cancel an import without creating questions or an exam.
- Preview displays title, course, question count, total marks, duration, and question list.
- Excel imports are parsed and validated server-side before confirmation.


## 2026-09-29 — Department/level course self-registration

- Added `department` to student and course records.
- Students can register only for active courses matching both their department and level.
- Course registration is automatic; administrator approval is no longer required for normal student registration.
- Students can add/remove eligible courses while the registration window is open.
- A course becomes locked for that student after they start/sit an exam for that course.
- Exam eligibility is enforced server-side from the current approved registration and academic session/semester.
- Published exams can automatically recognize students who register for the course after publication.
- Admin course setup now includes department.
- Student sign-up now requires department.
- Admin student editing includes department.
- Existing students/courses with a blank department must be populated before they can participate in department-restricted registration.

## Department dropdowns
- Added a controlled `departments` PostgreSQL table with migration/backfill from existing users/courses.
- Student registration now loads active departments into a dropdown.
- Admin student management and course management use department dropdowns.
- Added admin department management from the Courses page.
- API validation rejects departments that are not active in the controlled list.
- Levels remain restricted to ND I, ND II, HND I, and HND II.
