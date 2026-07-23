const express = require('express');
const multer = require('multer');
const router = express.Router();
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');
const { uploadMaterial, getSasUrl, deleteBlob } = require('../utils/blobStorage');

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uploadBrief = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.originalname.toLowerCase().endsWith('.pdf');
    cb(null, isPdf);
  }
});

function validProjectPayload(b) {
  if (!b.title?.trim()) return 'Project title is required';
  if (b.total_marks === undefined || Number.isNaN(Number(b.total_marks)) || Number(b.total_marks) <= 0) {
    return 'Total marks must be a positive number';
  }
  if (b.duration_days === undefined || Number.isNaN(parseInt(b.duration_days, 10)) || parseInt(b.duration_days, 10) <= 0) {
    return 'Duration (days) must be a positive whole number';
  }
  return null;
}

/* ── LIST projects for a unit (admin) ── */
router.get('/api/units/:unitId/projects', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { unitId } = req.params;
    if (!uuidRe.test(unitId)) return res.status(400).json({ success: false, message: 'Invalid unit ID' });

    const result = await pool.query(
      `SELECT p.id, p.title, p.description, p.status, p.total_marks, p.duration_days,
              p.brief_file_name, p.brief_file_size, p.created_at,
              COUNT(ps.id)::int AS submission_count
         FROM projects p
         LEFT JOIN project_submissions ps ON ps.project_id = p.id
        WHERE p.unit_id = $1
        GROUP BY p.id
        ORDER BY p.created_at DESC`,
      [unitId]
    );
    res.json({ success: true, projects: result.rows });
  } catch (err) {
    console.error('GET /api/units/:unitId/projects error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch projects' });
  }
});

/* ── CREATE project (admin) — metadata only, brief uploaded separately ── */
router.post('/api/units/:unitId/projects', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { unitId } = req.params;
    if (!uuidRe.test(unitId)) return res.status(400).json({ success: false, message: 'Invalid unit ID' });

    const err = validProjectPayload(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { title, description, total_marks, duration_days } = req.body;
    const result = await pool.query(
      `INSERT INTO projects (unit_id, title, description, total_marks, duration_days, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [unitId, title.trim(), description?.trim() || null, total_marks, parseInt(duration_days, 10), req.session.user.id]
    );
    res.json({ success: true, projectId: result.rows[0].id, message: 'Project created' });
  } catch (err) {
    console.error('POST /api/units/:unitId/projects error:', err);
    res.status(500).json({ success: false, message: 'Failed to create project' });
  }
});

/* ── GET single project (admin) ── */
router.get('/api/projects/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid project ID' });

    const result = await pool.query(`SELECT * FROM projects WHERE id = $1`, [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    const project = result.rows[0];
    res.json({
      success: true,
      project: {
        ...project,
        brief_url: project.brief_file_url ? getSasUrl(project.brief_file_url) : null,
      },
    });
  } catch (err) {
    console.error('GET /api/projects/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch project' });
  }
});

/* ── UPDATE project metadata (admin) ── */
router.put('/api/projects/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid project ID' });

    const err = validProjectPayload(req.body);
    if (err) return res.status(400).json({ success: false, message: err });

    const { title, description, total_marks, duration_days } = req.body;
    await pool.query(
      `UPDATE projects SET title=$1, description=$2, total_marks=$3, duration_days=$4, updated_at=NOW()
       WHERE id=$5`,
      [title.trim(), description?.trim() || null, total_marks, parseInt(duration_days, 10), id]
    );
    res.json({ success: true, message: 'Project updated' });
  } catch (err) {
    console.error('PUT /api/projects/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update project' });
  }
});

/* ── UPLOAD / REPLACE the assessment brief PDF (admin) ── */
router.post('/api/projects/:id/brief', isAuthenticated, isRole('admin'), uploadBrief.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid project ID' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded, or it was not a PDF' });

    const existing = await pool.query(`SELECT unit_id, brief_file_url FROM projects WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    const { unit_id, brief_file_url: oldBlobName } = existing.rows[0];
    const newBlobName = await uploadMaterial(unit_id, req.file);

    await pool.query(
      `UPDATE projects
       SET brief_file_url=$1, brief_file_name=$2, brief_file_size=$3, updated_at=NOW()
       WHERE id=$4`,
      [newBlobName, req.file.originalname, req.file.size, id]
    );

    if (oldBlobName) {
      try { await deleteBlob(oldBlobName); }
      catch (blobErr) { console.warn(`Brief replace — old blob cleanup failed for ${oldBlobName}:`, blobErr.message); }
    }

    res.json({ success: true, message: 'Assessment brief uploaded' });
  } catch (err) {
    console.error('POST /api/projects/:id/brief error:', err);
    res.status(500).json({ success: false, message: 'Brief upload failed: ' + err.message });
  }
});

/* ── DELETE the brief (admin) ── */
router.delete('/api/projects/:id/brief', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT brief_file_url FROM projects WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    const { brief_file_url: blobName } = existing.rows[0];
    await pool.query(
      `UPDATE projects SET brief_file_url=NULL, brief_file_name=NULL, brief_file_size=NULL, updated_at=NOW() WHERE id=$1`,
      [id]
    );

    if (blobName) {
      try { await deleteBlob(blobName); }
      catch (blobErr) { console.warn(`Brief delete — blob cleanup failed for ${blobName}:`, blobErr.message); }
    }

    res.json({ success: true, message: 'Brief removed' });
  } catch (err) {
    console.error('DELETE /api/projects/:id/brief error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove brief' });
  }
});

/* ── PUBLISH / UNPUBLISH / ARCHIVE (admin) ──
   "Must have a brief to publish" is enforced right here in JS —
   same pattern as the qualification unit-cap check — instead of a
   DB trigger, since this codebase doesn't use triggers anywhere else. */
router.patch('/api/projects/:id/status', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    if (status === 'published') {
      const check = await pool.query(`SELECT brief_file_url FROM projects WHERE id = $1`, [id]);
      if (!check.rows.length) return res.status(404).json({ success: false, message: 'Project not found' });
      if (!check.rows[0].brief_file_url) {
        return res.status(400).json({ success: false, message: 'Upload the assessment brief PDF before publishing' });
      }
    }

    await pool.query(`UPDATE projects SET status=$1, updated_at=NOW() WHERE id=$2`, [status, id]);
    res.json({ success: true, message: `Project set to ${status}` });
  } catch (err) {
    console.error('PATCH /api/projects/:id/status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update project status' });
  }
});

/* ── DELETE project (admin) ── */
router.delete('/api/projects/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRe.test(id)) return res.status(400).json({ success: false, message: 'Invalid project ID' });

    const existing = await pool.query(`SELECT brief_file_url FROM projects WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);

    if (existing.rows[0].brief_file_url) {
      try { await deleteBlob(existing.rows[0].brief_file_url); }
      catch (blobErr) { console.warn('Project delete — brief blob cleanup failed:', blobErr.message); }
    }

    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    console.error('DELETE /api/projects/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete project' });
  }
});

module.exports = router;