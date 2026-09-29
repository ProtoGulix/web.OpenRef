import { Router } from 'express'
import pool from '../db/pool.js'

const router = Router()

// Liste des groupes d'un catalogue
router.get('/catalogues/:id/groupes', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.*,
       p.thumb, p.image, p.image_width, p.image_height,
       (SELECT array_agg(gp.id_page ORDER BY gp.id_page) FROM groupe_page gp WHERE gp.id_groupe = g.id) AS pages_ids
     FROM groupe g
     LEFT JOIN page p ON p.id = g.id_page_schema
     WHERE g.id_catalogue = $1
     ORDER BY g.titre`,
    [req.params.id]
  )
  res.json(rows)
})

// Détail d'un groupe + nomenclatures agrégées de toutes ses pages
router.get('/groupes/:id', async (req, res) => {
  const { rows: groupes } = await pool.query(
    `SELECT g.*,
       p.image, p.thumb, p.image_width, p.image_height,
       p.nomenclature_bboxes, p.nomenclature_bbox,
       c.marque, c.modele,
       c.column_template->>'schema_bbox' AS schema_bbox_raw,
       c.column_template->'schema_bbox' AS schema_bbox
     FROM groupe g
     LEFT JOIN page p ON p.id = g.id_page_schema
     LEFT JOIN catalogue c ON c.id = g.id_catalogue
     WHERE g.id = $1`,
    [req.params.id]
  )
  if (!groupes[0]) return res.status(404).json({ error: 'Not found' })

  const { rows: membres } = await pool.query(
    `SELECT p.id, p.numero, p.titre, p.image, p.thumb, p.image_width, p.image_height,
            gp.nomenclature_bboxes AS gp_nomenclature_bboxes,
            gp.column_template AS gp_column_template
     FROM groupe_page gp
     JOIN page p ON p.id = gp.id_page
     WHERE gp.id_groupe = $1 ORDER BY p.numero`,
    [req.params.id]
  )

  const { rows: nomenclatures } = await pool.query(
    `SELECT n.*, p.numero AS page_numero, p.titre AS page_titre FROM nomenclature n
     JOIN groupe_page gp ON gp.id_page = n.source_page_id
     JOIN page p ON p.id = n.source_page_id
     WHERE gp.id_groupe = $1
     ORDER BY NULLIF(regexp_replace(n.ref_no, '[^0-9]', '', 'g'), '')::int NULLS LAST, n.ref_no, p.numero, n.id`,
    [req.params.id]
  )

  // Liaisons repère → nomenclature via ref_vue_nomenclature sur toutes les pages membres du groupe
  const { rows: refsVues } = await pool.query(
    `SELECT rv.id, rv.part_number, rv.qty, rv.pos_x, rv.pos_y,
            COALESCE(
              json_agg(
                json_build_object(
                  'nomenclature_id', n.id,
                  'part_number', n.part_number,
                  'description', n.description,
                  'page_numero', p.numero,
                  'page_titre', p.titre
                ) ORDER BY p.numero, n.id
              ) FILTER (WHERE n.id IS NOT NULL), '[]'
            ) AS liaisons
     FROM references_vues rv
     LEFT JOIN ref_vue_nomenclature rvn ON rvn.ref_vue_id = rv.id
     LEFT JOIN nomenclature n ON n.id = rvn.nomenclature_id
       AND EXISTS (SELECT 1 FROM groupe_page gp WHERE gp.id_groupe = $2 AND gp.id_page = n.source_page_id)
     LEFT JOIN page p ON p.id = n.source_page_id
     WHERE rv.page_id = $1
     GROUP BY rv.id
     ORDER BY (rv.part_number ~ '^[0-9]+$') DESC,
              NULLIF(regexp_replace(rv.part_number, '[^0-9]', '', 'g'), '')::int NULLS LAST`,
    [groupes[0].id_page_schema, req.params.id]
  )

  res.json({ ...groupes[0], membres, nomenclatures, refsVues })
})

// Créer un groupe
router.post('/catalogues/:id/groupes', async (req, res) => {
  const { titre, id_page_schema } = req.body
  const { rows } = await pool.query(
    `INSERT INTO groupe (id_catalogue, titre, id_page_schema)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.params.id, titre || null, id_page_schema || null]
  )
  res.status(201).json(rows[0])
})

// Modifier un groupe
router.patch('/groupes/:id', async (req, res) => {
  const fields = ['titre', 'id_page_schema']
  const updates = [], values = []
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      values.push(req.body[f])
      updates.push(`${f}=$${values.length}`)
    }
  })
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' })
  values.push(req.params.id)
  const { rows } = await pool.query(
    `UPDATE groupe SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,
    values
  )
  res.json(rows[0])
})

// Supprimer un groupe
router.delete('/groupes/:id', async (req, res) => {
  await pool.query('DELETE FROM groupe WHERE id=$1', [req.params.id])
  res.status(204).end()
})

// Ajouter une page au groupe + jointure automatique ref_vue_nomenclature
router.post('/groupes/:id/pages', async (req, res) => {
  const { id_page } = req.body
  await pool.query(
    `INSERT INTO groupe_page (id_groupe, id_page) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.params.id, id_page]
  )
  // Jointure : lie les références_vues de la page schéma aux nomenclatures de la nouvelle page via ref_no
  await pool.query(
    `INSERT INTO ref_vue_nomenclature (ref_vue_id, nomenclature_id)
     SELECT rv.id, n.id
     FROM groupe g
     JOIN references_vues rv ON rv.page_id = g.id_page_schema
     JOIN nomenclature n ON n.source_page_id = $2 AND n.ref_no = rv.part_number
     WHERE g.id = $1
     ON CONFLICT DO NOTHING`,
    [req.params.id, id_page]
  )
  res.status(201).json({ ok: true })
})

// Relancer la jointure pour tout le groupe (utile après changement de page schéma)
router.post('/groupes/:id/jointure', async (req, res) => {
  const { rows: groupes } = await pool.query('SELECT * FROM groupe WHERE id=$1', [req.params.id])
  if (!groupes.length || !groupes[0].id_page_schema) return res.status(400).json({ error: 'Pas de page schéma définie' })

  // Supprimer les liaisons existantes des rv de ce groupe
  await pool.query(
    `DELETE FROM ref_vue_nomenclature
     WHERE ref_vue_id IN (SELECT id FROM references_vues WHERE page_id = $1)
       AND nomenclature_id IN (
         SELECT n.id FROM nomenclature n JOIN groupe_page gp ON gp.id_page = n.source_page_id WHERE gp.id_groupe = $2
       )`,
    [groupes[0].id_page_schema, req.params.id]
  )
  // Recréer toutes les liaisons
  const { rowCount } = await pool.query(
    `INSERT INTO ref_vue_nomenclature (ref_vue_id, nomenclature_id)
     SELECT rv.id, n.id
     FROM references_vues rv
     JOIN groupe_page gp ON gp.id_groupe = $2
     JOIN nomenclature n ON n.source_page_id = gp.id_page AND n.ref_no = rv.part_number
     WHERE rv.page_id = $1
     ON CONFLICT DO NOTHING`,
    [groupes[0].id_page_schema, req.params.id]
  )
  res.json({ matched: rowCount })
})

// Lancer la détection OCR nomenclature d'une page avec les bboxes/pattern du groupe
router.post('/groupes/:id/pages/:id_page/rerun-nomenclature', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT nomenclature_bboxes, column_template FROM groupe_page WHERE id_groupe=$1 AND id_page=$2',
    [req.params.id, req.params.id_page]
  )
  if (!rows[0]) return res.status(404).json({ error: 'Not found' })
  const { nomenclature_bboxes, column_template } = rows[0]
  if (!nomenclature_bboxes?.length) return res.status(400).json({ error: 'Aucune zone de nomenclature définie pour cette page dans ce groupe' })

  const OCR_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8001'
  const form = new URLSearchParams({ page_id: req.params.id_page })
  form.append('nomenclature_bboxes_override', JSON.stringify(nomenclature_bboxes))
  if (column_template) form.append('column_template', JSON.stringify(column_template))

  const ocrRes = await fetch(`${OCR_URL}/ocr/nomenclature/page`, { method: 'POST', body: form })
  const result = await ocrRes.json()
  res.json(result)
})

// Mettre à jour les zones / pattern d'une page dans le groupe
router.patch('/groupes/:id/pages/:id_page', async (req, res) => {
  const { nomenclature_bboxes, column_template } = req.body
  const fields = [], values = []
  if (nomenclature_bboxes !== undefined) {
    values.push(JSON.stringify(nomenclature_bboxes))
    fields.push(`nomenclature_bboxes=$${values.length}::jsonb`)
  }
  if (column_template !== undefined) {
    values.push(column_template === null ? null : JSON.stringify(column_template))
    fields.push(`column_template=$${values.length}::jsonb`)
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })
  values.push(req.params.id, req.params.id_page)
  const { rows } = await pool.query(
    `UPDATE groupe_page SET ${fields.join(',')}
     WHERE id_groupe=$${values.length - 1} AND id_page=$${values.length}
     RETURNING *`,
    values
  )
  if (!rows[0]) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

// Retirer une page du groupe
router.delete('/groupes/:id/pages/:id_page', async (req, res) => {
  await pool.query(
    `DELETE FROM groupe_page WHERE id_groupe=$1 AND id_page=$2`,
    [req.params.id, req.params.id_page]
  )
  res.status(204).end()
})

export default router
