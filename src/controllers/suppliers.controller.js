const { pool } = require('../config/db');

const {
  createSupplierSchema,
  updateSupplierSchema,
} = require('../validators/suppliers.validator');

function isValidId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

function hasManagementRole(req, res) {
  if (!['owner', 'manager'].includes(req.business.role)) {
    res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Vous n’avez pas les droits nécessaires pour effectuer cette opération.',
    });

    return false;
  }

  return true;
}

// Liste des fournisseurs
async function listSuppliers(req, res, next) {
  try {
    const search =
      typeof req.query.search === 'string'
        ? req.query.search.trim().slice(0, 100)
        : '';

    const status = ['active', 'archived'].includes(req.query.status)
      ? req.query.status
      : 'all';

    const conditions = ['business_id = ?'];
    const params = [req.business.id];

    if (status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const [suppliers] = await pool.execute(
      `SELECT
         id,
         name,
         phone,
         email,
         address,
         notes,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM suppliers
       WHERE ${conditions.join(' AND ')}
       ORDER BY name ASC, id DESC`,
      params
    );

    return res.status(200).json({
      success: true,
      data: suppliers,
      total: suppliers.length,
    });
  } catch (error) {
    return next(error);
  }
}

// Détails d'un fournisseur
async function getSupplier(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de fournisseur invalide.',
    });
  }

  try {
    const [suppliers] = await pool.execute(
      `SELECT
         id,
         name,
         phone,
         email,
         address,
         notes,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM suppliers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [Number(req.params.id), req.business.id]
    );

    if (suppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Fournisseur introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      data: suppliers[0],
    });
  } catch (error) {
    return next(error);
  }
}

// Création d'un fournisseur
async function createSupplier(req, res, next) {
  if (!hasManagementRole(req, res)) {
    return;
  }

  const validation = createSupplierSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Données du fournisseur invalides.',
      errors: validation.error.flatten().fieldErrors,
    });
  }

  try {
    const {
      name,
      phone,
      email,
      address,
      notes,
    } = validation.data;

    const [result] = await pool.execute(
      `INSERT INTO suppliers (
         business_id,
         name,
         phone,
         email,
         address,
         notes
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.business.id,
        name,
        phone ?? null,
        email ?? null,
        address ?? null,
        notes ?? null,
      ]
    );

    const [suppliers] = await pool.execute(
      `SELECT
         id,
         name,
         phone,
         email,
         address,
         notes,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM suppliers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [result.insertId, req.business.id]
    );

    return res.status(201).json({
      success: true,
      message: 'Fournisseur créé avec succès.',
      data: suppliers[0],
    });
  } catch (error) {
    return next(error);
  }
}

// Modification d'un fournisseur
async function updateSupplier(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de fournisseur invalide.',
    });
  }

  if (!hasManagementRole(req, res)) {
    return;
  }

  const validation = updateSupplierSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Données du fournisseur invalides.',
      errors: validation.error.flatten().fieldErrors,
    });
  }

  try {
    const supplierId = Number(req.params.id);
    const fields = validation.data;
    const allowedFields = ['name', 'phone', 'email', 'address', 'notes'];

    const updates = allowedFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(fields, field)
    );

    const [existing] = await pool.execute(
      `SELECT id, status
       FROM suppliers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [supplierId, req.business.id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Fournisseur introuvable.',
      });
    }

    if (existing[0].status === 'archived') {
      return res.status(400).json({
        success: false,
        code: 'SUPPLIER_ARCHIVED',
        message: 'Un fournisseur archivé ne peut pas être modifié.',
      });
    }

    const setClause = updates
      .map((field) => `\`${field}\` = ?`)
      .join(', ');

    const values = updates.map((field) => fields[field] ?? null);

    await pool.execute(
      `UPDATE suppliers
       SET ${setClause}
       WHERE id = ? AND business_id = ?`,
      [...values, supplierId, req.business.id]
    );

    const [suppliers] = await pool.execute(
      `SELECT
         id,
         name,
         phone,
         email,
         address,
         notes,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM suppliers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [supplierId, req.business.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Fournisseur modifié avec succès.',
      data: suppliers[0],
    });
  } catch (error) {
    return next(error);
  }
}

// Archivage d'un fournisseur
async function archiveSupplier(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de fournisseur invalide.',
    });
  }

  if (!hasManagementRole(req, res)) {
    return;
  }

  try {
    const supplierId = Number(req.params.id);

    const [suppliers] = await pool.execute(
      `SELECT id, status
       FROM suppliers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [supplierId, req.business.id]
    );

    if (suppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Fournisseur introuvable.',
      });
    }

    if (suppliers[0].status === 'archived') {
      return res.status(409).json({
        success: false,
        code: 'SUPPLIER_ALREADY_ARCHIVED',
        message: 'Ce fournisseur est déjà archivé.',
      });
    }

    await pool.execute(
      `UPDATE suppliers
       SET status = 'archived'
       WHERE id = ? AND business_id = ?`,
      [supplierId, req.business.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Fournisseur archivé avec succès.',
    });
  } catch (error) {
    return next(error);
  }
}

// Historique des achats d'un fournisseur
async function getSupplierHistory(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de fournisseur invalide.',
    });
  }

  try {
    const supplierId = Number(req.params.id);
    const businessId = req.business.id;

    const [suppliers] = await pool.execute(
      `SELECT id, name, status
       FROM suppliers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [supplierId, businessId]
    );

    if (suppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Fournisseur introuvable.',
      });
    }

    const [purchases] = await pool.execute(
      `SELECT
         id,
         reference,
         status,
         purchase_date AS purchaseDate,
         received_at AS receivedAt,
         total_amount AS totalAmount,
         notes,
         created_at AS createdAt
       FROM purchases
       WHERE supplier_id = ?
         AND business_id = ?
       ORDER BY purchase_date DESC, id DESC`,
      [supplierId, businessId]
    );

    const purchaseIds = purchases.map((purchase) => purchase.id);
    let items = [];

    if (purchaseIds.length > 0) {
      const placeholders = purchaseIds.map(() => '?').join(', ');

      const [purchaseItems] = await pool.execute(
        `SELECT
           purchase_id AS purchaseId,
           product_id AS productId,
           product_name AS productName,
           quantity,
           unit_cost AS unitCost,
           line_total AS lineTotal
         FROM purchase_items
         WHERE business_id = ?
           AND purchase_id IN (${placeholders})
         ORDER BY purchase_id DESC, id ASC`,
        [businessId, ...purchaseIds]
      );

      items = purchaseItems;
    }

    const itemsByPurchase = new Map();

    for (const item of items) {
      const purchaseId = String(item.purchaseId);

      if (!itemsByPurchase.has(purchaseId)) {
        itemsByPurchase.set(purchaseId, []);
      }

      itemsByPurchase.get(purchaseId).push(item);
    }

    const purchasesWithItems = purchases.map((purchase) => ({
      ...purchase,
      items: itemsByPurchase.get(String(purchase.id)) || [],
    }));

    return res.status(200).json({
      success: true,
      data: {
        supplier: suppliers[0],
        purchases: purchasesWithItems,
        totalPurchases: purchasesWithItems.length,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  archiveSupplier,
  getSupplierHistory,
};