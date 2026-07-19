// routes/materials.js
const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { isAuthenticated, isRole } = require('../middleware/auth');
const { uploadMaterial, getSasUrl, deleteBlob } = require('../utils/blobStorage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB, matches your drop-zone copy
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.mp4'];
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

const EXT_TO_TYPE = { pdf: 'document', doc: 'document', docx: 'document', ppt: 'document', pptx: 'document', mp4: 'video' };

// POST /api/units/:unitId/materials — upload one file to Azure, save the row
router.post('/api/units/:unitId/materials', isAuthenticated, isRole('admin'), upload.single('file'), async (req, res) => {
  try {
    const { unitId } = req.params;
    const { title, description } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded, or file type not allowed' });

    const unitCheck = await pool.query(`SELECT id FROM units WHERE id = $1`, [unitId]);
    if (!unitCheck.rows.length) return res.status(404).json({ success: false, message: 'Unit not found' });

    const blobName = await uploadMaterial(unitId, req.file);
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    const result = await pool.query(
      `INSERT INTO materials (unit_id, uploaded_by, title, description, file_url, file_name, file_size_bytes, material_type, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`,
      [unitId, req.session.user.id, title || req.file.originalname, description || null,
       blobName, req.file.originalname, req.file.size, EXT_TO_TYPE[ext] || 'other']
    );

    res.json({ success: true, materialId: result.rows[0].id, message: 'Material uploaded successfully' });
  } catch (err) {
    console.error('POST /api/units/:unitId/materials error:', err);
    res.status(500).json({ success: false, message: 'Upload failed: ' + err.message });
  }
});

// GET /api/units/:unitId/materials — list materials with fresh SAS URLs
// Used by both the admin preview and the learner/facilitator portal
router.get('/api/units/:unitId/materials', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, file_name, file_size_bytes, material_type, file_url
       FROM materials WHERE unit_id = $1 AND is_published = TRUE ORDER BY sort_order, created_at`,
      [req.params.unitId]
    );
    const materials = result.rows.map(m => ({ ...m, url: getSasUrl(m.file_url) }));
    res.json({ success: true, materials });
  } catch (err) {
    console.error('GET /api/units/:unitId/materials error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch materials' });
  }
});

// PATCH /api/materials/:id — rename / edit description (does not touch the file itself)
router.patch('/api/materials/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title cannot be empty' });
    }

    const result = await pool.query(
      `UPDATE materials SET title = $1, description = $2 WHERE id = $3 RETURNING id`,
      [title.trim(), description?.trim() || null, id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Material not found' });

    res.json({ success: true, message: 'Material updated' });
  } catch (err) {
    console.error('PATCH /api/materials/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update material' });
  }
});

// DELETE /api/materials/:id — remove blob + db row
router.delete('/api/materials/:id', isAuthenticated, isRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query(`SELECT file_url, title, file_name FROM materials WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Material not found' });

    const { file_url: blobName, title, file_name } = existing.rows[0];

    await pool.query(`DELETE FROM materials WHERE id = $1`, [id]);

    try {
      await deleteBlob(blobName);
    } catch (blobErr) {
      console.warn(`DELETE /api/materials/:id — DB row removed but blob cleanup failed for ${blobName}:`, blobErr.message);
    }

    res.json({ success: true, message: `"${title || file_name}" has been removed` });
  } catch (err) {
    console.error('DELETE /api/materials/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove material' });
  }
});

// POST /api/materials/:id/replace — swap the underlying file, keep the same row/id
router.post('/api/materials/:id/replace', isAuthenticated, isRole('admin'), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded, or file type not allowed' });

    const existing = await pool.query(`SELECT unit_id, file_url FROM materials WHERE id = $1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Material not found' });

    const { unit_id, file_url: oldBlobName } = existing.rows[0];

    const newBlobName = await uploadMaterial(unit_id, req.file);
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    await pool.query(
      `UPDATE materials
       SET file_url = $1, file_name = $2, file_size_bytes = $3, material_type = $4
       WHERE id = $5`,
      [newBlobName, req.file.originalname, req.file.size, EXT_TO_TYPE[ext] || 'other', id]
    );

    try {
      await deleteBlob(oldBlobName);
    } catch (blobErr) {
      console.warn(`POST /api/materials/:id/replace — old blob cleanup failed for ${oldBlobName}:`, blobErr.message);
    }

    res.json({ success: true, message: 'File replaced successfully' });
  } catch (err) {
    console.error('POST /api/materials/:id/replace error:', err);
    res.status(500).json({ success: false, message: 'Replace failed: ' + err.message });
  }
});


// GET /api/learner/materials
// Resolves the calling learner's ACTIVE qualification from their
// session (req.session.user.id) via enrolments, returns every unit
// under it with published materials + this learner's view status.
// One query, no N+1.
//
// Test:  curl -b cookie.txt http://localhost:3000/api/learner/materials
router.get('/api/learner/materials', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;

    const { rows } = await pool.query(
      `SELECT
         q.qualification_id, q.title AS qualification_title, q.nqf_level,
         u.id AS unit_id, u.unit_number, u.title AS unit_title,
         m.id AS material_id, m.title AS material_title, m.description,
         m.material_type, m.file_name, m.file_size_bytes, m.file_url, m.sort_order,
         mv.viewed_at
       FROM enrolments e
       JOIN qualifications q ON q.qualification_id = e.qualification_id
       JOIN units u          ON u.qualification_id = q.qualification_id
       LEFT JOIN materials m       ON m.unit_id = u.id AND m.is_published = TRUE
       LEFT JOIN material_views mv ON mv.material_id = m.id AND mv.learner_id = e.learner_id
       WHERE e.learner_id = $1 AND e.status = 'active'
       ORDER BY u.unit_number, m.sort_order`,
      [learnerId]
    );

    if (!rows.length) {
      return res.json({ success: true, qualification: null, units: [] });
    }

    const qualification = {
      id: rows[0].qualification_id,
      title: rows[0].qualification_title,
      nqf_level: rows[0].nqf_level,
    };

    const unitsById = new Map();
    for (const r of rows) {
      if (!unitsById.has(r.unit_id)) {
        unitsById.set(r.unit_id, { id: r.unit_id, unit_number: r.unit_number, title: r.unit_title, materials: [] });
      }
      if (r.material_id) {
        unitsById.get(r.unit_id).materials.push({
          id: r.material_id,
          title: r.material_title,
          description: r.description,
          type: r.material_type,
          file_name: r.file_name,
          file_size_bytes: r.file_size_bytes,
          // Same helper your existing GET /api/units/:unitId/materials uses — sync, not awaited.
          url: getSasUrl(r.file_url),
          viewed: !!r.viewed_at,
        });
      }
    }

    res.json({ success: true, qualification, units: [...unitsById.values()] });
  } catch (err) {
    console.error('GET /api/learner/materials error:', err);
    res.status(500).json({ success: false, message: 'Failed to load materials' });
  }
});

// GET /api/learner/materials/:materialId/view?download=1
// Records the view (upsert) then hands back the signed URL as JSON —
// the frontend opens it with window.open() / triggers the download.
// Pass ?download=1 to get a SAS URL with Content-Disposition: attachment
// (forces Save As instead of opening inline).
//
// Test:  curl -b cookie.txt http://localhost:3000/api/learner/materials/<id>/view
//        curl -b cookie.txt http://localhost:3000/api/learner/materials/<id>/view?download=1
router.get('/api/learner/materials/:materialId/view', isAuthenticated, isRole('learner'), async (req, res) => {
  try {
    const learnerId = req.session.user.id;
    const { materialId } = req.params;
    const wantsDownload = req.query.download === '1';

    const { rows } = await pool.query(
      `SELECT m.id, m.file_url, m.file_name, m.title
       FROM materials m
       JOIN units u      ON u.id = m.unit_id
       JOIN enrolments e ON e.qualification_id = u.qualification_id
       WHERE m.id = $1 AND m.is_published = TRUE
         AND e.learner_id = $2 AND e.status = 'active'
       LIMIT 1`,
      [materialId, learnerId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Material not found' });

    await pool.query(
      `INSERT INTO material_views (material_id, learner_id, viewed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (material_id, learner_id) DO UPDATE SET viewed_at = NOW()`,
      [materialId, learnerId]
    );

    const url = getSasUrl(rows[0].file_url, {
      download: wantsDownload,
      fileName: rows[0].file_name,
    });

    res.json({ success: true, url, file_name: rows[0].file_name });
  } catch (err) {
    console.error('GET /api/learner/materials/:materialId/view error:', err);
    res.status(500).json({ success: false, message: 'Failed to open material' });
  }
});
module.exports = router;