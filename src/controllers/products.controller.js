
const { pool } = require('../config/db');
const { createProductSchema } = require('../validators/products.validator');

async function listProducts(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20)
    );
    const offset = (page - 1) * limit;

    const search =
      typeof req.query.search === 'string'
        ? req.query.search.trim().slice(0, 180)
        : '';

    const status = ['active', 'archived'].includes(req.query.status)
      ? req.query.status
      : 'active';

    const conditions = ['business_id = ?', 'status = ?'];
    const params = [req.business.id, status];

    if (search) {
      conditions.push('(name LIKE ? OR sku LIKE ? OR barcode LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM products
       WHERE ${whereClause}`,
      params
    );

    const [products] = await pool.execute(
      `SELECT
         id,
         category_id AS categoryId,
         name,
         sku,
         barcode,
         unit,
         purchase_price AS purchasePrice,
         selling_price AS sellingPrice,
         stock_quantity AS stockQuantity,
         alert_threshold AS alertThreshold,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM products
       WHERE ${whereClause}
       ORDER BY name ASC, id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = Number(countRows[0].total);

    return res.status(200).json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function createProduct(req, res, next) {
  const validation = createProductSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Données du produit invalides.',
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
      message: 'Vous n’avez pas le droit de créer des produits.',
    });
  }

  const data = validation.data;

  // Les prix acceptent au maximum 2 décimales.
  if (
    !Number.isSafeInteger(Math.round(data.purchasePrice * 100)) ||
    Math.abs(data.purchasePrice * 100 - Math.round(data.purchasePrice * 100)) > 1e-7 ||
    Math.abs(data.sellingPrice * 100 - Math.round(data.sellingPrice * 100)) > 1e-7
  ) {
    return res.status(400).json({
      success: false,
      message: 'Les prix doivent comporter au maximum 2 décimales.',
    });
  }

  // Les quantités acceptent au maximum 3 décimales.
  for (const quantity of [data.initialStock, data.alertThreshold]) {
    if (
      Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7
    ) {
      return res.status(400).json({
        success: false,
        message: 'Les quantités doivent comporter au maximum 3 décimales.',
      });
    }
  }

  const businessId = req.business.id;
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    // Sérialise les créations de produits d'une même boutique
    // pour protéger le contrôle du quota.
    const [businessRows] = await connection.execute(
      `SELECT id, status
       FROM businesses
       WHERE id = ?
       FOR UPDATE`,
      [businessId]
    );

    if (
      businessRows.length === 0 ||
      businessRows[0].status !== 'active'
    ) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(403).json({
        success: false,
        code: 'BUSINESS_NOT_ACTIVE',
        message: 'Cette boutique ne peut pas créer de produits.',
      });
    }

    // Vérifie que la catégorie appartient à la même boutique.
    if (data.categoryId != null) {
      const [categories] = await connection.execute(
        `SELECT id
         FROM categories
         WHERE id = ? AND business_id = ?
         LIMIT 1`,
        [data.categoryId, businessId]
      );

      if (categories.length === 0) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          code: 'INVALID_CATEGORY',
          message: 'La catégorie sélectionnée est introuvable dans cette boutique.',
        });
      }
    }

    // Vérifie le forfait et le nombre de produits actifs.
    const [subscriptionRows] = await connection.execute(
      `SELECT
         s.status AS subscription_status,
         s.trial_ends_at,
         s.end_date,
         p.max_products
       FROM subscriptions s
       INNER JOIN plans p ON p.id = s.plan_id
       WHERE s.current_business_id = ?
       LIMIT 1`,
      [businessId]
    );

    if (subscriptionRows.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(403).json({
        success: false,
        message: 'Aucun abonnement courant disponible.',
      });
    }

    const subscription = subscriptionRows[0];

    let writable = false;

    if (subscription.subscription_status === 'trial') {
      const [trialRows] = await connection.execute(
        `SELECT (trial_ends_at > NOW()) AS valid
         FROM subscriptions
         WHERE current_business_id = ?
         LIMIT 1`,
        [businessId]
      );

      writable =
        subscription.trial_ends_at != null &&
        trialRows.length > 0 &&
        Number(trialRows[0].valid) === 1;
    } else if (subscription.subscription_status === 'active') {
      const [dateRows] = await connection.execute(
        `SELECT (
           end_date IS NULL OR end_date >= CURDATE()
         ) AS valid
         FROM subscriptions
         WHERE current_business_id = ?
         LIMIT 1`,
        [businessId]
      );

      writable =
        dateRows.length > 0 &&
        Number(dateRows[0].valid) === 1;
    }

    if (!writable) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_NOT_WRITABLE',
        message: 'Votre abonnement ne permet pas actuellement de créer des produits.',
        readOnly: true,
      });
    }

    const maxProducts = Number(subscription.max_products);

    const [countRows] = await connection.execute(
      `SELECT COUNT(*) AS total
       FROM products
       WHERE business_id = ? AND status = 'active'`,
      [businessId]
    );

    const activeCount = Number(countRows[0].total);

    if (activeCount >= maxProducts) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(403).json({
        success: false,
        code: 'PRODUCT_QUOTA_REACHED',
        message: 'La limite de produits actifs de votre forfait est atteinte.',
        maxProducts,
        activeProducts: activeCount,
      });
    }

    const [insertResult] = await connection.execute(
      `INSERT INTO products (
         business_id,
         category_id,
         name,
         sku,
         barcode,
         unit,
         purchase_price,
         selling_price,
         stock_quantity,
         alert_threshold,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        businessId,
        data.categoryId ?? null,
        data.name,
        data.sku || null,
        data.barcode || null,
        data.unit,
        data.purchasePrice.toFixed(2),
        data.sellingPrice.toFixed(2),
        data.initialStock.toFixed(3),
        data.alertThreshold.toFixed(3),
      ]
    );

    const productId = insertResult.insertId;

    // Le mouvement initial est créé dans la même transaction.
    // La contrainte SQL interdit les mouvements de quantité nulle.
    if (data.initialStock > 0) {
      await connection.execute(
        `INSERT INTO stock_movements (
           business_id,
           product_id,
           movement_type,
           quantity_delta,
           stock_before,
           stock_after,
           unit_cost,
           source_type,
           source_id,
           reason,
           created_by
         ) VALUES (?, ?, 'adjustment', ?, 0, ?, ?, 'product_creation', ?, ?, ?)`,
        [
          businessId,
          productId,
          data.initialStock.toFixed(3),
          data.initialStock.toFixed(3),
          data.purchasePrice.toFixed(2),
          productId,
          'Stock initial',
          req.user.id,
        ]
      );
    }

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: 'Produit créé avec succès.',
      data: {
        id: productId,
        categoryId: data.categoryId ?? null,
        name: data.name,
        sku: data.sku || null,
        barcode: data.barcode || null,
        unit: data.unit,
        purchasePrice: data.purchasePrice.toFixed(2),
        sellingPrice: data.sellingPrice.toFixed(2),
        stockQuantity: data.initialStock.toFixed(3),
        alertThreshold: data.alertThreshold.toFixed(3),
        status: 'active',
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        code: 'PRODUCT_IDENTIFIER_EXISTS',
        message: 'Ce SKU ou ce code-barres existe déjà dans cette boutique.',
      });
    }

    return next(error);
  } finally {
    connection.release();
  }
}

module.exports = { listProducts, createProduct };
