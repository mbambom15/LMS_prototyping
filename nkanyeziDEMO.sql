
DROP TYPE IF EXISTS user_role, user_status, nqf_level, attendance_status, material_type, assessment_type, feedback_type, risk_level CASCADE;
CREATE TYPE user_role AS ENUM (
  'learner',
  'facilitator',
  'assessor',
  'admin'
);

CREATE TYPE user_status AS ENUM (
  'active',
  'inactive',
  'suspended',
  'completed',
  'terminated'
);

CREATE TYPE nqf_level AS ENUM (
  'NQF1', 'NQF2', 'NQF3', 'NQF4', 'NQF5',
  'NQF6', 'NQF7', 'NQF8', 'NQF9', 'NQF10'
);

CREATE TYPE attendance_status AS ENUM (
  'present', 'absent', 'late', 'excused'
);

CREATE TYPE material_type AS ENUM (
  'document', 'video', 'link', 'assessment_guide', 'other'
);

CREATE TYPE assessment_type AS ENUM (
  'formative', 'summative', 'practical', 'portfolio'
);

CREATE TYPE feedback_type AS ENUM (
  'general', 'progress', 'attendance', 'assessment', 'risk'
);

CREATE TYPE risk_level AS ENUM (
  'low', 'medium', 'high'
);

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
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE learners (
  learner_id   UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  status       user_status NOT NULL DEFAULT 'active',
  deal_number  INTEGER           
);

CREATE TABLE facilitators (
  facilitator_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  deal_number    INTEGER           
);

CREATE TABLE assessors (
  assessor_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  deal_number INTEGER          
);

CREATE TABLE qualifications (
  qualification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            VARCHAR(255) NOT NULL,
  nqf_level        nqf_level NOT NULL,
  seta             VARCHAR(255) NOT NULL,
  duration_months  INT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_id       UUID NOT NULL REFERENCES qualifications(qualification_id)
                          ON DELETE CASCADE,
  unit_number            INTEGER NOT NULL,
  title                  VARCHAR(255) NOT NULL,
  description            TEXT,
  credits                INTEGER,
  expected_duration_weeks INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (qualification_id, unit_number)
);

CREATE TABLE deals (
  deal_number        INTEGER PRIMARY KEY,
  sponsor            VARCHAR(255),
  qualification_id   UUID REFERENCES qualifications(qualification_id), 
  registration_status VARCHAR(255),
  learners_count     INTEGER,
  start_date         DATE
);


ALTER TABLE learners ADD FOREIGN KEY (deal_number) REFERENCES deals(deal_number)
  ON DELETE SET NULL;   

ALTER TABLE facilitators ADD FOREIGN KEY (deal_number) REFERENCES deals(deal_number)
  ON DELETE SET NULL;

ALTER TABLE assessors ADD FOREIGN KEY (deal_number) REFERENCES deals(deal_number)
  ON DELETE SET NULL;

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
  progress_pct       NUMERIC(5,2) NOT NULL DEFAULT 0
                     CHECK (progress_pct BETWEEN 0 AND 100),
  employer_name      VARCHAR(255),          -- host employer
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
  progress_pct    NUMERIC(5,2) NOT NULL DEFAULT 0
                  CHECK (progress_pct BETWEEN 0 AND 100),
  UNIQUE (enrolment_id, unit_id)
);



CREATE TABLE attendance_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_id UUID NOT NULL REFERENCES qualifications(qualification_id),
  facilitator_id   UUID REFERENCES facilitators(facilitator_id),
  session_date     DATE NOT NULL,
  session_label    VARCHAR(100),
  start_time       TIME,
  end_time         TIME,
  venue            VARCHAR(255),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  learner_id        UUID NOT NULL REFERENCES learners(learner_id),
  status            attendance_status NOT NULL DEFAULT 'absent',
  check_in_time     TIMESTAMPTZ,
  geo_latitude      NUMERIC(10,7),
  geo_longitude     NUMERIC(10,7),
  geo_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  geo_distance_km   NUMERIC(8,4),
  venue_latitude    NUMERIC(10,7),
  venue_longitude   NUMERIC(10,7),
  captured_by       UUID REFERENCES users(user_id),       
  capture_method    VARCHAR(50) DEFAULT 'manual',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, learner_id)
);

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

CREATE TABLE assessment_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  learner_id      UUID NOT NULL REFERENCES learners(learner_id),
  submitted_at    TIMESTAMPTZ,
  score           NUMERIC(6,2) CHECK (score >= 0),
  graded_by       UUID REFERENCES assessors(assessor_id),
  graded_at       TIMESTAMPTZ,
  feedback        TEXT,
  file_url        TEXT,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',   
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, learner_id)
);


CREATE TABLE feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id      UUID NOT NULL REFERENCES users(user_id),
  to_learner_id     UUID NOT NULL REFERENCES learners(learner_id),
  enrolment_id      UUID REFERENCES enrolments(id),
  feedback_type     feedback_type NOT NULL DEFAULT 'general',
  subject           VARCHAR(255),
  message           TEXT NOT NULL,
  is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at           TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  delivery_method   VARCHAR(50) DEFAULT 'portal',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



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




