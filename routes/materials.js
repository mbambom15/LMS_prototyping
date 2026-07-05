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

    // Delete the DB row first — if this fails we haven't touched storage yet.
    await pool.query(`DELETE FROM materials WHERE id = $1`, [id]);

    // Best-effort blob cleanup; the DB row is already gone either way, so a
    // storage hiccup here shouldn't block the admin from seeing it removed.
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
// (so any existing links/bookmarks to this material keep working)
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

    // Clean up the superseded blob now that the new one is safely uploaded
    // and the DB row points at it. Best-effort — the swap has already
    // succeeded from the admin's point of view even if this fails.
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

module.exports = router;