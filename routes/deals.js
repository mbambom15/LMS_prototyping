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
      WHERE d.is_deleted = FALSE
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
    // Note: deliberately NOT filtering out soft-deleted deals here —
    // deal numbers should never be reused, even for archived deals,
    // so a deleted deal's number stays retired permanently.
    const next = Math.max(result.rows[0].next_number, 1000);
    res.json({ success: true, next_number: next });
  } catch (err) {
    console.error('GET /api/deals/next-number:', err);
    res.status(500).json({ success: false, message: 'Failed to get next number' });
  }
});

/* ─────────────────────────────────────────
   GET /api/deals/facilitator-overview
   Lightweight list of every (non-archived) deal with its
   current facilitator (if any), for the facilitator
   assignment panel. Split into assigned/unassigned client-side.
───────────────────────────────────────── */
router.get('/api/deals/facilitator-overview', ...guard, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.deal_number,
        d.sponsor,
        q.title AS qualification_title,
        d.facilitator_id,
        uf.name    AS facilitator_name,
        uf.surname AS facilitator_surname
      FROM deals d
      LEFT JOIN qualifications q  ON q.qualification_id = d.qualification_id
      LEFT JOIN facilitators f    ON f.facilitator_id = d.facilitator_id
      LEFT JOIN users uf          ON uf.user_id = f.facilitator_id
      WHERE d.is_deleted = FALSE
      ORDER BY d.deal_number DESC
    `);
    res.json({ success: true, deals: result.rows });
  } catch (err) {
    console.error('GET /api/deals/facilitator-overview:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch deal/facilitator overview' });
  }
});

/* ─────────────────────────────────────────
   GET /api/facilitators/assignable
   Every facilitator with a count of how many (non-archived)
   deals currently point at them. Used to mute/inform the
   picker — facilitators are never blocked from taking on
   another deal, since one facilitator can hold many deals.
───────────────────────────────────────── */
router.get('/api/facilitators/assignable', ...guard, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.user_id AS facilitator_id,
        u.name,
        u.surname,
        u.email,
        COUNT(d.deal_number) FILTER (WHERE d.is_deleted = FALSE)::int AS deals_count
      FROM facilitators f
      JOIN users u ON u.user_id = f.facilitator_id
      LEFT JOIN deals d ON d.facilitator_id = f.facilitator_id
      GROUP BY u.user_id, u.name, u.surname, u.email
      ORDER BY deals_count ASC, u.surname, u.name
    `);
    res.json({ success: true, facilitators: result.rows });
  } catch (err) {
    console.error('GET /api/facilitators/assignable:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch facilitators' });
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
        q.qualification_id,
        d.facilitator_id,
        uf.name    AS facilitator_name,
        uf.surname AS facilitator_surname
      FROM deals d
      LEFT JOIN qualifications q ON q.qualification_id = d.qualification_id
      LEFT JOIN facilitators f   ON f.facilitator_id = d.facilitator_id
      LEFT JOIN users uf         ON uf.user_id = f.facilitator_id
      WHERE d.deal_number = $1 AND d.is_deleted = FALSE
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

   IMPORTANT: every field here is "update only if explicitly provided".
   We distinguish "field not sent" (undefined) from "field sent as empty/null"
   (intentional clear, e.g. clearing the qualification) using a sentinel
   default of `undefined` and a per-field COALESCE-in-JS pattern below.
   This prevents partial-payload PATCH-style calls (like the inline row
   editor, which only sends sponsor/qualification_id/registration_status)
   from silently wiping out start_date or learners_count — the bug that
   was making the start date disappear on every inline edit.
───────────────────────────────────────── */
router.put('/api/deals/:number', ...guard, async (req, res) => {
  const dealNumber = parseInt(req.params.number, 10);
  if (isNaN(dealNumber)) return res.status(400).json({ success: false, message: 'Invalid deal number' });

  const body = req.body || {};

  // Helper: only touch a column if the key was actually present in the
  // request body. This lets callers send a partial payload (e.g. just
  // { sponsor, qualification_id, registration_status }) without nuking
  // columns they didn't mean to touch, while still allowing an explicit
  // null/'' to intentionally clear a field (e.g. unsetting qualification_id).
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  try {
    const result = await pool.query(`
      UPDATE deals SET
        sponsor             = COALESCE($1, sponsor),
        qualification_id    = CASE WHEN $2 THEN $3 ELSE qualification_id END,
        registration_status = CASE WHEN $4 THEN $5 ELSE registration_status END,
        start_date           = CASE WHEN $6 THEN $7 ELSE start_date END,
        learners_count       = CASE WHEN $8 THEN $9 ELSE learners_count END
      WHERE deal_number = $10 AND is_deleted = FALSE
      RETURNING deal_number
    `, [
      body.sponsor?.trim() || null,
      has('qualification_id'), body.qualification_id || null,
      has('registration_status'), body.registration_status || null,
      has('start_date'), body.start_date || null,
      has('learners_count'), body.learners_count || null,
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
   PUT /api/deals/:number/facilitator
   Assign, reassign, or unassign the single facilitator on a
   deal. A facilitator may hold many deals (no uniqueness
   constraint on facilitator_id), but each deal points at only
   one facilitator at a time — so this is a plain overwrite.
   Body: { facilitator_id }  (null/omitted clears the assignment)
───────────────────────────────────────── */
router.put('/api/deals/:number/facilitator', ...guard, async (req, res) => {
  const dealNumber = parseInt(req.params.number, 10);
  if (isNaN(dealNumber)) return res.status(400).json({ success: false, message: 'Invalid deal number' });

  const { facilitator_id } = req.body;

  if (facilitator_id) {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(facilitator_id)) {
      return res.status(400).json({ success: false, message: 'Invalid facilitator ID' });
    }

    // Confirm the ID actually belongs to a facilitator
    const facCheck = await pool.query(
      'SELECT facilitator_id FROM facilitators WHERE facilitator_id = $1',
      [facilitator_id]
    );
    if (!facCheck.rows.length) {
      return res.status(400).json({ success: false, message: 'Facilitator not found' });
    }
  }

  try {
    const result = await pool.query(
      `UPDATE deals SET facilitator_id = $1
       WHERE deal_number = $2 AND is_deleted = FALSE
       RETURNING deal_number`,
      [facilitator_id || null, dealNumber]
    );

    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Deal not found' });

    res.json({
      success: true,
      message: facilitator_id
        ? `Facilitator assigned to deal ${dealNumber}`
        : `Facilitator unassigned from deal ${dealNumber}`,
    });
  } catch (err) {
    console.error('PUT /api/deals/:number/facilitator:', err);
    res.status(500).json({ success: false, message: 'Failed to assign facilitator' });
  }
});

/* ─────────────────────────────────────────
   DELETE /api/deals/:number
   Soft-deletes a deal (marks is_deleted = TRUE, sets deleted_at).
   The row is never physically removed — this preserves the deal
   for SETA audit history. Any learners, facilitators, assessors,
   or enrolments still pointing at this deal are auto-unlinked
   (deal_number set to NULL) so they don't end up silently attached
   to an archived deal. The deal number itself is retired permanently
   and will never be reused by /api/deals/next-number.
───────────────────────────────────────── */
router.delete('/api/deals/:number', ...guard, async (req, res) => {
  const dealNumber = parseInt(req.params.number, 10);
  if (isNaN(dealNumber)) return res.status(400).json({ success: false, message: 'Invalid deal number' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dealCheck = await client.query(
      'SELECT deal_number FROM deals WHERE deal_number = $1 AND is_deleted = FALSE',
      [dealNumber]
    );
    if (!dealCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Deal not found or already removed' });
    }

    // Auto-unlink everyone currently attached to this deal
    const unlinkLearners = await client.query(
      'UPDATE learners SET deal_number = NULL WHERE deal_number = $1',
      [dealNumber]
    );
    await client.query(
      'UPDATE facilitators SET deal_number = NULL WHERE deal_number = $1',
      [dealNumber]
    );
    await client.query(
      'UPDATE assessors SET deal_number = NULL WHERE deal_number = $1',
      [dealNumber]
    );
    await client.query(
      'UPDATE enrolments SET deal_number = NULL WHERE deal_number = $1',
      [dealNumber]
    );

    // Soft-delete the deal itself (facilitator_id stays on the row for
    // audit history — it's archived along with the rest of the deal)
    await client.query(
      `UPDATE deals SET is_deleted = TRUE, deleted_at = NOW() WHERE deal_number = $1`,
      [dealNumber]
    );

    await client.query('COMMIT');

    const unlinkedCount = unlinkLearners.rowCount || 0;
    res.json({
      success: true,
      message: unlinkedCount
        ? `Deal ${dealNumber} archived. ${unlinkedCount} learner(s) were unlinked.`
        : `Deal ${dealNumber} archived.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/deals/:number:', err);
    res.status(500).json({ success: false, message: 'Failed to remove deal' });
  } finally {
    client.release();
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