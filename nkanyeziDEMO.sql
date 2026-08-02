
DROP VIEW IF EXISTS learner_unit_grades CASCADE;
DROP VIEW IF EXISTS learner_feedback_history CASCADE;
DROP VIEW IF EXISTS learner_attendance_log CASCADE;
DROP VIEW IF EXISTS learner_compliance_profile CASCADE;
DROP VIEW IF EXISTS admin_recent_activity CASCADE;
DROP VIEW IF EXISTS admin_dashboard_stats CASCADE;
DROP VIEW IF EXISTS learner_grades CASCADE;
DROP VIEW IF EXISTS quiz_overview CASCADE;

DROP TABLE IF EXISTS quiz_attempt_answers CASCADE;
DROP TABLE IF EXISTS quiz_attempts CASCADE;
DROP TABLE IF EXISTS project_submissions CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS quiz_questions CASCADE;
DROP TABLE IF EXISTS quizzes CASCADE;
DROP TABLE IF EXISTS learner_risk_flags CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS assessment_submissions CASCADE;
DROP TABLE IF EXISTS assessments CASCADE;
DROP TABLE IF EXISTS material_views CASCADE;
DROP TABLE IF EXISTS materials CASCADE;
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS attendance_sessions CASCADE;
DROP TABLE IF EXISTS learner_unit_progress CASCADE;
DROP TABLE IF EXISTS enrolments CASCADE;
DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS units CASCADE;
DROP TABLE IF EXISTS qualifications CASCADE;
DROP TABLE IF EXISTS assessors CASCADE;
DROP TABLE IF EXISTS facilitators CASCADE;
DROP TABLE IF EXISTS attendance_schedules CASCADE;
DROP TABLE IF EXISTS learners CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS
  user_role, user_status, nqf_level, attendance_status, material_type,
  assessment_type, feedback_type, risk_level, quiz_status,
  quiz_attempt_status, project_status
CASCADE;

CREATE TYPE user_role AS ENUM ('learner', 'facilitator', 'assessor', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'completed', 'terminated');
CREATE TYPE nqf_level AS ENUM ('NQF1','NQF2','NQF3','NQF4','NQF5','NQF6','NQF7','NQF8','NQF9','NQF10');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE material_type AS ENUM ('document', 'video', 'link', 'assessment_guide', 'other');
CREATE TYPE assessment_type AS ENUM ('formative', 'summative', 'practical', 'portfolio');
CREATE TYPE feedback_type AS ENUM ('general', 'progress', 'attendance', 'assessment', 'risk', 'message');
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');
CREATE TYPE quiz_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE quiz_attempt_status AS ENUM ('in_progress', 'submitted', 'timed_out');
CREATE TYPE project_status AS ENUM ('draft', 'published', 'archived');

-- ---------- users & role tables ----------

CREATE TABLE users (
  user_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name       VARCHAR(100),
  name               VARCHAR(100),
  surname            VARCHAR(100),
  sa_id              VARCHAR(13) UNIQUE,
  gender             VARCHAR(10),
  race               VARCHAR(10),
  phone_number       VARCHAR(20),
  alternative_number VARCHAR(20),
  email              VARCHAR(255),
  password_hashed    TEXT NOT NULL,
  role               user_role NOT NULL DEFAULT 'learner',
  status             user_status NOT NULL DEFAULT 'active',
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at         TIMESTAMPTZ,
  last_login         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE learners (
  learner_id   UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  status       user_status NOT NULL DEFAULT 'active',
  deal_number  INTEGER
);

CREATE TABLE attendance_schedules (
  learner_id    UUID PRIMARY KEY REFERENCES learners(learner_id) ON DELETE CASCADE,
  day_of_week_1 SMALLINT NOT NULL CHECK (day_of_week_1 BETWEEN 0 AND 6),
  day_of_week_2 SMALLINT CHECK (day_of_week_2 BETWEEN 0 AND 6)
);

CREATE TABLE facilitators (
  facilitator_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  deal_number    INTEGER
);

CREATE TABLE assessors (
  assessor_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  deal_number INTEGER
);

-- ---------- qualifications, units, deals ----------

CREATE TABLE qualifications (
  qualification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            VARCHAR(255) NOT NULL,
  nqf_level        nqf_level NOT NULL,
  seta             VARCHAR(255) NOT NULL,
  duration_months  INT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  stipulated_units INTEGER,
  total_credits    INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_id        UUID NOT NULL REFERENCES qualifications(qualification_id) ON DELETE CASCADE,
  unit_number             INTEGER NOT NULL,
  title                   VARCHAR(255) NOT NULL,
  description             TEXT,
  credits                 INTEGER,
  expected_duration_weeks INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (qualification_id, unit_number)
);

CREATE TABLE deals (
  deal_number         INTEGER PRIMARY KEY,
  sponsor             VARCHAR(255),
  qualification_id    UUID REFERENCES qualifications(qualification_id),
  facilitator_id      UUID REFERENCES facilitators(facilitator_id),
  registration_status VARCHAR(255),
  learners_count      INTEGER,
  start_date          DATE,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ
);

-- learners/facilitators/assessors <-> deals is a genuine circular
-- reference (each side is created before the other exists), so these
-- three FKs still have to be added after the fact — kept as-is.
ALTER TABLE learners     ADD FOREIGN KEY (deal_number) REFERENCES deals(deal_number) ON DELETE SET NULL;
ALTER TABLE facilitators ADD FOREIGN KEY (deal_number) REFERENCES deals(deal_number) ON DELETE SET NULL;
ALTER TABLE assessors    ADD FOREIGN KEY (deal_number) REFERENCES deals(deal_number) ON DELETE SET NULL;

-- ---------- enrolments & progress ----------

CREATE TABLE enrolments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id         UUID NOT NULL REFERENCES learners(learner_id),
  qualification_id   UUID NOT NULL REFERENCES qualifications(qualification_id),
  facilitator_id     UUID REFERENCES facilitators(facilitator_id),
  assessor_id        UUID REFERENCES assessors(assessor_id),
  deal_number        INTEGER REFERENCES deals(deal_number) ON DELETE SET NULL,
  start_date         DATE NOT NULL,
  expected_end_date  DATE,
  actual_end_date    DATE,
  status             user_status NOT NULL DEFAULT 'active',
  progress_pct       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  employer_name      VARCHAR(255),
  workplace_address  TEXT,
  stipend_amount     NUMERIC(10,2),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (learner_id, qualification_id)
);

CREATE TABLE learner_unit_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrolment_id    UUID NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  unit_id         UUID NOT NULL REFERENCES units(id),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  progress_pct    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  UNIQUE (enrolment_id, unit_id)
);

-- One row per learner per calendar day; no sessions table.
CREATE TABLE attendance_records (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id                UUID NOT NULL REFERENCES learners(learner_id),
  attendance_date           DATE NOT NULL,
  status                    attendance_status NOT NULL DEFAULT 'absent',
  check_in_time             TIMESTAMPTZ,
  check_out_time            TIMESTAMPTZ,
  geo_latitude              NUMERIC(10,7),
  geo_longitude             NUMERIC(10,7),
  geo_verified              BOOLEAN NOT NULL DEFAULT FALSE,
  geo_distance_km           NUMERIC(8,4),
  checkout_geo_latitude     NUMERIC(10,7),
  checkout_geo_longitude    NUMERIC(10,7),
  checkout_geo_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  checkout_geo_distance_km  NUMERIC(8,4),
  venue_latitude            NUMERIC(10,7),
  venue_longitude           NUMERIC(10,7),
  captured_by               UUID REFERENCES users(user_id),
  capture_method            VARCHAR(50) DEFAULT 'manual',
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (learner_id, attendance_date)
);

-- ---------- materials ----------

CREATE TABLE materials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  uploaded_by     UUID REFERENCES users(user_id),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  file_url        TEXT NOT NULL,
  file_name       VARCHAR(255),
  file_size_bytes BIGINT,
  material_type   material_type NOT NULL DEFAULT 'other',
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE material_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id   UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  learner_id    UUID NOT NULL REFERENCES learners(learner_id),
  viewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_secs INTEGER,
  UNIQUE (material_id, learner_id)
);

-- ---------- legacy assessments table (older assessment model) ----------

CREATE TABLE assessments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(user_id),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  assessment_type assessment_type NOT NULL,
  max_score       NUMERIC(6,2) NOT NULL DEFAULT 100,
  pass_mark       NUMERIC(6,2) NOT NULL DEFAULT 50,
  due_date        TIMESTAMPTZ,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- graded_by references users directly (not assessors), since admins can also grade
CREATE TABLE assessment_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  learner_id      UUID NOT NULL REFERENCES learners(learner_id),
  submitted_at    TIMESTAMPTZ,
  score           NUMERIC(6,2) CHECK (score >= 0),
  graded_by       UUID REFERENCES users(user_id),
  graded_at       TIMESTAMPTZ,
  feedback        TEXT,
  file_url        TEXT,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, learner_id)
);

-- ---------- feedback ----------
-- parent_id / facilitator_id / from_role were added via ALTER + backfill
-- in the original; declared directly here since this is a fresh build.

CREATE TABLE feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id      UUID NOT NULL REFERENCES users(user_id),
  to_learner_id     UUID NOT NULL REFERENCES learners(learner_id),
  enrolment_id      UUID REFERENCES enrolments(id),
  parent_id         UUID REFERENCES feedback(id) ON DELETE CASCADE,
  facilitator_id    UUID NOT NULL REFERENCES facilitators(facilitator_id),
  from_role         VARCHAR(20) NOT NULL DEFAULT 'facilitator' CHECK (from_role IN ('facilitator', 'learner')),
  feedback_type     feedback_type NOT NULL DEFAULT 'general',
  subject           VARCHAR(255),
  message           TEXT NOT NULL,
  is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at           TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  delivery_method   VARCHAR(50) DEFAULT 'portal',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_parent_id ON feedback(parent_id);
CREATE INDEX idx_feedback_facilitator_id ON feedback(facilitator_id);

CREATE TABLE learner_risk_flags (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id           UUID NOT NULL REFERENCES learners(learner_id),
  enrolment_id         UUID NOT NULL REFERENCES enrolments(id),
  risk_level           risk_level NOT NULL DEFAULT 'low',
  flag_low_attendance  BOOLEAN NOT NULL DEFAULT FALSE,
  flag_behind_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  flag_no_login        BOOLEAN NOT NULL DEFAULT FALSE,
  flag_no_feedback     BOOLEAN NOT NULL DEFAULT FALSE,
  flag_poe_overdue     BOOLEAN NOT NULL DEFAULT FALSE,
  attendance_pct       NUMERIC(5,2),
  progress_pct         NUMERIC(5,2),
  days_since_login     INTEGER,
  resolved_at          TIMESTAMPTZ,
  resolved_by          UUID REFERENCES users(user_id),
  resolution_notes     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- quizzes ----------
-- max_attempts declared directly (was ALTERed in later on top of the
-- original table).

CREATE TABLE quizzes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id             UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  status              quiz_status NOT NULL DEFAULT 'draft',
  min_questions       INTEGER NOT NULL DEFAULT 6,
  max_attempts        INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts >= 1),
  time_limit_minutes  INTEGER,
  pass_mark_pct       NUMERIC(5,2) NOT NULL DEFAULT 50,
  created_by          UUID REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quizzes_unit_id ON quizzes(unit_id);

CREATE TABLE quiz_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text   TEXT NOT NULL,
  choice_a        TEXT NOT NULL,
  choice_b        TEXT NOT NULL,
  choice_c        TEXT NOT NULL,
  choice_d        TEXT NOT NULL,
  correct_choice  CHAR(1) NOT NULL CHECK (correct_choice IN ('A','B','C','D')),
  marks           NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (marks > 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quiz_id, sort_order)
);

CREATE INDEX idx_quiz_questions_quiz_id ON quiz_questions(quiz_id);

-- Enforce the min-questions rule at the DB level, not just in the app,
-- so a publish can never happen with an incomplete quiz regardless of
-- which code path triggers the status change.
CREATE OR REPLACE FUNCTION enforce_quiz_publish_min_questions()
RETURNS TRIGGER AS $$
DECLARE
  q_count INTEGER;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    SELECT COUNT(*) INTO q_count FROM quiz_questions WHERE quiz_id = NEW.id;
    IF q_count < NEW.min_questions THEN
      RAISE EXCEPTION 'Cannot publish quiz: needs at least % questions (has %)',
        NEW.min_questions, q_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quiz_publish_check
BEFORE UPDATE ON quizzes
FOR EACH ROW EXECUTE FUNCTION enforce_quiz_publish_min_questions();

-- Question-count / mark-total badges for the admin UI.
CREATE OR REPLACE VIEW quiz_overview AS
SELECT
  q.id, q.unit_id, q.title, q.status, q.min_questions,
  COUNT(qq.id)              AS question_count,
  COALESCE(SUM(qq.marks),0) AS total_marks
FROM quizzes q
LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
GROUP BY q.id;

CREATE OR REPLACE VIEW admin_dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM users)                                      AS total_users,
  (SELECT COUNT(*) FROM users
     WHERE created_at >= date_trunc('month', CURRENT_DATE))         AS new_users_this_month,
  (SELECT COUNT(*) FROM learners WHERE status = 'active')           AS active_learners,
  (SELECT COUNT(DISTINCT e.qualification_id)
     FROM enrolments e
     JOIN learners l ON l.learner_id = e.learner_id
     WHERE l.status = 'active' AND e.status = 'active')             AS active_programmes,
  (SELECT COUNT(*) FROM qualifications)                             AS total_qualifications,
  (SELECT COUNT(*) FROM qualifications WHERE is_active = TRUE)      AS active_qualifications,
  (SELECT COUNT(*) FROM qualifications WHERE is_active = FALSE)     AS draft_qualifications,
  (SELECT COUNT(*) FROM enrolments)                                 AS total_enrolments,
  (SELECT COUNT(*) FROM enrolments WHERE status = 'completed')      AS completed_enrolments,
  (SELECT ROUND(
      100.0 * COUNT(*) FILTER (WHERE status = 'completed')
      / NULLIF(COUNT(*), 0), 1)
     FROM enrolments)                                               AS completion_rate_pct;

-- ---------- projects ----------
-- max_attempts declared directly (was ALTERed on later).

CREATE TABLE projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  total_marks       NUMERIC(6,2) NOT NULL CHECK (total_marks > 0),
  duration_days     INTEGER NOT NULL CHECK (duration_days > 0),
  status            project_status NOT NULL DEFAULT 'draft',
  max_attempts      INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts >= 1),
  brief_file_url    TEXT,
  brief_file_name   VARCHAR(255),
  brief_file_size   BIGINT,
  created_by        UUID REFERENCES users(user_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_unit_id ON projects(unit_id);

-- project_submissions is one row per ATTEMPT (attempt_number + started_at
-- declared directly; originally bolted on via ALTER after the table
-- started as one-row-per-learner).
CREATE TABLE project_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  learner_id      UUID NOT NULL REFERENCES learners(learner_id),
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  file_url        TEXT,
  file_name       VARCHAR(255),
  file_size_bytes BIGINT,
  score           NUMERIC(6,2) CHECK (score >= 0),
  graded_by       UUID REFERENCES users(user_id),
  graded_at       TIMESTAMPTZ,
  feedback        TEXT,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending', -- draft | submitted | graded
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, learner_id, attempt_number)
);

CREATE INDEX idx_project_submissions_project_id ON project_submissions(project_id);

-- Only one attempt may be open (draft/submitted, i.e. not yet graded) at
-- a time per learner per project — a learner can't start attempt 2 while
-- attempt 1 is still awaiting a grade.
CREATE UNIQUE INDEX idx_one_open_project_attempt
  ON project_submissions (project_id, learner_id)
  WHERE status IN ('draft', 'submitted');

-- "Recent activity" feed: union of submission/graded/risk/material events, newest first.
CREATE OR REPLACE VIEW admin_recent_activity AS
SELECT
  'submission'::text AS activity_type,
  asub.submitted_at  AS occurred_at,
  format('%s submitted "%s"',
         trim(both ' ' from COALESCE(u.name, '') || ' ' || COALESCE(u.surname, '')),
         a.title)    AS description
FROM assessment_submissions asub
JOIN learners l ON l.learner_id = asub.learner_id
JOIN users    u ON u.user_id    = l.learner_id
JOIN assessments a ON a.id      = asub.assessment_id
WHERE asub.submitted_at IS NOT NULL

UNION ALL

SELECT
  'graded'::text,
  asub.graded_at,
  format('Assessment graded: %s — %s%%',
         trim(both ' ' from COALESCE(u.name, '') || ' ' || COALESCE(u.surname, '')),
         COALESCE(ROUND(asub.score)::text, 'N/A'))
FROM assessment_submissions asub
JOIN learners l ON l.learner_id = asub.learner_id
JOIN users    u ON u.user_id    = l.learner_id
WHERE asub.graded_at IS NOT NULL

UNION ALL

SELECT
  'risk'::text,
  rf.created_at,
  format('%s flagged as at-risk (%s)',
         trim(both ' ' from COALESCE(u.name, '') || ' ' || COALESCE(u.surname, '')),
         rf.risk_level::text)
FROM learner_risk_flags rf
JOIN learners l ON l.learner_id = rf.learner_id
JOIN users    u ON u.user_id    = l.learner_id
WHERE rf.resolved_at IS NULL

UNION ALL

SELECT
  'material'::text,
  m.created_at,
  format('Material uploaded to %s — Unit %s', q.title, un.unit_number)
FROM materials m
JOIN units          un ON un.id = m.unit_id
JOIN qualifications  q ON q.qualification_id = un.qualification_id
WHERE m.is_published = TRUE

ORDER BY occurred_at DESC;

-- ---------- quiz attempts (learner-facing, time-boxed, multi-attempt) ----------

CREATE TABLE quiz_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  learner_id      UUID NOT NULL REFERENCES learners(learner_id),
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,                 -- NULL when the quiz has no time limit
  submitted_at    TIMESTAMPTZ,
  status          quiz_attempt_status NOT NULL DEFAULT 'in_progress',
  score           NUMERIC(6,2),
  total_marks     NUMERIC(6,2),
  score_pct       NUMERIC(5,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quiz_id, learner_id, attempt_number)
);

CREATE INDEX idx_quiz_attempts_learner_id ON quiz_attempts(learner_id);

-- Only one attempt may be in_progress at a time per learner per quiz.
CREATE UNIQUE INDEX idx_one_in_progress_attempt
  ON quiz_attempts (quiz_id, learner_id)
  WHERE status = 'in_progress';

CREATE TABLE quiz_attempt_answers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id      UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  selected_choice  CHAR(1) CHECK (selected_choice IN ('A','B','C','D')),
  is_correct       BOOLEAN,
  marks_awarded    NUMERIC(6,2) NOT NULL DEFAULT 0,
  answered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX idx_quiz_attempt_answers_attempt_id ON quiz_attempt_answers(attempt_id);
CREATE OR REPLACE VIEW learner_grades AS
WITH best_quiz_attempts AS (
  SELECT DISTINCT ON (qa.quiz_id, qa.learner_id)
    qa.quiz_id, qa.learner_id, qa.score
  FROM quiz_attempts qa
  WHERE qa.status IN ('submitted', 'timed_out')
  ORDER BY qa.quiz_id, qa.learner_id, qa.score_pct DESC NULLS LAST, qa.submitted_at ASC
),
learner_quiz_matrix AS (
  SELECT
    e.learner_id, e.qualification_id, q.id AS quiz_id, qo.total_marks AS quiz_total_marks
  FROM enrolments e
  JOIN units u          ON u.qualification_id = e.qualification_id
  JOIN quizzes q        ON q.unit_id = u.id AND q.status = 'published'
  JOIN quiz_overview qo ON qo.id = q.id
  WHERE e.status = 'active'
),
quiz_totals AS (
  SELECT
    m.learner_id, m.qualification_id,
    SUM(COALESCE(bqa.score, 0)) AS earned,
    SUM(m.quiz_total_marks)     AS possible
  FROM learner_quiz_matrix m
  LEFT JOIN best_quiz_attempts bqa ON bqa.quiz_id = m.quiz_id AND bqa.learner_id = m.learner_id
  GROUP BY m.learner_id, m.qualification_id
),
best_project_attempts AS (
  SELECT DISTINCT ON (ps.project_id, ps.learner_id)
    ps.project_id, ps.learner_id, ps.score
  FROM project_submissions ps
  WHERE ps.status = 'graded'
  ORDER BY ps.project_id, ps.learner_id, ps.score DESC NULLS LAST, ps.graded_at ASC
),
learner_project_matrix AS (
  SELECT
    e.learner_id, e.qualification_id, p.id AS project_id, p.total_marks AS project_total_marks
  FROM enrolments e
  JOIN units u    ON u.qualification_id = e.qualification_id
  JOIN projects p ON p.unit_id = u.id AND p.status = 'published'
  WHERE e.status = 'active'
),
project_totals AS (
  SELECT
    m.learner_id, m.qualification_id,
    SUM(COALESCE(bpa.score, 0)) AS earned,
    SUM(m.project_total_marks)  AS possible
  FROM learner_project_matrix m
  LEFT JOIN best_project_attempts bpa ON bpa.project_id = m.project_id AND bpa.learner_id = m.learner_id
  GROUP BY m.learner_id, m.qualification_id
)
SELECT
  COALESCE(qz.learner_id, pj.learner_id)             AS learner_id,
  COALESCE(qz.qualification_id, pj.qualification_id) AS qualification_id,
  ROUND(100.0 * qz.earned / NULLIF(qz.possible, 0), 2) AS quiz_pct,
  ROUND(100.0 * pj.earned / NULLIF(pj.possible, 0), 2) AS project_pct,
  ROUND(
    COALESCE(0.4 * (100.0 * qz.earned / NULLIF(qz.possible, 0)), 0) +
    COALESCE(0.6 * (100.0 * pj.earned / NULLIF(pj.possible, 0)), 0)
  , 2) AS overall_pct
FROM quiz_totals qz
FULL OUTER JOIN project_totals pj
  ON pj.learner_id = qz.learner_id AND pj.qualification_id = qz.qualification_id;

-- One-time backfill so existing enrolments' progress_pct reflects the
-- view above immediately. On a brand-new database this is a no-op
-- (enrolments is empty) — harmless to leave in, safe to drop if you're
-- only ever running this against a fresh DB.
UPDATE enrolments e
SET progress_pct = COALESCE(lg.overall_pct, 0),
    updated_at = NOW()
FROM learner_grades lg
WHERE e.learner_id = lg.learner_id
  AND e.qualification_id = lg.qualification_id
  AND e.status = 'active';

-- ---------- learner-facing compliance/reporting views ----------

CREATE VIEW learner_compliance_profile AS
SELECT
    l.learner_id,
    d.facilitator_id,
    u.name,
    u.surname,
    u.sa_id            AS id_number,
    u.email,
    q.title            AS qualification_title,
    q.nqf_level,
    q.seta,
    d.deal_number,
    d.sponsor,
    e.status           AS enrolment_status,
    e.progress_pct
FROM learners l
JOIN users u                ON u.user_id = l.learner_id
JOIN deals d                 ON d.deal_number = l.deal_number
LEFT JOIN qualifications q  ON q.qualification_id = d.qualification_id
LEFT JOIN enrolments e      ON e.learner_id = l.learner_id
                            AND e.qualification_id = d.qualification_id
WHERE d.is_deleted = FALSE;

CREATE VIEW learner_attendance_log AS
SELECT
    ar.learner_id,
    ar.attendance_date,
    ar.status,
    ar.check_in_time,
    ar.check_out_time,
    ar.geo_verified
FROM attendance_records ar
ORDER BY ar.attendance_date DESC;

CREATE VIEW learner_feedback_history AS
SELECT
    f.to_learner_id AS learner_id,
    f.sent_at,
    f.created_at,
    sender.name     AS sender_name,
    sender.surname  AS sender_surname,
    f.feedback_type,
    f.subject
FROM feedback f
JOIN users sender ON sender.user_id = f.from_user_id
ORDER BY COALESCE(f.sent_at, f.created_at) DESC;

CREATE VIEW learner_unit_grades AS
SELECT
    ps.learner_id,
    un.unit_number,
    p.title                 AS assessment_title,
    ps.submitted_at,
    COALESCE(ps.score, 0)   AS score,
    p.total_marks           AS max_score,
    (ps.status = 'graded')  AS is_graded,
    ps.status                AS submission_status
FROM project_submissions ps
JOIN projects p ON p.id = ps.project_id
JOIN units un   ON un.id = p.unit_id
WHERE ps.status IN ('submitted', 'graded')
ORDER BY un.unit_number, ps.submitted_at DESC;
