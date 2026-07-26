// routes/learner-assessments.js
//
// Learner-facing quiz + project assessments.
//   - Quizzes: multiple choice, auto-graded, time-boxed per learner
//     (expires_at is set from THIS learner's started_at, so the
//     countdown shown is always dynamic to them, never a shared clock).
//   - Projects: PDF/ZIP file submission, graded by facilitators later
//     (that grading UI is intentionally not built here — see the
//     "graded" status left as a placeholder in the schema).
//
// Grading weight: quizzes 40%, projects 60% of the qualification grade
// (utils/gradeCalculator.js + the learner_grades view).
//
// Assumes the same session/middleware shape as routes/learner.js:
// req.session.user = { id, email, role }, isAuthenticated, isRole('learner').

const express = require('express');
const multer = require('multer');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');
const { uploadProjectSubmission, getSasUrl, deleteBlob } = require('../utils/blobStorage');
const { getLearnerGrade, syncEnrolmentProgress } = require('../utils/gradeCalculator');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB — projects may bundle real codebases/assets
  fileFilter: (req, file, cb) => {
    const okMime = ['application/pdf', 'application/zip', 'application/x-zip-compressed'];
    const okExt = /\.(pdf|zip)$/i.test(file.originalname);
    if (okMime.includes(file.mimetype) || okExt) return cb(null, true);
    cb(new Error('Only PDF or ZIP files are accepted for project submissions'));
  },
});

/** Resolve the learner's active enrolment (learner_id + qualification_id). */
async function getActiveEnrolment(learnerId) {
  const { rows } = await pool.query(
    `SELECT id AS enrolment_id, qualification_id
     FROM enrolments
     WHERE learner_id = $1 AND status = 'active'
     LIMIT 1`,
    [learnerId]
  );
  return rows[0] || null;
}

// ── GET /api/learner/assessments ────────────────────────────────────
// Everything the learner needs to render the Assessments panel: every
// published quiz/project per unit in their active qualification, plus
// their own attempt/submission status for each (never another learner's).
router.get('/api/learner/assessments', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const enrolment = await getActiveEnrolment(learnerId);
    if (!enrolment) return res.json({ success: true, units: [] });

    const { rows: units } = await pool.query(
      `SELECT id, unit_number, title FROM units
       WHERE qualification_id = $1 ORDER BY unit_number`,
      [enrolment.qualification_id]
    );

    const { rows: quizzes } = await pool.query(
      `SELECT q.id, q.unit_id, q.title, q.description, q.time_limit_minutes, q.pass_mark_pct, q.max_attempts,
              qo.question_count, qo.total_marks
       FROM quizzes q
       JOIN quiz_overview qo ON qo.id = q.id
       JOIN units u ON u.id = q.unit_id
       WHERE u.qualification_id = $1 AND q.status = 'published'`,
      [enrolment.qualification_id]
    );

    const quizIds = quizzes.map(q => q.id);
    const { rows: quizAttempts } = quizIds.length
      ? await pool.query(
          `SELECT quiz_id, id, attempt_number, status, score, score_pct, started_at, expires_at, submitted_at
           FROM quiz_attempts
           WHERE learner_id = $1 AND quiz_id = ANY($2::uuid[])
           ORDER BY quiz_id, attempt_number`,
          [learnerId, quizIds]
        )
      : { rows: [] };
    const attemptsByQuiz = {};
    quizAttempts.forEach(a => { (attemptsByQuiz[a.quiz_id] ||= []).push(a); });

    const { rows: projects } = await pool.query(
      `SELECT p.id, p.unit_id, p.title, p.description, p.total_marks, p.duration_days,
              p.brief_file_name, p.brief_file_url AS brief_blob,
              ps.id AS submission_id, ps.status AS submission_status,
              ps.file_name, ps.file_size_bytes, ps.started_at, ps.submitted_at,
              ps.score, ps.feedback
       FROM projects p
       JOIN units u ON u.id = p.unit_id
       LEFT JOIN project_submissions ps ON ps.project_id = p.id AND ps.learner_id = $2
       WHERE u.qualification_id = $1 AND p.status = 'published'`,
      [enrolment.qualification_id, learnerId]
    );

    const grade = await getLearnerGrade(pool, learnerId, enrolment.qualification_id);

    const unitsOut = units.map(u => ({
      id: u.id,
      unit_number: u.unit_number,
      title: u.title,
      quizzes: quizzes.filter(q => q.unit_id === u.id).map(q => formatQuizForList(q, attemptsByQuiz[q.id] || [])),
      projects: projects.filter(p => p.unit_id === u.id).map(formatProjectForList),
    }));

    res.json({ success: true, units: unitsOut, grade });
  } catch (err) {
    console.error('GET /api/learner/assessments error:', err);
    res.status(500).json({ success: false, message: 'Failed to load assessments' });
  }
});

// Each quiz can carry several attempt rows now (up to max_attempts). The
// learner's grade uses their best completed attempt; the list view needs
// the full history so the UI can show "Attempt 1: 62% · Attempt 2: in
// progress" and offer the right next action (continue / retake / done).
function formatQuizForList(q, attempts) {
  const inProgress = attempts.find(a => a.status === 'in_progress');
  const completed = attempts.filter(a => a.status !== 'in_progress');
  const best = completed.reduce((b, a) => (!b || Number(a.score_pct) > Number(b.score_pct)) ? a : b, null);

  return {
    id: q.id,
    title: q.title,
    description: q.description,
    time_limit_minutes: q.time_limit_minutes,
    pass_mark_pct: Number(q.pass_mark_pct),
    question_count: Number(q.question_count),
    total_marks: Number(q.total_marks),
    max_attempts: q.max_attempts,
    attempts_used: attempts.length,
    can_start_new: !inProgress && attempts.length < q.max_attempts,
    in_progress_attempt: inProgress ? {
      id: inProgress.id, started_at: inProgress.started_at, expires_at: inProgress.expires_at,
    } : null,
    best_score_pct: best ? Number(best.score_pct) : null,
    attempts: attempts.map(a => ({
      attempt_number: a.attempt_number,
      status: a.status,
      score: a.score != null ? Number(a.score) : null,
      score_pct: a.score_pct != null ? Number(a.score_pct) : null,
      submitted_at: a.submitted_at,
    })),
  };
}

function formatProjectForList(p) {
  const deadline = p.started_at
    ? new Date(new Date(p.started_at).getTime() + p.duration_days * 86400000)
    : null;
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    total_marks: Number(p.total_marks),
    duration_days: p.duration_days,
    has_brief: !!p.brief_blob,
    submission: p.submission_id ? {
      id: p.submission_id,
      status: p.submission_status,
      file_name: p.file_name,
      file_size_bytes: p.file_size_bytes,
      started_at: p.started_at,
      deadline_at: deadline,
      submitted_at: p.submitted_at,
      score: p.score != null ? Number(p.score) : null,
      feedback: p.feedback,
    } : null,
  };
}

// ── GET /api/learner/projects/:id/brief ─────────────────────────────
// Signed, time-limited download link for the brief PDF (mirrors the
// materials view/download pattern already used elsewhere).
router.get('/api/learner/projects/:id/brief', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT brief_file_url, brief_file_name FROM projects WHERE id = $1 AND status = 'published'`,
      [req.params.id]
    );
    if (!rows.length || !rows[0].brief_file_url) {
      return res.status(404).json({ success: false, message: 'Brief not found' });
    }
    const url = getSasUrl(rows[0].brief_file_url, { download: true, fileName: rows[0].brief_file_name });
    res.json({ success: true, url, file_name: rows[0].brief_file_name });
  } catch (err) {
    console.error('GET /api/learner/projects/:id/brief error:', err);
    res.status(500).json({ success: false, message: 'Failed to load brief' });
  }
});

// ═══════════════════════ QUIZZES ═══════════════════════

// ── POST /api/learner/quizzes/:id/start ─────────────────────────────
// Creates the attempt (or returns the existing one — idempotent, so a
// page refresh mid-quiz never wipes progress or resets the clock).
// expires_at is computed from NOW(), i.e. from THIS learner's start —
// this is what makes the countdown dynamic per learner.
router.post('/api/learner/quizzes/:id/start', isAuthenticated, isRole('learner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const learnerId = req.session.user.id;
    const quizId = req.params.id;

    const { rows: quizRows } = await client.query(
      `SELECT q.id, q.title, q.description, q.time_limit_minutes, q.pass_mark_pct, q.max_attempts, u.qualification_id
       FROM quizzes q JOIN units u ON u.id = q.unit_id
       WHERE q.id = $1 AND q.status = 'published'`,
      [quizId]
    );
    if (!quizRows.length) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const quiz = quizRows[0];

    const enrolment = await getActiveEnrolment(learnerId);
    if (!enrolment || enrolment.qualification_id !== quiz.qualification_id) {
      return res.status(403).json({ success: false, message: 'This quiz is not part of your qualification' });
    }

    const { rows: existingAttempts } = await client.query(
      `SELECT * FROM quiz_attempts WHERE quiz_id = $1 AND learner_id = $2 ORDER BY attempt_number`,
      [quizId, learnerId]
    );

    let attempt = existingAttempts.find(a => a.status === 'in_progress');

    if (!attempt) {
      if (existingAttempts.length >= quiz.max_attempts) {
        return res.status(409).json({
          success: false,
          message: `No attempts remaining — you've used all ${quiz.max_attempts} attempt${quiz.max_attempts === 1 ? '' : 's'} for this quiz`,
        });
      }
      const expiresAt = quiz.time_limit_minutes
        ? new Date(Date.now() + quiz.time_limit_minutes * 60000)
        : null;
      const nextAttemptNumber = existingAttempts.length + 1;
      const inserted = await client.query(
        `INSERT INTO quiz_attempts (quiz_id, learner_id, attempt_number, expires_at)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [quizId, learnerId, nextAttemptNumber, expiresAt]
      );
      attempt = inserted.rows[0];
    }

    const { rows: questions } = await client.query(
      `SELECT id, question_text, choice_a, choice_b, choice_c, choice_d, marks, sort_order
       FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order`,
      [quizId]
    ); // correct_choice intentionally excluded — never sent to the client

    const { rows: answered } = await client.query(
      `SELECT question_id, selected_choice FROM quiz_attempt_answers WHERE attempt_id = $1`,
      [attempt.id]
    );

    res.json({
      success: true,
      quiz: { id: quiz.id, title: quiz.title, description: quiz.description, pass_mark_pct: Number(quiz.pass_mark_pct), max_attempts: quiz.max_attempts },
      attempt: { id: attempt.id, attempt_number: attempt.attempt_number, started_at: attempt.started_at, expires_at: attempt.expires_at, status: attempt.status },
      questions,
      answers: answered, // so a refreshed page can restore already-selected choices
    });
  } catch (err) {
    console.error('POST /api/learner/quizzes/:id/start error:', err);
    res.status(500).json({ success: false, message: 'Failed to start quiz' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/learner/quizzes/:id/attempt/answer ───────────────────
// Saves/updates one answer at a time — matches the "Confirm Answer"
// per-question flow. Rejected once time is up or the attempt is closed.
router.patch('/api/learner/quizzes/:id/attempt/answer', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { question_id, selected_choice } = req.body || {};

    if (!question_id || !['A', 'B', 'C', 'D'].includes(selected_choice)) {
      return res.status(400).json({ success: false, message: 'A valid question and choice are required' });
    }

    const { rows: attemptRows } = await pool.query(
      `SELECT * FROM quiz_attempts WHERE quiz_id = $1 AND learner_id = $2 AND status = 'in_progress'`,
      [req.params.id, learnerId]
    );
    if (!attemptRows.length) return res.status(404).json({ success: false, message: 'No attempt in progress — start the quiz first' });
    const attempt = attemptRows[0];

    if (attempt.expires_at && new Date() > new Date(attempt.expires_at)) {
      return res.status(410).json({ success: false, message: 'Time is up for this quiz' });
    }

    await pool.query(
      `INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_choice)
       VALUES ($1, $2, $3)
       ON CONFLICT (attempt_id, question_id)
       DO UPDATE SET selected_choice = EXCLUDED.selected_choice, answered_at = NOW()`,
      [attempt.id, question_id, selected_choice]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH .../attempt/answer error:', err);
    res.status(500).json({ success: false, message: 'Failed to save answer' });
  }
});

// ── POST /api/learner/quizzes/:id/submit ────────────────────────────
// Auto-grades every answered question against correct_choice; anything
// left unanswered scores 0. Marked 'timed_out' instead of 'submitted'
// if this lands after expires_at (still graded — a learner shouldn't
// lose credit for answers they saved before time ran out).
router.post('/api/learner/quizzes/:id/submit', isAuthenticated, isRole('learner'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const learnerId = req.session.user.id;

    const { rows: attemptRows } = await client.query(
      `SELECT * FROM quiz_attempts WHERE quiz_id = $1 AND learner_id = $2 AND status = 'in_progress' FOR UPDATE`,
      [req.params.id, learnerId]
    );
    if (!attemptRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'No attempt in progress — start the quiz first' });
    }
    const attempt = attemptRows[0];

    const timedOut = attempt.expires_at && new Date() > new Date(attempt.expires_at);

    const { rows: questions } = await client.query(
      `SELECT id, correct_choice, marks FROM quiz_questions WHERE quiz_id = $1`,
      [req.params.id]
    );
    const { rows: answers } = await client.query(
      `SELECT question_id, selected_choice FROM quiz_attempt_answers WHERE attempt_id = $1`,
      [attempt.id]
    );
    const answerMap = new Map(answers.map(a => [a.question_id, a.selected_choice]));

    let score = 0;
    let totalMarks = 0;
    for (const q of questions) {
      totalMarks += Number(q.marks);
      const selected = answerMap.get(q.id);
      const isCorrect = selected === q.correct_choice;
      const awarded = isCorrect ? Number(q.marks) : 0;
      score += awarded;
      await client.query(
        `INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_choice, is_correct, marks_awarded)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET is_correct = EXCLUDED.is_correct, marks_awarded = EXCLUDED.marks_awarded`,
        [attempt.id, q.id, selected || null, selected ? isCorrect : null, awarded]
      );
    }

    const scorePct = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;

    const { rows: updated } = await client.query(
      `UPDATE quiz_attempts
       SET status = $1, submitted_at = NOW(), score = $2, total_marks = $3, score_pct = $4
       WHERE id = $5 RETURNING *`,
      [timedOut ? 'timed_out' : 'submitted', score, totalMarks, scorePct, attempt.id]
    );

    // Report attempt usage alongside the grade so the learner sees remaining
    // attempts immediately, without a second round trip.
    const { rows: usageRows } = await client.query(
      `SELECT
         (SELECT max_attempts FROM quizzes WHERE id = $1) AS max_attempts,
         (SELECT COUNT(*)::int FROM quiz_attempts WHERE quiz_id = $1 AND learner_id = $2) AS attempts_used`,
      [req.params.id, learnerId]
    );
    const { max_attempts: maxAttempts, attempts_used: attemptsUsed } = usageRows[0];

    await client.query('COMMIT');

    // Push the new weighted grade into enrolments.progress_pct so the
    // dashboard's progress bar reflects it immediately. Runs after COMMIT,
    // not inside the transaction — this is a derived value, and a sync
    // hiccup here should never roll back an otherwise-valid grade.
    const enrolment = await getActiveEnrolment(learnerId);
    if (enrolment) {
      try {
        await syncEnrolmentProgress(pool, learnerId, enrolment.qualification_id);
      } catch (syncErr) {
        console.error('syncEnrolmentProgress error (grade was still saved):', syncErr);
      }
    }
    res.json({
      success: true,
      attempt: updated[0],
      max_attempts: maxAttempts,
      attempts_used: attemptsUsed,
      attempts_remaining: Math.max(0, maxAttempts - attemptsUsed),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/learner/quizzes/:id/submit error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit quiz' });
  } finally {
    client.release();
  }
});

// ═══════════════════════ PROJECTS ═══════════════════════

// ── POST /api/learner/projects/:id/upload ───────────────────────────
// Uploads straight to blob on file select (not just on final Submit) —
// per the brief, evidence must be preserved in blob storage tied to the
// learner's id as soon as it exists, not held only in browser memory.
// A prior draft file (if any) is replaced: old blob deleted, new one
// stored, row upserted. started_at is set once, on the FIRST upload,
// so the per-learner project deadline (duration_days) begins ticking then.
router.post('/api/learner/projects/:id/upload', isAuthenticated, isRole('learner'), upload.single('file'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const projectId = req.params.id;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

    const { rows: projectRows } = await pool.query(
      `SELECT p.id, u.qualification_id FROM projects p
       JOIN units u ON u.id = p.unit_id
       WHERE p.id = $1 AND p.status = 'published'`,
      [projectId]
    );
    if (!projectRows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    const enrolment = await getActiveEnrolment(learnerId);
    if (!enrolment || enrolment.qualification_id !== projectRows[0].qualification_id) {
      return res.status(403).json({ success: false, message: 'This project is not part of your qualification' });
    }

    const { rows: existingRows } = await pool.query(
      `SELECT * FROM project_submissions WHERE project_id = $1 AND learner_id = $2`,
      [projectId, learnerId]
    );
    const existing = existingRows[0];
    if (existing && existing.status !== 'draft') {
      return res.status(409).json({ success: false, message: 'This project has already been submitted' });
    }

    const blobName = await uploadProjectSubmission(projectId, learnerId, req.file);
    if (existing?.file_url) {
      await deleteBlob(existing.file_url).catch(() => {}); // best-effort cleanup of the replaced draft
    }

    const { rows: saved } = await pool.query(
      `INSERT INTO project_submissions (project_id, learner_id, file_url, file_name, file_size_bytes, started_at, status)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), 'draft')
       ON CONFLICT (project_id, learner_id) DO UPDATE SET
         file_url = EXCLUDED.file_url,
         file_name = EXCLUDED.file_name,
         file_size_bytes = EXCLUDED.file_size_bytes,
         status = 'draft'
       RETURNING *`,
      [projectId, learnerId, blobName, req.file.originalname, req.file.size, existing?.started_at || null]
    );

    res.json({ success: true, submission: saved[0] });
  } catch (err) {
    console.error('POST /api/learner/projects/:id/upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
});

// ── DELETE /api/learner/projects/:id/upload ─────────────────────────
// Removes the staged file before final submission — allowed only while
// status = 'draft'. Deletes the blob too, since the whole point of the
// "no evidence lost" requirement is about submitted work, not drafts
// the learner explicitly chose to discard before pressing Submit.
router.delete('/api/learner/projects/:id/upload', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { rows } = await pool.query(
      `SELECT * FROM project_submissions WHERE project_id = $1 AND learner_id = $2`,
      [req.params.id, learnerId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'No submission found' });
    const submission = rows[0];
    if (submission.status !== 'draft') {
      return res.status(409).json({ success: false, message: 'Submitted work cannot be removed' });
    }

    if (submission.file_url) await deleteBlob(submission.file_url).catch(() => {});
    await pool.query(
      `UPDATE project_submissions SET file_url = NULL, file_name = NULL, file_size_bytes = NULL WHERE id = $1`,
      [submission.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/learner/projects/:id/upload error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove file' });
  }
});

// ── POST /api/learner/projects/:id/submit ───────────────────────────
// Locks the submission in. Requires a file already staged via /upload.
router.post('/api/learner/projects/:id/submit', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { rows } = await pool.query(
      `SELECT * FROM project_submissions WHERE project_id = $1 AND learner_id = $2`,
      [req.params.id, learnerId]
    );
    if (!rows.length || !rows[0].file_url) {
      return res.status(400).json({ success: false, message: 'Upload a file before submitting' });
    }
    const submission = rows[0];
    if (submission.status !== 'draft') {
      return res.status(409).json({ success: false, message: 'This project has already been submitted' });
    }

    const { rows: updated } = await pool.query(
      `UPDATE project_submissions SET status = 'submitted', submitted_at = NOW() WHERE id = $1 RETURNING *`,
      [submission.id]
    );

    res.json({ success: true, submission: updated[0] });
  } catch (err) {
    console.error('POST /api/learner/projects/:id/submit error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit project' });
  }
});

// ── GET /api/learner/grades ──────────────────────────────────────────
router.get('/api/learner/grades', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const enrolment = await getActiveEnrolment(learnerId);
    if (!enrolment) return res.json({ success: true, grade: null });
    const grade = await getLearnerGrade(pool, learnerId, enrolment.qualification_id);
    res.json({ success: true, grade });
  } catch (err) {
    console.error('GET /api/learner/grades error:', err);
    res.status(500).json({ success: false, message: 'Failed to load grades' });
  }
});

module.exports = router;