const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CHOICES = ['A', 'B', 'C', 'D'];

function validQuestionPayload(b) {
  if (!b.question_text?.trim()) return 'Question text is required';
  for (const c of ['choice_a', 'choice_b', 'choice_c', 'choice_d']) {
    if (!b[c]?.trim()) return `${c.replace('choice_', 'Choice ').toUpperCase()} is required`;
  }
  if (!VALID_CHOICES.includes(b.correct_choice)) return 'correct_choice must be A, B, C or D';
  if (b.marks !== undefined && (Number.isNaN(Number(b.marks)) || Number(b.marks) <= 0)) {
    return 'Marks must be a positive number';
  }
  return null;
}

/* ── LIST quizzes for a unit (admin) ── */
router.get('/api/units/:unitId/quizzes', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { unitId } = req.params;
    if (!uuidRe.test(unitId)) return res.status(400).json({ success: false, message: 'Invalid unit ID' });

    const result = await pool.query(
      `SELECT q.id, q.title, q.description, q.status, q.min_questions,
              q.time_limit_minutes, q.pass_mark_pct, q.created_at,
              COUNT(qq.id)::int AS question_count,
              COALESCE(SUM(qq.marks),0) AS total_marks
         FROM quizzes q
         LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
        WHERE q.unit_id = $1
        GROUP BY q.id
        ORDER BY q.created_at DESC`,
      [unitId]
    );
    res.json({ success: true, quizzes: result.rows });
  } catch (err) {
    console.error('GET /api/units/:unitId/quizzes error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch quizzes' });
  }
});

/* ── CREATE quiz (admin) ── */
router.post('/api/units/:unitId/quizzes', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { unitId } = req.params;
    if (!uuidRe.test(unitId)) return res.status(400).json({ success: false, message: 'Invalid unit ID' });

    const { title, description, time_limit_minutes, pass_mark_pct } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Quiz title is required' });

    const result = await pool.query(
      `INSERT INTO quizzes (unit_id, title, description, time_limit_minutes, pass_mark_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [unitId, title.trim(), description?.trim() || null,
        time_limit_minutes || null, pass_mark_pct || 50, req.session.user.id]
    );
    res.json({ success: true, quizId: result.rows[0].id, message: 'Quiz created' });
  } catch (err) {
    console.error('POST /api/units/:unitId/quizzes error:', err);
    res.status(500).json({ success: false, message: 'Failed to create quiz' });
  }
});

/* ── GET single quiz + its questions (admin) ── */
router.get('/api/quizzes/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });

    const quizResult = await pool.query(`SELECT * FROM quizzes WHERE id = $1`, [id]);
    if (!quizResult.rows.length) return res.status(404).json({ success: false, message: 'Quiz not found' });

    const questionsResult = await pool.query(
      `SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );
    res.json({ success: true, quiz: quizResult.rows[0], questions: questionsResult.rows });
  } catch (err) {
    console.error('GET /api/quizzes/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch quiz' });
  }
});

/* ── UPDATE quiz metadata (admin) ── */
router.put('/api/quizzes/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });

    const { title, description, time_limit_minutes, pass_mark_pct } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Quiz title is required' });

    await pool.query(
      `UPDATE quizzes SET title=$1, description=$2, time_limit_minutes=$3,
              pass_mark_pct=$4, updated_at=NOW()
       WHERE id=$5`,
      [title.trim(), description?.trim() || null, time_limit_minutes || null, pass_mark_pct || 50, id]
    );
    res.json({ success: true, message: 'Quiz updated' });
  } catch (err) {
    console.error('PUT /api/quizzes/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update quiz' });
  }
});

/* ── PUBLISH / UNPUBLISH / ARCHIVE (admin) ── */
router.patch('/api/quizzes/:id/status', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    await pool.query(`UPDATE quizzes SET status=$1, updated_at=NOW() WHERE id=$2`, [status, id]);
    res.json({ success: true, message: `Quiz set to ${status}` });
  } catch (err) {
    // The DB trigger raises a plain exception on an incomplete publish attempt
    console.error('PATCH /api/quizzes/:id/status error:', err);
    const message = err.message?.includes('Cannot publish quiz')
      ? err.message
      : 'Failed to update quiz status';
    res.status(400).json({ success: false, message });
  }
});

/* ── DELETE quiz (admin) ── */
router.delete('/api/quizzes/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });
    await pool.query(`DELETE FROM quizzes WHERE id = $1`, [id]);
    res.json({ success: true, message: 'Quiz deleted' });
  } catch (err) {
    console.error('DELETE /api/quizzes/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete quiz' });
  }
});

/* ── ADD question (admin) ── */
router.post('/api/quizzes/:id/questions', isAuthenticated, isRole('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });

    const err = validQuestionPayload(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { question_text, choice_a, choice_b, choice_c, choice_d, correct_choice, marks } = req.body;

    await client.query('BEGIN');
    const nextOrder = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM quiz_questions WHERE quiz_id = $1`,
      [id]
    );
    const result = await client.query(
      `INSERT INTO quiz_questions
         (quiz_id, question_text, choice_a, choice_b, choice_c, choice_d, correct_choice, marks, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [id, question_text.trim(), choice_a.trim(), choice_b.trim(), choice_c.trim(), choice_d.trim(),
        correct_choice, marks || 1, nextOrder.rows[0].next]
    );
    await client.query('COMMIT');
    res.json({ success: true, questionId: result.rows[0].id, message: 'Question added' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /api/quizzes/:id/questions error:', e);
    res.status(500).json({ success: false, message: 'Failed to add question' });
  } finally {
    client.release();
  }
});

/* ── EDIT question (admin) ── */
router.put('/api/questions/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid question ID' });

    const err = validQuestionPayload(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { question_text, choice_a, choice_b, choice_c, choice_d, correct_choice, marks } = req.body;
    await pool.query(
      `UPDATE quiz_questions
       SET question_text=$1, choice_a=$2, choice_b=$3, choice_c=$4, choice_d=$5,
           correct_choice=$6, marks=$7, updated_at=NOW()
       WHERE id=$8`,
      [question_text.trim(), choice_a.trim(), choice_b.trim(), choice_c.trim(), choice_d.trim(),
        correct_choice, marks || 1, id]
    );
    res.json({ success: true, message: 'Question updated' });
  } catch (err) {
    console.error('PUT /api/questions/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update question' });
  }
});

/* ── DELETE question (admin) ── */
router.delete('/api/questions/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid question ID' });
    await pool.query(`DELETE FROM quiz_questions WHERE id = $1`, [id]);
    res.json({ success: true, message: 'Question deleted' });
  } catch (err) {
    console.error('DELETE /api/questions/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete question' });
  }
});

module.exports = router;