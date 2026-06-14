const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');

const guard = [isAuthenticated, isRole('admin')];

/* ══════════════════════════════════════════════════════════
   GET /api/qualifications  — list all qualifications
   Returns: id, title, nqf_level, seta, duration_months,
            is_active, enrolled_count, unit_count
══════════════════════════════════════════════════════════ */
router.get('/api/qualifications', guard, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        q.qualification_id  AS id,
        q.title,
        q.nqf_level,
        q.seta,
        q.duration_months,
        q.is_active,
        q.created_at,
        COUNT(DISTINCT e.id)::INT         AS enrolled_count,
        COUNT(DISTINCT u.id)::INT         AS unit_count
      FROM qualifications q
      LEFT JOIN enrolments e
        ON e.qualification_id = q.qualification_id
        AND e.status NOT IN ('terminated','completed')
      LEFT JOIN units u
        ON u.qualification_id = q.qualification_id
      GROUP BY q.qualification_id
      ORDER BY q.created_at DESC
    `);
    res.json({ success: true, qualifications: result.rows });
  } catch (err) {
    console.error('GET /api/qualifications:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch qualifications' });
  }
});

/* ══════════════════════════════════════════════════════════
   POST /api/qualifications  — create qualification + units
   Body: title, nqf_level, seta, duration_months,
         description, unit_count, total_credits, is_active?
══════════════════════════════════════════════════════════ */
router.post('/api/qualifications', guard, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      title, nqf_level, seta, duration_months,
      description, unit_count, total_credits,
      is_active = true
    } = req.body;

    if (!title?.trim() || !nqf_level || !seta?.trim() || !duration_months) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const unitsN = parseInt(unit_count, 10) || 0;
    const creditsEach = unitsN > 0
      ? Math.floor((parseInt(total_credits, 10) || 0) / unitsN)
      : 0;

    await client.query('BEGIN');

    const qualRes = await client.query(`
      INSERT INTO qualifications (title, nqf_level, seta, duration_months, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING qualification_id
    `, [title.trim(), nqf_level, seta.trim(), parseInt(duration_months, 10), is_active]);

    const qualId = qualRes.rows[0].qualification_id;

    // Create stub units (Unit 1 … N)
    for (let i = 1; i <= unitsN; i++) {
      await client.query(`
        INSERT INTO units (qualification_id, unit_number, title, description, credits)
        VALUES ($1, $2, $3, $4, $5)
      `, [qualId, i, `Unit ${i}`, description?.trim() || null, creditsEach]);
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Qualification created', id: qualId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/qualifications:', err);
    if (err.code === '22P02') {
      return res.status(400).json({ success: false, message: 'Invalid NQF level value' });
    }
    res.status(500).json({ success: false, message: 'Failed to create qualification' });
  } finally {
    client.release();
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/qualifications/:id  — single qual + units
══════════════════════════════════════════════════════════ */
router.get('/api/qualifications/:id', guard, async (req, res) => {
  try {
    const { id } = req.params;
    const qRes = await pool.query(`
      SELECT qualification_id AS id, title, nqf_level, seta,
             duration_months, is_active, created_at
      FROM qualifications WHERE qualification_id = $1
    `, [id]);

    if (!qRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Qualification not found' });
    }

    const uRes = await pool.query(`
      SELECT id, unit_number, title, description, credits, expected_duration_weeks
      FROM units WHERE qualification_id = $1 ORDER BY unit_number
    `, [id]);

    res.json({ success: true, qualification: qRes.rows[0], units: uRes.rows });
  } catch (err) {
    console.error('GET /api/qualifications/:id:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch qualification' });
  }
});

/* ══════════════════════════════════════════════════════════
   PUT /api/qualifications/:id  — update qualification
   Body: title?, seta?, duration_months?, is_active?,
         units[]  — array of { id?, unit_number, title, description, credits }
══════════════════════════════════════════════════════════ */
router.put('/api/qualifications/:id', guard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { title, seta, duration_months, is_active, units } = req.body;

    await client.query('BEGIN');

    // Check exists
    const check = await client.query(
      `SELECT qualification_id FROM qualifications WHERE qualification_id = $1`, [id]
    );
    if (!check.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Qualification not found' });
    }

    // Build dynamic SET clause
    const fields = [];
    const vals   = [];
    let idx = 1;

    if (title         !== undefined) { fields.push(`title = $${idx++}`);           vals.push(title.trim()); }
    if (seta          !== undefined) { fields.push(`seta = $${idx++}`);            vals.push(seta.trim()); }
    if (duration_months !== undefined) { fields.push(`duration_months = $${idx++}`); vals.push(parseInt(duration_months, 10)); }
    if (is_active     !== undefined) { fields.push(`is_active = $${idx++}`);       vals.push(is_active); }

    if (fields.length) {
      vals.push(id);
      await client.query(
        `UPDATE qualifications SET ${fields.join(', ')} WHERE qualification_id = $${idx}`,
        vals
      );
    }

    // Upsert units if provided
    if (Array.isArray(units)) {
      for (const u of units) {
        if (u.id) {
          // Update existing unit
          await client.query(`
            UPDATE units
            SET title = $1, description = $2, credits = $3,
                expected_duration_weeks = $4, updated_at = NOW()
            WHERE id = $5 AND qualification_id = $6
          `, [
            u.title || `Unit ${u.unit_number}`,
            u.description || null,
            u.credits || null,
            u.expected_duration_weeks || null,
            u.id, id
          ]);
        } else {
          // Insert new unit
          await client.query(`
            INSERT INTO units (qualification_id, unit_number, title, description, credits, expected_duration_weeks)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (qualification_id, unit_number) DO UPDATE
            SET title = EXCLUDED.title, description = EXCLUDED.description,
                credits = EXCLUDED.credits, updated_at = NOW()
          `, [
            id,
            u.unit_number,
            u.title || `Unit ${u.unit_number}`,
            u.description || null,
            u.credits || null,
            u.expected_duration_weeks || null
          ]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Qualification updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/qualifications/:id:', err);
    res.status(500).json({ success: false, message: 'Failed to update qualification' });
  } finally {
    client.release();
  }
});

/* ══════════════════════════════════════════════════════════
   DELETE /api/qualifications/:id  — remove qualification
   Cascades to units, materials, enrolments via FK CASCADE
══════════════════════════════════════════════════════════ */
router.delete('/api/qualifications/:id', guard, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query('BEGIN');

    // Check for active enrolments first — warn rather than block
    const active = await client.query(`
      SELECT COUNT(*)::INT AS n FROM enrolments
      WHERE qualification_id = $1 AND status = 'active'
    `, [id]);

    if (active.rows[0].n > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Cannot remove: ${active.rows[0].n} learner(s) are still actively enrolled. Deactivate or move them first.`
      });
    }

    const del = await client.query(
      `DELETE FROM qualifications WHERE qualification_id = $1 RETURNING title`, [id]
    );

    if (!del.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Qualification not found' });
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `"${del.rows[0].title}" has been removed` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/qualifications/:id:', err);
    res.status(500).json({ success: false, message: 'Failed to remove qualification' });
  } finally {
    client.release();
  }
});

/* ══════════════════════════════════════════════════════════
   GET /api/qualifications/:id/units  — list units for a qual
══════════════════════════════════════════════════════════ */
router.get('/api/qualifications/:id/units', guard, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, unit_number, title, description, credits, expected_duration_weeks
      FROM units WHERE qualification_id = $1 ORDER BY unit_number
    `, [req.params.id]);
    res.json({ success: true, units: result.rows });
  } catch (err) {
    console.error('GET /api/qualifications/:id/units:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch units' });
  }
});

/* ══════════════════════════════════════════════════════════
   PATCH /api/qualifications/:id/status  — toggle active/draft
   Body: { is_active: boolean }
══════════════════════════════════════════════════════════ */
router.patch('/api/qualifications/:id/status', guard, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'is_active must be a boolean' });
    }
    const result = await pool.query(`
      UPDATE qualifications SET is_active = $1
      WHERE qualification_id = $2
      RETURNING title, is_active
    `, [is_active, id]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Qualification not found' });
    }
    res.json({ success: true, message: `"${result.rows[0].title}" set to ${is_active ? 'active' : 'draft'}` });
  } catch (err) {
    console.error('PATCH /api/qualifications/:id/status:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

module.exports = router;