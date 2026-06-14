const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

const guard = [isAuthenticated, isRole('admin')];

/* ─────────────────────────────────────────
   GET /api/deals
   List all deals with learner count + qual title
───────────────────────────────────────── */
router.get('/api/deals', ...guard, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.deal_number,
        d.sponsor,
        d.registration_status,
        d.learners_count,
        d.start_date,
        q.title          AS qualification_title,
        q.nqf_level,
        q.qualification_id,
        COUNT(DISTINCT l.learner_id)::int AS linked_learners
      FROM deals d
      LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
      LEFT JOIN learners l ON l.deal_number = d.deal_number
      GROUP BY d.deal_number, q.title, q.nqf_level, q.qualification_id
      ORDER BY d.deal_number DESC
    `);
    res.json({ success: true, deals: result.rows });
  } catch (err) {
    console.error('GET /api/deals:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch deals' });
  }
});

/* ─────────────────────────────────────────
   GET /api/deals/next-number
   Returns the next available deal number (1000+)
───────────────────────────────────────── */
router.get('/api/deals/next-number', ...guard, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(MAX(deal_number), 999) + 1 AS next_number FROM deals
    `);
    const next = Math.max(result.rows[0].next_number, 1000);
    res.json({ success: true, next_number: next });
  } catch (err) {
    console.error('GET /api/deals/next-number:', err);
    res.status(500).json({ success: false, message: 'Failed to get next number' });
  }
});

/* ─────────────────────────────────────────
   GET /api/deals/:number
   Single deal with linked learner details
───────────────────────────────────────── */
router.get('/api/deals/:number', ...guard, async (req, res) => {
  const dealNumber = parseInt(req.params.number, 10);
  if (isNaN(dealNumber)) return res.status(400).json({ success: false, message: 'Invalid deal number' });

  try {
    const dealRes = await pool.query(`
      SELECT
        d.deal_number,
        d.sponsor,
        d.registration_status,
        d.learners_count,
        d.start_date,
        q.title       AS qualification_title,
        q.nqf_level,
        q.qualification_id
      FROM deals d
      LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
      WHERE d.deal_number = $1
    `, [dealNumber]);

    if (!dealRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }

    const learnersRes = await pool.query(`
      SELECT
        u.user_id,
        u.name,
        u.surname,
        u.email,
        u.status,
        e.progress_pct,
        e.start_date AS enrolment_start
      FROM learners l
      JOIN users u ON u.user_id = l.learner_id
      LEFT JOIN enrolments e ON e.learner_id = l.learner_id
      WHERE l.deal_number = $1
      ORDER BY u.surname, u.name
    `, [dealNumber]);

    res.json({
      success:  true,
      deal:     dealRes.rows[0],
      learners: learnersRes.rows,
    });
  } catch (err) {
    console.error('GET /api/deals/:number:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch deal' });
  }
});

/* ─────────────────────────────────────────
   POST /api/deals
   Create a new deal
───────────────────────────────────────── */
router.post('/api/deals', ...guard, async (req, res) => {
  const { deal_number, sponsor, qualification_id, registration_status, start_date, learners_count } = req.body;

  if (!deal_number || !sponsor) {
    return res.status(400).json({ success: false, message: 'Deal number and sponsor name are required' });
  }
  if (deal_number < 1000) {
    return res.status(400).json({ success: false, message: 'Deal number must be 1000 or higher' });
  }

  try {
    await pool.query(`
      INSERT INTO deals (deal_number, sponsor, qualification_id, registration_status, start_date, learners_count)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      deal_number,
      sponsor.trim(),
      qualification_id || null,
      registration_status || null,
      start_date || null,
      learners_count || null,
    ]);

    res.json({ success: true, message: 'Deal created successfully', deal_number });
  } catch (err) {
    console.error('POST /api/deals:', err);
    if (err.code === '23505') {
      return res.status(400).json({ success: false, message: `Deal number ${deal_number} already exists` });
    }
    res.status(500).json({ success: false, message: 'Failed to create deal' });
  }
});

/* ─────────────────────────────────────────
   PUT /api/deals/:number
   Update deal fields
───────────────────────────────────────── */
router.put('/api/deals/:number', ...guard, async (req, res) => {
  const dealNumber = parseInt(req.params.number, 10);
  if (isNaN(dealNumber)) return res.status(400).json({ success: false, message: 'Invalid deal number' });

  const { sponsor, qualification_id, registration_status, start_date, learners_count } = req.body;

  try {
    const result = await pool.query(`
      UPDATE deals SET
        sponsor             = COALESCE($1, sponsor),
        qualification_id    = $2,
        registration_status = COALESCE($3, registration_status),
        start_date          = $4,
        learners_count      = COALESCE($5, learners_count)
      WHERE deal_number = $6
      RETURNING deal_number
    `, [
      sponsor?.trim() || null,
      qualification_id || null,
      registration_status || null,
      start_date || null,
      learners_count || null,
      dealNumber,
    ]);

    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Deal not found' });
    res.json({ success: true, message: 'Deal updated' });
  } catch (err) {
    console.error('PUT /api/deals/:number:', err);
    res.status(500).json({ success: false, message: 'Failed to update deal' });
  }
});

/* ─────────────────────────────────────────
   POST /api/deals/:number/learners
   Link learners to a deal (replaces existing links for those learners)
   Body: { learner_ids: [uuid, ...] }
───────────────────────────────────────── */
router.post('/api/deals/:number/learners', ...guard, async (req, res) => {
  const dealNumber = parseInt(req.params.number, 10);
  if (isNaN(dealNumber)) return res.status(400).json({ success: false, message: 'Invalid deal number' });

  const { learner_ids } = req.body;
  if (!Array.isArray(learner_ids) || !learner_ids.length) {
    return res.status(400).json({ success: false, message: 'No learners selected' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify deal exists
    const dealCheck = await client.query('SELECT deal_number FROM deals WHERE deal_number = $1', [dealNumber]);
    if (!dealCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }

    // Assign each learner to this deal
    for (const learner_id of learner_ids) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(learner_id)) continue;

      await client.query(`
        UPDATE learners SET deal_number = $1 WHERE learner_id = $2
      `, [dealNumber, learner_id]);

      // Also update facilitators / assessors if they're linked to this deal
      await client.query(`
        UPDATE enrolments SET deal_number = $1
        WHERE learner_id = $2 AND deal_number IS NULL
      `, [dealNumber, learner_id]);
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `${learner_ids.length} learner(s) linked to deal ${dealNumber}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/deals/:number/learners:', err);
    res.status(500).json({ success: false, message: 'Failed to link learners' });
  } finally {
    client.release();
  }
});

/* ─────────────────────────────────────────
   DELETE /api/deals/:number/learners/:learnerId
   Unlink a single learner from a deal
───────────────────────────────────────── */
router.delete('/api/deals/:number/learners/:learnerId', ...guard, async (req, res) => {
  const dealNumber = parseInt(req.params.number, 10);
  const { learnerId } = req.params;

  try {
    await pool.query(`UPDATE learners SET deal_number = NULL WHERE learner_id = $1 AND deal_number = $2`, [learnerId, dealNumber]);
    res.json({ success: true, message: 'Learner unlinked from deal' });
  } catch (err) {
    console.error('DELETE /api/deals/:number/learners/:learnerId:', err);
    res.status(500).json({ success: false, message: 'Failed to unlink learner' });
  }
});

/* ─────────────────────────────────────────
   GET /api/learners/unlinked
   Learners not yet assigned to any deal (for the link panel)
───────────────────────────────────────── */
router.get('/api/learners/available', ...guard, async (req, res) => {
  const { search } = req.query;
  try {
    let query = `
      SELECT
        u.user_id,
        u.name,
        u.surname,
        u.email,
        l.deal_number AS current_deal
      FROM learners l
      JOIN users u ON u.user_id = l.learner_id
      WHERE u.status != 'terminated'
    `;
    const params = [];

    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` AND (u.name ILIKE $1 OR u.surname ILIKE $1 OR u.email ILIKE $1)`;
    }

    query += ` ORDER BY u.surname, u.name LIMIT 100`;

    const result = await pool.query(query, params);
    res.json({ success: true, learners: result.rows });
  } catch (err) {
    console.error('GET /api/learners/available:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch learners' });
  }
});

module.exports = router;