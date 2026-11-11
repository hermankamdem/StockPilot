const { pool } = require('../config/db');
const {
  createCustomerSchema,
  updateCustomerSchema,
} = require('../validators/customers.validator');

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

async function listCustomers(req, res, next) {
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

    const [customers] = await pool.execute(
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
       FROM customers
       WHERE ${conditions.join(' AND ')}
       ORDER BY name ASC, id DESC`,
      params
    );

    return res.status(200).json({
      success: true,
      data: customers,
      total: customers.length,
    });
  } catch (error) {
    return next(error);
  }
}

async function getCustomer(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de client invalide.',
    });
  }

  try {
    const [customers] = await pool.execute(
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
       FROM customers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [Number(req.params.id), req.business.id]
    );

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      data: customers[0],
    });
  } catch (error) {
    return next(error);
  }
}

async function createCustomer(req, res, next) {
  const validation = createCustomerSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Données du client invalides.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (!hasManagementRole(req, res)) {
    return;
  }

  try {
    const { name, phone, email, address, notes } = validation.data;

    const [result] = await pool.execute(
      `INSERT INTO customers
         (business_id, name, phone, email, address, notes)
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

    const [customers] = await pool.execute(
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
       FROM customers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [result.insertId, req.business.id]
    );

    return res.status(201).json({
      success: true,
      message: 'Client créé avec succès.',
      data: customers[0],
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCustomer(req, res, next) {
  const validation = updateCustomerSchema.safeParse(req.body);

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

  if (!hasManagementRole(req, res)) {
    return;
  }

  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de client invalide.',
    });
  }

  try {
    const customerId = Number(req.params.id);
    const fields = [];
    const values = [];

    for (const field of ['name', 'phone', 'email', 'address', 'notes']) {
      if (validation.data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(validation.data[field]);
      }
    }

    values.push(customerId, req.business.id);

    const [result] = await pool.execute(
      `UPDATE customers
       SET ${fields.join(', ')}
       WHERE id = ? AND business_id = ? AND status = 'active'`,
      values
    );

    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(
        `SELECT id, status
         FROM customers
         WHERE id = ? AND business_id = ?
         LIMIT 1`,
        [customerId, req.business.id]
      );

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Client introuvable.',
        });
      }

      if (existing[0].status === 'archived') {
        return res.status(409).json({
          success: false,
          code: 'CUSTOMER_ARCHIVED',
          message: 'Un client archivé ne peut pas être modifié.',
        });
      }
    }

    const [customers] = await pool.execute(
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
       FROM customers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [customerId, req.business.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Client mis à jour avec succès.',
      data: customers[0],
    });
  } catch (error) {
    return next(error);
  }
}

async function archiveCustomer(req, res, next) {
  if (!hasManagementRole(req, res)) {
    return;
  }

  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de client invalide.',
    });
  }

  try {
    const customerId = Number(req.params.id);

    const [result] = await pool.execute(
      `UPDATE customers
       SET status = 'archived'
       WHERE id = ? AND business_id = ? AND status = 'active'`,
      [customerId, req.business.id]
    );

    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(
        `SELECT id, status
         FROM customers
         WHERE id = ? AND business_id = ?
         LIMIT 1`,
        [customerId, req.business.id]
      );

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Client introuvable.',
        });
      }

      return res.status(409).json({
        success: false,
        code: 'CUSTOMER_ALREADY_ARCHIVED',
        message: 'Ce client est déjà archivé.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Client archivé avec succès. Son historique est conservé.',
    });
  } catch (error) {
    return next(error);
  }
}


async function getCustomerHistory(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de client invalide.',
    });
  }

  try {
    const customerId = Number(req.params.id);
    const businessId = req.business.id;

    const [customers] = await pool.execute(
      `SELECT id, name, status
       FROM customers
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [customerId, businessId]
    );

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client introuvable.',
      });
    }

    const [sales] = await pool.execute(
      `SELECT
         s.id,
         s.reference,
         s.status,
         s.sale_date AS saleDate,
         s.total_amount AS totalAmount,
         s.notes,
         s.created_at AS createdAt
       FROM sales s
       WHERE s.customer_id = ?
         AND s.business_id = ?
       ORDER BY s.sale_date DESC, s.id DESC`,
      [customerId, businessId]
    );

    const saleIds = sales.map((sale) => sale.id);
    let items = [];

    if (saleIds.length > 0) {
      const placeholders = saleIds.map(() => '?').join(', ');

      const [saleItems] = await pool.execute(
        `SELECT
           sale_id AS saleId,
           product_id AS productId,
           product_name AS productName,
           quantity,
           unit_price AS unitPrice,
          
           line_total AS lineTotal
         FROM sale_items
         WHERE business_id = ?
           AND sale_id IN (${placeholders})
         ORDER BY sale_id DESC, id ASC`,
        [businessId, ...saleIds]
      );

      items = saleItems;
    }

    const itemsBySale = new Map();

    for (const item of items) {
      const saleId = String(item.saleId);

      if (!itemsBySale.has(saleId)) {
        itemsBySale.set(saleId, []);
      }

      itemsBySale.get(saleId).push(item);
    }

    const salesWithItems = sales.map((sale) => ({
      ...sale,
      items: itemsBySale.get(String(sale.id)) || [],
    }));

    return res.status(200).json({
      success: true,
      data: {
        customer: customers[0],
        sales: salesWithItems,
        totalSales: salesWithItems.length,
      },
    });
  } catch (error) {
    return next(error);
  }
}


module.exports = {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  archiveCustomer,
  getCustomerHistory,
};
