
const { pool } = require('../config/db');
const {
  createCategorySchema,
  updateCategorySchema,
} = require('../validators/categories.validator');

async function listCategories(req, res, next) {
  try {
    const search =
      typeof req.query.search === 'string'
        ? req.query.search.trim().slice(0, 100)
        : '';

    const conditions = ['business_id = ?'];
    const params = [req.business.id];

    if (search) {
      conditions.push('(name LIKE ? OR description LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term);
    }

    const [categories] = await pool.execute(
      `SELECT id, name, description, created_at AS createdAt
       FROM categories
       WHERE ${conditions.join(' AND ')}
       ORDER BY name ASC, id ASC`,
      params
    );

    return res.status(200).json({
      success: true,
      data: categories,
      total: categories.length,
    });
  } catch (error) {
    return next(error);
  }
}

async function getCategory(req, res, next) {
  try {
    const categoryId = Number(req.params.id);

    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de catégorie invalide.',
      });
    }

    const [categories] = await pool.execute(
      `SELECT id, name, description, created_at AS createdAt
       FROM categories
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [categoryId, req.business.id]
    );

    if (categories.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      data: categories[0],
    });
  } catch (error) {
    return next(error);
  }
}

async function createCategory(req, res, next) {
  const validation = createCategorySchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Données de catégorie invalides.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (!['owner', 'manager'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Vous n’avez pas le droit de créer des catégories.',
    });
  }

  try {
    const { name, description } = validation.data;

    const [result] = await pool.execute(
      `INSERT INTO categories (business_id, name, description)
       VALUES (?, ?, ?)`,
      [req.business.id, name, description ?? null]
    );

    return res.status(201).json({
      success: true,
      message: 'Catégorie créée avec succès.',
      data: {
        id: result.insertId,
        name,
        description: description ?? null,
      },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        code: 'CATEGORY_NAME_EXISTS',
        message: 'Une catégorie portant ce nom existe déjà dans cette boutique.',
      });
    }

    return next(error);
  }
}

async function updateCategory(req, res, next) {
  const validation = updateCategorySchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Données de modification invalides.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (!['owner', 'manager'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Vous n’avez pas le droit de modifier des catégories.',
    });
  }

  const categoryId = Number(req.params.id);

  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de catégorie invalide.',
    });
  }

  try {
    const { name, description } = validation.data;
    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push('name = ?');
      values.push(name);
    }

    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description);
    }

    values.push(categoryId, req.business.id);

    const [result] = await pool.execute(
      `UPDATE categories
       SET ${fields.join(', ')}
       WHERE id = ? AND business_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(
        `SELECT id
         FROM categories
         WHERE id = ? AND business_id = ?
         LIMIT 1`,
        [categoryId, req.business.id]
      );

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Catégorie introuvable.',
        });
      }
    }

    const [categories] = await pool.execute(
      `SELECT id, name, description, created_at AS createdAt
       FROM categories
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [categoryId, req.business.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Catégorie mise à jour avec succès.',
      data: categories[0],
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        code: 'CATEGORY_NAME_EXISTS',
        message: 'Une catégorie portant ce nom existe déjà dans cette boutique.',
      });
    }

    return next(error);
  }
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
};
