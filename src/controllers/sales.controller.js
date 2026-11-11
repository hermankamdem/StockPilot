
const { pool } = require('../config/db');
const {
  createSaleSchema,
  createSalePaymentSchema,
} = require('../validators/sales.validator');

const MAX_DECIMAL_15_2 = 999999999999999n;

function decimalToBigInt(value, decimalPlaces, label) {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);

  if (!match || (match[2] && match[2].length > decimalPlaces)) {
    throw new Error(`${label} invalide.`);
  }

  const factor = 10n ** BigInt(decimalPlaces);
  const fraction = (match[2] || '').padEnd(decimalPlaces, '0');

  const result =
    BigInt(match[1]) * factor +
    BigInt(fraction || '0');

  if (result < 0n) {
    throw new Error(`${label} ne peut pas être négatif.`);
  }

  return result;
}

function bigIntToDecimal(value, decimalPlaces) {
  const factor = 10n ** BigInt(decimalPlaces);
  const integerPart = value / factor;
  const fractionalPart = (value % factor)
    .toString()
    .padStart(decimalPlaces, '0');

  return `${integerPart}.${fractionalPart}`;
}

async function listSales(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20)
    );
    const offset = (page - 1) * limit;

    const conditions = ['business_id = ?'];
    const params = [req.business.id];

    if (['draft', 'confirmed', 'cancelled'].includes(req.query.status)) {
      conditions.push('status = ?');
      params.push(req.query.status);
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM sales
       WHERE ${whereClause}`,
      params
    );

    const [sales] = await pool.execute(
      `SELECT
         id,
         reference,
         customer_id AS customerId,
         status,
         sale_date AS saleDate,
         total_amount AS totalAmount,
         notes,
         created_by AS createdBy,
         confirmed_by AS confirmedBy,
         confirmed_at AS confirmedAt,
         cancelled_at AS cancelledAt,
         created_at AS createdAt
       FROM sales
       WHERE ${whereClause}
       ORDER BY sale_date DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = Number(countRows[0].total);

    return res.status(200).json({
      success: true,
      data: sales,
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

async function getSaleById(req, res, next) {
  try {
    const saleId = Number(req.params.id);

    if (!Number.isSafeInteger(saleId) || saleId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant de vente invalide.',
      });
    }

    const [sales] = await pool.execute(
      `SELECT
         id,
         reference,
         customer_id AS customerId,
         status,
         sale_date AS saleDate,
         total_amount AS totalAmount,
         notes,
         created_by AS createdBy,
         confirmed_by AS confirmedBy,
         confirmed_at AS confirmedAt,
         cancelled_by AS cancelledBy,
         cancelled_at AS cancelledAt,
         cancellation_reason AS cancellationReason,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM sales
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [saleId, req.business.id]
    );

    if (sales.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vente introuvable.',
      });
    }

    const [items] = await pool.execute(
      `SELECT
         id,
         product_id AS productId,
         product_name AS productName,
         quantity,
         unit_price AS unitPrice,
         unit_cost AS unitCost,
         line_total AS lineTotal
       FROM sale_items
       WHERE sale_id = ? AND business_id = ?
       ORDER BY id ASC`,
      [saleId, req.business.id]
    );

    const [payments] = await pool.execute(
      `SELECT
         id,
         payment_type AS paymentType,
         amount,
         payment_method AS paymentMethod,
         transaction_reference AS transactionReference,
         payment_date AS paymentDate,
         notes,
         recorded_by AS recordedBy,
         created_at AS createdAt
       FROM payments
       WHERE sale_id = ? AND business_id = ?
       ORDER BY payment_date ASC, id ASC`,
      [saleId, req.business.id]
    );

    let totalCollected = 0n;
    let totalRefunded = 0n;

    for (const payment of payments) {
      const amount = decimalToBigInt(
        payment.amount,
        2,
        'Montant du paiement'
      );

      if (amount > MAX_DECIMAL_15_2) {
        throw new Error('Montant du paiement hors limite.');
      }

      if (payment.paymentType === 'collection') {
        totalCollected += amount;
      } else if (payment.paymentType === 'refund') {
        totalRefunded += amount;
      }
    }

    if (
      totalCollected > MAX_DECIMAL_15_2 ||
      totalRefunded > MAX_DECIMAL_15_2
    ) {
      throw new Error('Total des paiements hors limite.');
    }

    if (totalRefunded > totalCollected) {
      throw new Error('Le total remboursé dépasse le total encaissé.');
    }

    const totalAmount = decimalToBigInt(
      sales[0].totalAmount,
      2,
      'Montant total de la vente'
    );

    const netPaid = totalCollected - totalRefunded;

    const remainingAmount =
      totalAmount > netPaid ? totalAmount - netPaid : 0n;

    const overpaidAmount =
      netPaid > totalAmount ? netPaid - totalAmount : 0n;

    return res.status(200).json({
      success: true,
      data: {
        ...sales[0],
        items,
        payments,
        totalCollected: bigIntToDecimal(totalCollected, 2),
        totalRefunded: bigIntToDecimal(totalRefunded, 2),
        netPaid: bigIntToDecimal(netPaid, 2),
        remainingAmount: bigIntToDecimal(remainingAmount, 2),
        overpaidAmount: bigIntToDecimal(overpaidAmount, 2),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function createSale(req, res, next) {
  const validation = createSaleSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Données de vente invalides.',
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (!['owner', 'manager', 'cashier'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Vous ne pouvez pas créer de ventes.',
    });
  }

  const data = validation.data;
  const businessId = req.business.id;
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [businessRows] = await connection.execute(
      `SELECT id, status
       FROM businesses
       WHERE id = ?
       FOR UPDATE`,
      [businessId]
    );

    if (businessRows.length === 0 || businessRows[0].status !== 'active') {
      await connection.rollback();
      transactionStarted = false;

      return res.status(403).json({
        success: false,
        code: 'BUSINESS_NOT_ACTIVE',
        message: 'Cette boutique ne peut pas créer de ventes.',
      });
    }

    let customerId = data.customerId ?? null;

    if (customerId !== null) {
   const [customers] = await connection.execute(
  `SELECT id
   FROM customers
   WHERE id = ?
     AND business_id = ?
     AND status = 'active'
   LIMIT 1`,
  [customerId, businessId]
);

      if (customers.length === 0) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMER',
          message: 'Le client est introuvable, archivé ou indisponible dans cette boutique.',
        });
      }
    }

    // Fusionne les lignes répétées pour un même produit.
    const quantities = new Map();

    for (const item of data.items) {
      const quantity = (quantities.get(item.productId) || 0) + item.quantity;

      if (
        !Number.isFinite(quantity) ||
        Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7
      ) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          code: 'INVALID_QUANTITY',
          message: 'La quantité totale doit comporter au maximum 3 décimales.',
        });
      }

      quantities.set(item.productId, quantity);
    }

    const reference = `VTE-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;

    const [saleResult] = await connection.execute(
      `INSERT INTO sales (
         business_id,
         customer_id,
         reference,
         status,
         total_amount,
         notes,
         created_by
       ) VALUES (?, ?, ?, 'draft', 0, ?, ?)`,
      [
        businessId,
        customerId,
        reference,
        data.notes ?? null,
        req.user.id,
      ]
    );

    const saleId = saleResult.insertId;
    let totalCents = 0;

    for (const [productId, quantity] of quantities) {
      const [products] = await connection.execute(
        `SELECT id, name, selling_price, purchase_price, status
         FROM products
         WHERE id = ? AND business_id = ?
         LIMIT 1`,
        [productId, businessId]
      );

      if (products.length === 0 || products[0].status !== 'active') {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          code: 'INVALID_PRODUCT',
          message: `Le produit ${productId} est introuvable ou archivé.`,
        });
      }

      const product = products[0];
      const unitPriceCents = Math.round(Number(product.selling_price) * 100);
      const unitCostCents = Math.round(Number(product.purchase_price) * 100);
      const quantityMilli = Math.round(quantity * 1000);
      const lineTotalCents = Math.round(
        (unitPriceCents * quantityMilli) / 1000
      );

      if (
        !Number.isSafeInteger(unitPriceCents) ||
        !Number.isSafeInteger(unitCostCents) ||
        !Number.isSafeInteger(lineTotalCents) ||
        !Number.isSafeInteger(totalCents + lineTotalCents)
      ) {
        throw new Error('Montant de vente hors limites.');
      }

      totalCents += lineTotalCents;

      await connection.execute(
        `INSERT INTO sale_items (
           business_id,
           sale_id,
           product_id,
           product_name,
           quantity,
           unit_price,
           unit_cost,
           line_total
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId,
          saleId,
          productId,
          product.name,
          quantity.toFixed(3),
          (unitPriceCents / 100).toFixed(2),
          (unitCostCents / 100).toFixed(2),
          (lineTotalCents / 100).toFixed(2),
        ]
      );
    }

    await connection.execute(
      `UPDATE sales
       SET total_amount = ?
       WHERE id = ? AND business_id = ?`,
      [(totalCents / 100).toFixed(2), saleId, businessId]
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: 'Brouillon de vente créé avec succès.',
      data: {
        id: saleId,
        reference,
        customerId,
        status: 'draft',
        totalAmount: (totalCents / 100).toFixed(2),
        notes: data.notes ?? null,
        items: quantities.size,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    return next(error);
  } finally {
    connection.release();
  }
}

async function confirmSale(req, res, next) {
  const saleId = Number(req.params.id);

  if (!Number.isSafeInteger(saleId) || saleId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de vente invalide.',
    });
  }

  if (!['owner', 'manager', 'cashier'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Vous ne pouvez pas confirmer cette vente.',
    });
  }

  const businessId = req.business.id;
  const userId = req.user.id;
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    // Verrouille la vente pour empêcher deux confirmations simultanées.
    const [sales] = await connection.execute(
      `SELECT id, status
       FROM sales
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [saleId, businessId]
    );

    if (sales.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Vente introuvable.',
      });
    }

    if (sales[0].status !== 'draft') {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'SALE_NOT_DRAFT',
        message: 'Seule une vente en brouillon peut être confirmée.',
      });
    }

    // Charge les lignes de vente dans un ordre stable.
    const [items] = await connection.execute(
      `SELECT product_id, quantity, unit_cost
       FROM sale_items
       WHERE sale_id = ? AND business_id = ?
       ORDER BY product_id ASC
       FOR UPDATE`,
      [saleId, businessId]
    );

    if (items.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        code: 'EMPTY_SALE',
        message: 'Impossible de confirmer une vente sans produit.',
      });
    }

    
    // Regroupe les quantités par produit pour calculer le stock correctement.
    const quantitiesByProduct = new Map();

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);

      if (!Number.isSafeInteger(productId) || productId <= 0) {
        throw new Error('Identifiant de produit invalide.');
      }

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7
      ) {
        throw new Error(`Quantité invalide pour le produit ${productId}.`);
      }

      quantitiesByProduct.set(
        productId,
        (quantitiesByProduct.get(productId) || 0) + quantity
      );
    }

    // Verrouille chaque produit une seule fois et vérifie la quantité totale.
    const lockedProducts = new Map();

    for (const [productId, quantity] of quantitiesByProduct) {
      const [products] = await connection.execute(
        `SELECT id, name, stock_quantity, status
         FROM products
         WHERE id = ? AND business_id = ?
         FOR UPDATE`,
        [productId, businessId]
      );

      if (products.length === 0 || products[0].status !== 'active') {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          code: 'PRODUCT_UNAVAILABLE',
          message: `Le produit ${productId} est introuvable ou archivé.`,
        });
      }

      const product = products[0];
      const stockBefore = Number(product.stock_quantity);

      if (stockBefore < quantity) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: `Stock insuffisant pour le produit « ${product.name} ».`,
          data: {
            productId,
            available: stockBefore,
            requested: quantity,
          },
        });
      }

      lockedProducts.set(productId, {
        stockBefore,
        stockAfter: stockBefore - quantity,
      });
    }


    // Met à jour le stock et journalise chaque mouvement.
 
    // Met à jour le stock et journalise un seul mouvement par produit.
    for (const [productId, quantity] of quantitiesByProduct) {
      const productStock = lockedProducts.get(productId);
      const stockBefore = productStock.stockBefore;
      const stockAfter = productStock.stockAfter;

      const item = items.find(
        (saleItem) => Number(saleItem.product_id) === productId
      );

      await connection.execute(
        `UPDATE products
         SET stock_quantity = ?
         WHERE id = ? AND business_id = ?`,
        [stockAfter.toFixed(3), productId, businessId]
      );

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
         ) VALUES (?, ?, 'sale', ?, ?, ?, ?, 'sale', ?, ?, ?)`,
        [
          businessId,
          productId,
          (-quantity).toFixed(3),
          stockBefore.toFixed(3),
          stockAfter.toFixed(3),
          item.unit_cost,
          saleId,
          `Confirmation de la vente ${saleId}`,
          userId,
        ]
      );
    }

    await connection.execute(
      `UPDATE sales
       SET status = 'confirmed',
           confirmed_by = ?,
           confirmed_at = NOW()
       WHERE id = ? AND business_id = ? AND status = 'draft'`,
      [userId, saleId, businessId]
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: 'Vente confirmée et stock mis à jour.',
      data: {
        id: saleId,
        status: 'confirmed',
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    return next(error);
  } finally {
    connection.release();
  }
}

async function cancelSale(req, res, next) {
  const saleId = Number(req.params.id);

  if (!Number.isSafeInteger(saleId) || saleId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de vente invalide.',
    });
  }

  if (!['owner', 'manager', 'cashier'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Vous ne pouvez pas annuler cette vente.',
    });
  }

  const rawReason = req.body?.reason;

  if (
    rawReason !== undefined &&
    rawReason !== null &&
    (typeof rawReason !== 'string' || rawReason.length > 255)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Le motif d’annulation doit être un texte de 255 caractères maximum.',
    });
  }

  const reason =
    typeof rawReason === 'string' && rawReason.trim()
      ? rawReason.trim()
      : null;

  const businessId = req.business.id;
  const userId = req.user.id;
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    // Verrouille la vente pour empêcher une double annulation.
    const [sales] = await connection.execute(
      `SELECT id, status
       FROM sales
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [saleId, businessId]
    );

    if (sales.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Vente introuvable.',
      });
    }

    const saleStatus = sales[0].status;

    if (!['draft', 'confirmed'].includes(saleStatus)) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'SALE_ALREADY_CANCELLED',
        message: 'Cette vente est déjà annulée.',
      });
    }

    // Un brouillon n'a jamais modifié le stock.
    // Une vente confirmée doit restaurer les quantités vendues.
    if (saleStatus === 'confirmed') {
      const [items] = await connection.execute(
        `SELECT product_id, quantity, unit_cost
         FROM sale_items
         WHERE sale_id = ? AND business_id = ?
         ORDER BY product_id ASC
         FOR UPDATE`,
        [saleId, businessId]
      );

      if (items.length === 0) {
        throw new Error(
          'Impossible d’annuler une vente confirmée sans lignes de vente.'
        );
      }

      const quantitiesByProduct = new Map();

      for (const item of items) {
        const productId = Number(item.product_id);
        const quantity = Number(item.quantity);

        if (
          !Number.isSafeInteger(productId) ||
          productId <= 0 ||
          !Number.isFinite(quantity) ||
          quantity <= 0
        ) {
          throw new Error('Une ligne de vente contient des données invalides.');
        }

        const current = quantitiesByProduct.get(productId);

        quantitiesByProduct.set(productId, {
          quantity: (current?.quantity || 0) + quantity,
          unitCost: current?.unitCost ?? item.unit_cost,
        });
      }

      // Verrouille les produits dans un ordre stable.
      const lockedProducts = new Map();

      for (const productId of [...quantitiesByProduct.keys()].sort(
        (a, b) => a - b
      )) {
        const [products] = await connection.execute(
          `SELECT id, stock_quantity
           FROM products
           WHERE id = ? AND business_id = ?
           FOR UPDATE`,
          [productId, businessId]
        );

        if (products.length === 0) {
          throw new Error(
            `Le produit ${productId} est introuvable : restauration impossible.`
          );
        }

        lockedProducts.set(productId, Number(products[0].stock_quantity));
      }

      for (const productId of [...quantitiesByProduct.keys()].sort(
        (a, b) => a - b
      )) {
        const item = quantitiesByProduct.get(productId);
        const stockBefore = lockedProducts.get(productId);
        const stockAfter = stockBefore + item.quantity;

        if (
          !Number.isFinite(stockAfter) ||
          Math.abs(stockAfter * 1000 - Math.round(stockAfter * 1000)) > 1e-7
        ) {
          throw new Error(
            `Le stock calculé est invalide pour le produit ${productId}.`
          );
        }

        await connection.execute(
          `UPDATE products
           SET stock_quantity = ?
           WHERE id = ? AND business_id = ?`,
          [stockAfter.toFixed(3), productId, businessId]
        );

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
           ) VALUES (?, ?, 'sale_cancel', ?, ?, ?, ?, 'sale', ?, ?, ?)`,
          [
            businessId,
            productId,
            item.quantity.toFixed(3),
            stockBefore.toFixed(3),
            stockAfter.toFixed(3),
            item.unitCost,
            saleId,
            `Annulation de la vente ${saleId}`,
            userId,
          ]
        );
      }
    }

    await connection.execute(
      `UPDATE sales
       SET status = 'cancelled',
           cancelled_by = ?,
           cancelled_at = NOW(),
           cancellation_reason = ?
       WHERE id = ? AND business_id = ?`,
      [userId, reason, saleId, businessId]
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message:
        saleStatus === 'confirmed'
          ? 'Vente annulée et stock restauré.'
          : 'Brouillon de vente annulé.',
      data: {
        id: saleId,
        status: 'cancelled',
        stockRestored: saleStatus === 'confirmed',
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    return next(error);
  } finally {
    connection.release();
  }
}
async function createSalePayment(req, res, next) {
  const parsed = createSalePaymentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Données du paiement invalides.',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const saleId = Number(req.params.id);
  const businessId = req.business.id;
  const userId = req.user.id;
  const data = parsed.data;

  if (!Number.isSafeInteger(saleId) || saleId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Identifiant de vente invalide.',
    });
  }

  if (!['owner', 'manager', 'cashier'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      message: 'Vous ne disposez pas des autorisations nécessaires.',
    });
  }

  let amountCents;

  try {
    amountCents = decimalToBigInt(
      data.amount,
      2,
      'Montant du paiement'
    );
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: 'Le montant du paiement est invalide.',
    });
  }

  if (amountCents > MAX_DECIMAL_15_2) {
    return res.status(400).json({
      success: false,
      message: 'Le montant du paiement dépasse la limite autorisée.',
    });
  }

  let connection;
  let transactionStarted = false;

  try {
    connection = await pool.getConnection();

    await connection.beginTransaction();
    transactionStarted = true;

    // Verrouiller la vente pour éviter les paiements concurrents excessifs.
    const [sales] = await connection.execute(
      `SELECT id, status, total_amount AS totalAmount
       FROM sales
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [saleId, businessId]
    );

    if (sales.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Vente introuvable.',
      });
    }

    const sale = sales[0];

    if (sale.status !== 'confirmed') {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'SALE_NOT_CONFIRMED',
        message: 'Seule une vente confirmée peut recevoir un paiement.',
      });
    }

    const [totals] = await connection.execute(
      `SELECT
         COALESCE(SUM(
           CASE WHEN payment_type = 'collection' THEN amount ELSE 0 END
         ), 0) AS totalCollected,
         COALESCE(SUM(
           CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END
         ), 0) AS totalRefunded
       FROM payments
       WHERE sale_id = ? AND business_id = ?`,
      [saleId, businessId]
    );

    const totalAmountCents = decimalToBigInt(
      sale.totalAmount,
      2,
      'Montant total de la vente'
    );

    const totalCollectedCents = decimalToBigInt(
      totals[0].totalCollected,
      2,
      'Total encaissé'
    );

    const totalRefundedCents = decimalToBigInt(
      totals[0].totalRefunded,
      2,
      'Total remboursé'
    );

    if (totalRefundedCents > totalCollectedCents) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'REFUND_TOTAL_INCONSISTENT',
        message: 'Le total des remboursements dépasse le total encaissé.',
      });
    }

    const netPaidCents = totalCollectedCents - totalRefundedCents;

    if (netPaidCents > totalAmountCents) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PAYMENT_TOTAL_INCONSISTENT',
        message: 'Le montant net encaissé dépasse le montant total de la vente.',
      });
    }

    const remainingCents = totalAmountCents - netPaidCents;

    if (remainingCents === 0n) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'SALE_ALREADY_PAID',
        message: 'Cette vente est déjà entièrement payée.',
      });
    }

    if (amountCents > remainingCents) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PAYMENT_EXCEEDS_REMAINING',
        message: 'Le paiement dépasse le montant restant à payer.',
        data: {
          remainingAmount: bigIntToDecimal(remainingCents, 2),
          requestedAmount: bigIntToDecimal(amountCents, 2),
        },
      });
    }

    const paymentDate = data.paymentDate
      ? data.paymentDate.toISOString().slice(0, 19).replace('T', ' ')
      : null;

    const [result] = await connection.execute(
      `INSERT INTO payments (
         business_id,
         sale_id,
         payment_type,
         amount,
         payment_method,
         transaction_reference,
         payment_date,
         notes,
         recorded_by
       ) VALUES (?, ?, 'collection', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`,
      [
        businessId,
        saleId,
        bigIntToDecimal(amountCents, 2),
        data.paymentMethod,
        data.transactionReference ?? null,
        paymentDate,
        data.notes ?? null,
        userId,
      ]
    );

    const newTotalCollectedCents = totalCollectedCents + amountCents;
    const newNetPaidCents = netPaidCents + amountCents;
    const newRemainingCents = totalAmountCents - newNetPaidCents;

    const paymentStatus =
      newNetPaidCents === 0n
        ? 'unpaid'
        : newRemainingCents === 0n
          ? 'paid'
          : 'partially_paid';

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: 'Paiement enregistré avec succès.',
      data: {
        id: result.insertId,
        saleId,
        amount: bigIntToDecimal(amountCents, 2),
        paymentMethod: data.paymentMethod,
        transactionReference: data.transactionReference ?? null,
        totalCollected: bigIntToDecimal(newTotalCollectedCents, 2),
        totalRefunded: bigIntToDecimal(totalRefundedCents, 2),
        netPaid: bigIntToDecimal(newNetPaidCents, 2),
        remainingAmount: bigIntToDecimal(newRemainingCents, 2),
        paymentStatus,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }

    return next(error);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}


module.exports = {
  listSales,
  getSaleById,
  createSale,
  confirmSale,
    cancelSale,
    createSalePayment,
};
