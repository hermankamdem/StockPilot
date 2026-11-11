
const { pool } = require('../config/db');
const {
  createPurchaseSchema,
  recordPurchasePaymentSchema,
  recordPurchaseRefundSchema,
} = require('../validators/purchases.validator');

const MAX_DECIMAL_15_2 = 999999999999999n;
const MAX_DECIMAL_15_3 = 999999999999999n;

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

async function listPurchases(req, res, next) {
  try {
    const pageParam = req.query.page;
const limitParam = req.query.limit;

const page =
  pageParam === undefined
    ? 1
    : Number(pageParam);

const limit =
  limitParam === undefined
    ? 20
    : Number(limitParam);

if (
  !Number.isSafeInteger(page) ||
  page <= 0 ||
  !Number.isSafeInteger(limit) ||
  limit <= 0 ||
  limit > 100
) {
  return res.status(400).json({
    success: false,
    message: 'Les paramètres de pagination sont invalides.',
  });
}
    const offset = (page - 1) * limit;
    const businessId = req.business.id;

    const conditions = ['business_id = ?'];
    const params = [businessId];

   const allowedStatuses = ['draft', 'received', 'cancelled'];

if (req.query.status !== undefined) {
  if (!allowedStatuses.includes(req.query.status)) {
    return res.status(400).json({
      success: false,
      message: 'Le statut demandé est invalide.',
    });
  }

  conditions.push('status = ?');
  params.push(req.query.status);
}
if (req.query.supplierId !== undefined) {
  const supplierIdParam = req.query.supplierId;

  if (
    typeof supplierIdParam !== 'string' ||
    !/^\d+$/.test(supplierIdParam)
  ) {
    return res.status(400).json({
      success: false,
      message: 'L’identifiant du fournisseur est invalide.',
    });
  }

  const supplierId = Number(supplierIdParam);

  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'L’identifiant du fournisseur est invalide.',
    });
  }

  const [suppliers] = await pool.execute(
    `SELECT id
     FROM suppliers
     WHERE id = ? AND business_id = ?
     LIMIT 1`,
    [supplierId, businessId]
  );

  if (suppliers.length === 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_SUPPLIER',
      message: 'Le fournisseur est introuvable dans ce commerce.',
    });
  }

  conditions.push('supplier_id = ?');
  params.push(supplierId);
}
const startDate = req.query.startDate;
const endDate = req.query.endDate;

const isValidDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};

if (startDate !== undefined) {
  if (!isValidDate(startDate)) {
    return res.status(400).json({
      success: false,
      message: 'La date de début est invalide. Format attendu : YYYY-MM-DD.',
    });
  }

  conditions.push('purchase_date >= ?');
  params.push(`${startDate} 00:00:00`);
}

if (endDate !== undefined) {
  if (!isValidDate(endDate)) {
    return res.status(400).json({
      success: false,
      message: 'La date de fin est invalide. Format attendu : YYYY-MM-DD.',
    });
  }

  conditions.push('purchase_date < DATE_ADD(?, INTERVAL 1 DAY)');
  params.push(`${endDate} 00:00:00`);
}

if (
  startDate !== undefined &&
  endDate !== undefined &&
  startDate > endDate
) {
  return res.status(400).json({
    success: false,
    message: 'La date de début ne peut pas être postérieure à la date de fin.',
  });
}
    const whereClause = conditions.join(' AND ');

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM purchases
       WHERE ${whereClause}`,
      params
    );

    const [purchases] = await pool.execute(
      `SELECT
         id,
         supplier_id AS supplierId,
         reference,
         status,
         purchase_date AS purchaseDate,
         received_at AS receivedAt,
         total_amount AS totalAmount,
         notes,
         created_by AS createdBy,
         received_by AS receivedBy,
         created_at AS createdAt
       FROM purchases
       WHERE ${whereClause}
       ORDER BY purchase_date DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: purchases,
      pagination: {
        page,
        limit,
        total: Number(countRows[0].total),
        totalPages: Math.ceil(Number(countRows[0].total) / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPurchaseById(req, res, next) {
  try {
    const purchaseId = Number(req.params.id);
    const businessId = req.business.id;

    if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Identifiant d'achat invalide.",
      });
    }

    const [purchases] = await pool.execute(
      `SELECT
         id,
         supplier_id AS supplierId,
         reference,
         status,
         purchase_date AS purchaseDate,
         received_at AS receivedAt,
         total_amount AS totalAmount,
         notes,
         created_by AS createdBy,
         received_by AS receivedBy,
         created_at AS createdAt
       FROM purchases
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [purchaseId, businessId]
    );

    if (purchases.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Achat introuvable.',
      });
    }

    const [items] = await pool.execute(
      `SELECT
         id,
         product_id AS productId,
         product_name AS productName,
         quantity,
         unit_cost AS unitCost,
         line_total AS lineTotal
       FROM purchase_items
       WHERE purchase_id = ? AND business_id = ?
       ORDER BY id`,
      [purchaseId, businessId]
    );

    const [payments] = await pool.execute(
      `SELECT
         id,
         amount,
         payment_type AS paymentType,
         payment_method AS paymentMethod,
         transaction_reference AS transactionReference,
         payment_date AS paymentDate,
         notes,
         recorded_by AS recordedBy,
         created_at AS createdAt
       FROM purchase_payments
       WHERE purchase_id = ? AND business_id = ?
       ORDER BY payment_date, id`,
      [purchaseId, businessId]
    );

   const [paymentTotals] = await pool.execute(
  `SELECT
     COALESCE(SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END), 0) AS totalPaid,
     COALESCE(SUM(CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END), 0) AS totalRefunded
   FROM purchase_payments
   WHERE purchase_id = ? AND business_id = ?`,
  [purchaseId, businessId]
);
   const purchase = purchases[0];

const totalAmountCents = decimalToBigInt(
  purchase.totalAmount,
  2,
  'Montant total de l’achat'
);

const totalPaidCents = decimalToBigInt(
  paymentTotals[0].totalPaid,
  2,
  'Montant total payé'
);

const totalRefundedCents = decimalToBigInt(
  paymentTotals[0].totalRefunded,
  2,
  'Montant total remboursé'
);

if (totalRefundedCents > totalPaidCents) {
  return res.status(409).json({
    success: false,
    code: 'REFUND_TOTAL_INCONSISTENT',
    message: 'Le total des remboursements dépasse le total des paiements.',
  });
}

const netPaidCents = totalPaidCents - totalRefundedCents;

if (netPaidCents > totalAmountCents) {
  return res.status(409).json({
    success: false,
    code: 'PAYMENT_TOTAL_INCONSISTENT',
    message: 'Le montant net payé dépasse le montant total de l’achat.',
  });
}

const remainingCents = totalAmountCents - netPaidCents;

return res.json({
  success: true,
  data: {
    ...purchase,
    items,
    payments,
   totalPaid: bigIntToDecimal(totalPaidCents, 2),
totalRefunded: bigIntToDecimal(totalRefundedCents, 2),
netPaid: bigIntToDecimal(netPaidCents, 2),
remainingAmount: bigIntToDecimal(remainingCents, 2),
  },
});
  } catch (error) {
    return next(error);
  }
}

async function createPurchase(req, res, next) {
  const parsed = createPurchaseSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Données de l’achat invalides.',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const data = parsed.data;
  const businessId = req.business.id;
 let connection;
let transactionStarted = false;

try {
  connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const supplierId = data.supplierId ?? null;

    if (supplierId !== null) {
      const [suppliers] = await connection.execute(
    `SELECT id, status
 FROM suppliers
 WHERE id = ? AND business_id = ?
 LIMIT 1
 FOR UPDATE`,
        [supplierId, businessId]
      );

      if (suppliers.length === 0) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          code: 'INVALID_SUPPLIER',
          message: 'Le fournisseur est introuvable dans ce commerce.',
        });
      }
      if (suppliers[0].status !== 'active') {
  await connection.rollback();
  transactionStarted = false;

  return res.status(400).json({
    success: false,
    code: 'SUPPLIER_ARCHIVED',
    message: 'Ce fournisseur est archivé et ne peut pas être utilisé pour un nouvel achat.',
  });
}
    }

const quantities = new Map();

for (const item of data.items) {
  const productId = item.productId;

  const itemQuantityMilli = decimalToBigInt(
    item.quantity,
    3,
    'Quantité'
  );

  const totalQuantityMilli =
    (quantities.get(productId) || 0n) + itemQuantityMilli;

  if (totalQuantityMilli > MAX_DECIMAL_15_3) {
    await connection.rollback();
    transactionStarted = false;

    return res.status(400).json({
      success: false,
      code: 'INVALID_QUANTITY',
      message: 'La quantité totale dépasse la limite autorisée.',
    });
  }

  quantities.set(productId, totalQuantityMilli);
}

    const reference =
      data.reference ||
      `ACH-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const purchaseDate = data.purchaseDate
      ? data.purchaseDate.slice(0, 19).replace('T', ' ')
      : null;

    const [purchaseResult] = await connection.execute(
      `INSERT INTO purchases (
         business_id,
         supplier_id,
         reference,
         status,
         purchase_date,
         total_amount,
         notes,
         created_by
       ) VALUES (?, ?, ?, 'draft', COALESCE(?, CURRENT_TIMESTAMP), 0, ?, ?)`,
      [
        businessId,
        supplierId,
        reference,
        purchaseDate,
        data.notes ?? null,
        req.user.id,
      ]
    );

    const purchaseId = purchaseResult.insertId;
let totalCents = 0n;

    for (const item of data.items) {
      const [products] = await connection.execute(
        `SELECT id, name, status
         FROM products
         WHERE id = ? AND business_id = ?
         LIMIT 1
         FOR UPDATE`,
        [item.productId, businessId]
      );

      if (products.length === 0 || products[0].status !== 'active') {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          code: 'INVALID_PRODUCT',
          message: `Le produit ${item.productId} est introuvable ou archivé.`,
        });
      }

     const unitCostCents = decimalToBigInt(
  item.unitCost,
  2,
  'Coût unitaire'
);

const quantityMilli = decimalToBigInt(
  item.quantity,
  3,
  'Quantité'
);

      // Vérifier les valeurs avant les calculs.
     if (
  unitCostCents < 0n ||
  unitCostCents > MAX_DECIMAL_15_2 ||
  quantityMilli <= 0n ||
  quantityMilli > MAX_DECIMAL_15_3
) {
  throw new Error('Coût ou quantité hors limites.');
}
// Multiplication exacte avec BigInt.
const lineProduct = unitCostCents * quantityMilli;

// Arrondi au centime le plus proche.
const lineTotalCents = (lineProduct + 500n) / 1000n;

if (lineTotalCents > MAX_DECIMAL_15_2) {
  throw new Error('Montant de la ligne d’achat hors limites.');
}

     // Vérifier le cumul avant de l'ajouter.
const newTotalCents = totalCents + lineTotalCents;

if (newTotalCents > MAX_DECIMAL_15_2) {
  throw new Error('Montant total de l’achat hors limites.');
}

totalCents = newTotalCents;

      await connection.execute(
        `INSERT INTO purchase_items (
           business_id,
           purchase_id,
           product_id,
           product_name,
           quantity,
           unit_cost,
           line_total
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId,
          purchaseId,
          item.productId,
          products[0].name,
         bigIntToDecimal(quantityMilli, 3),
bigIntToDecimal(unitCostCents, 2),
bigIntToDecimal(lineTotalCents, 2),
        ]
      );
    }

   await connection.execute(
  `UPDATE purchases
   SET total_amount = ?
   WHERE id = ? AND business_id = ?`,
  [bigIntToDecimal(totalCents, 2), purchaseId, businessId]
);

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: 'Brouillon d’achat créé avec succès.',
      data: {
        id: purchaseId,
        reference,
        status: 'draft',
        supplierId,
      totalAmount: bigIntToDecimal(totalCents, 2),
        stockUpdated: false,
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

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        code: 'PURCHASE_REFERENCE_EXISTS',
        message: 'Cette référence d’achat existe déjà.',
      });
    }

    return next(error);
} finally {
  if (connection) {
    connection.release();
  }
}
}


async function receivePurchase(req, res, next) {
  const purchaseId = Number(req.params.id);
  const businessId = req.business.id;
  const userId = req.user.id;

  if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Identifiant d'achat invalide.",
    });
  }

    let connection;
  let transactionStarted = false;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [purchases] = await connection.execute(
      `SELECT id, status
       FROM purchases
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [purchaseId, businessId]
    );

    if (purchases.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Achat introuvable.',
      });
    }

    if (purchases[0].status !== 'draft') {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PURCHASE_NOT_DRAFT',
        message: "Seul un achat en brouillon peut être réceptionné.",
      });
    }

    const [items] = await connection.execute(
      `SELECT product_id AS productId,
              product_name AS productName,
              quantity,
              unit_cost AS unitCost
       FROM purchase_items
       WHERE purchase_id = ? AND business_id = ?
       ORDER BY product_id, id`,
      [purchaseId, businessId]
    );

    if (items.length === 0) {
      throw new Error("Impossible de réceptionner un achat sans produits.");
    }

    // Verrouiller les produits dans un ordre stable.
    const productIds = [
      ...new Set(items.map(item => Number(item.productId))),
    ].sort((a, b) => a - b);

    const productsById = new Map();

    for (const productId of productIds) {
      if (!Number.isSafeInteger(productId) || productId <= 0) {
        throw new Error('Identifiant de produit invalide.');
      }

      const [products] = await connection.execute(
        `SELECT id, name, status,
                stock_quantity AS stockQuantity,
                purchase_price AS purchasePrice
         FROM products
         WHERE id = ? AND business_id = ?
         FOR UPDATE`,
        [productId, businessId]
      );

      if (products.length === 0 || products[0].status !== 'active') {
        throw new Error(
          `Le produit ${productId} est introuvable ou archivé.`
        );
      }

      productsById.set(productId, products[0]);
    }

    // Convertir les quantités et les coûts en unités entières.
    // La valeur d'une ligne est exprimée en centimes × millièmes.
    const totalsByProduct = new Map();

    for (const item of items) {
      const productId = Number(item.productId);
      const quantityMilli = decimalToBigInt(
        item.quantity,
        3,
        'Quantité reçue'
      );
      const unitCostCents = decimalToBigInt(
        item.unitCost,
        2,
        "Coût d'achat"
      );

      if (quantityMilli <= 0n) {
        throw new Error('La quantité reçue doit être positive.');
      }

      if (
        quantityMilli > MAX_DECIMAL_15_3 ||
        unitCostCents > MAX_DECIMAL_15_2
      ) {
        throw new Error('Une valeur dépasse la limite DECIMAL autorisée.');
      }

      const totals = totalsByProduct.get(productId) || {
        quantityMilli: 0n,
        valueCentMilli: 0n,
      };

      totals.quantityMilli += quantityMilli;
      totals.valueCentMilli += quantityMilli * unitCostCents;

      if (totals.quantityMilli > MAX_DECIMAL_15_3) {
        throw new Error(
          `La quantité totale dépasse la limite pour le produit ${productId}.`
        );
      }

      totalsByProduct.set(productId, totals);
    }

    // Calculer le nouveau stock et le coût moyen pondéré.
    const newValuesByProduct = new Map();

    for (const [productId, totals] of totalsByProduct) {
      const product = productsById.get(productId);

      const oldStockMilli = decimalToBigInt(
        product.stockQuantity,
        3,
        'Stock initial'
      );

      const oldCostCents = decimalToBigInt(
        product.purchasePrice,
        2,
        "Coût d'achat initial"
      );

      const newStockMilli = oldStockMilli + totals.quantityMilli;

      if (newStockMilli > MAX_DECIMAL_15_3) {
        throw new Error(
          `Le stock final dépasse la limite pour le produit ${productId}.`
        );
      }

      const weightedValueCentMilli =
        oldStockMilli * oldCostCents + totals.valueCentMilli;

      // Arrondi au centime le plus proche.
      const newCostCents =
        (weightedValueCentMilli + newStockMilli / 2n) /
        newStockMilli;

      if (newCostCents > MAX_DECIMAL_15_2) {
        throw new Error(
          `Le coût moyen dépasse la limite pour le produit ${productId}.`
        );
      }

      newValuesByProduct.set(productId, {
        stockMilli: newStockMilli,
        costCents: newCostCents,
        quantityMilli: totals.quantityMilli,
      });

      await connection.execute(
        `UPDATE products
         SET stock_quantity = ?, purchase_price = ?
         WHERE id = ? AND business_id = ?`,
        [
          bigIntToDecimal(newStockMilli, 3),
          bigIntToDecimal(newCostCents, 2),
          productId,
          businessId,
        ]
      );
    }

    // Enregistrer chaque ligne comme mouvement de stock.
    const runningStock = new Map();

    for (const productId of productIds) {
      const product = productsById.get(productId);

      runningStock.set(
        productId,
        decimalToBigInt(
          product.stockQuantity,
          3,
          'Stock initial'
        )
      );
    }

    for (const item of items) {
      const productId = Number(item.productId);

      const quantityMilli = decimalToBigInt(
        item.quantity,
        3,
        'Quantité du mouvement'
      );

      const unitCostCents = decimalToBigInt(
        item.unitCost,
        2,
        "Coût unitaire du mouvement"
      );

      const stockBefore = runningStock.get(productId);
      const stockAfter = stockBefore + quantityMilli;

      if (stockAfter > MAX_DECIMAL_15_3) {
        throw new Error(
          `Le stock du produit ${productId} dépasse la limite autorisée.`
        );
      }

      await connection.execute(
        `INSERT INTO stock_movements (
           business_id, product_id, movement_type,
           quantity_delta, stock_before, stock_after,
           unit_cost, source_type, source_id, reason, created_by
         ) VALUES (?, ?, 'purchase', ?, ?, ?, ?, 'purchase', ?, ?, ?)`,
        [
          businessId,
          productId,
          bigIntToDecimal(quantityMilli, 3),
          bigIntToDecimal(stockBefore, 3),
          bigIntToDecimal(stockAfter, 3),
          bigIntToDecimal(unitCostCents, 2),
          purchaseId,
          `Réception de l'achat ${purchaseId}`,
          userId,
        ]
      );

      runningStock.set(productId, stockAfter);
    }

 const [updateResult] = await connection.execute(
  `UPDATE purchases
   SET status = 'received',
       received_at = CURRENT_TIMESTAMP,
       received_by = ?
   WHERE id = ?
     AND business_id = ?
     AND status = 'draft'`,
  [userId, purchaseId, businessId]
);

if (updateResult.affectedRows !== 1) {
  throw new Error(
    'La réception de cet achat n’a pas pu être confirmée.'
  );
}

    await connection.commit();
    transactionStarted = false;

    return res.json({
      success: true,
      message: 'Achat réceptionné avec succès.',
      data: {
        id: purchaseId,
        status: 'received',
        stockUpdated: true,
        products: productIds.map(productId => {
          const values = newValuesByProduct.get(productId);

          return {
            productId,
            quantityReceived: bigIntToDecimal(
              values.quantityMilli,
              3
            ),
            stockQuantity: bigIntToDecimal(
              values.stockMilli,
              3
            ),
            purchasePrice: bigIntToDecimal(
              values.costCents,
              2
            ),
          };
        }),
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


async function recordPurchasePayment(req, res, next) {
  const parsed = recordPurchasePaymentSchema.safeParse(req.body);

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

  const purchaseId = Number(req.params.id);
  const businessId = req.business.id;
  const userId = req.user.id;

  if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Identifiant d'achat invalide.",
    });
  }

  const data = parsed.data;
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
    message: 'Le montant du paiement est invalide ou dépasse la précision autorisée.',
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

    // Verrouiller l'achat pour éviter les paiements concurrents excessifs.
    const [purchases] = await connection.execute(
      `SELECT id, status, total_amount AS totalAmount
       FROM purchases
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [purchaseId, businessId]
    );

    if (purchases.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Achat introuvable.',
      });
    }

    const purchase = purchases[0];

    if (purchase.status !== 'received') {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PURCHASE_NOT_RECEIVED',
        message: 'Seul un achat réceptionné peut être payé.',
      });
    }

    const [totals] = await connection.execute(
  `SELECT
     COALESCE(SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END), 0) AS totalPaid,
     COALESCE(SUM(CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END), 0) AS totalRefunded
   FROM purchase_payments
   WHERE purchase_id = ? AND business_id = ?`,
  [purchaseId, businessId]
);

   const totalAmountCents = decimalToBigInt(
  purchase.totalAmount,
  2,
  'Montant total de l’achat'
);

const totalPaidCents = decimalToBigInt(
  totals[0].totalPaid,
  2,
  'Montant total payé'
);

const totalRefundedCents = decimalToBigInt(
  totals[0].totalRefunded,
  2,
  'Montant total remboursé'
);

if (totalRefundedCents > totalPaidCents) {
  await connection.rollback();
  transactionStarted = false;

  return res.status(409).json({
    success: false,
    code: 'REFUND_TOTAL_INCONSISTENT',
    message: 'Le total des remboursements dépasse le total des paiements.',
  });
}

const netPaidCents = totalPaidCents - totalRefundedCents;

if (netPaidCents > totalAmountCents) {
  await connection.rollback();
  transactionStarted = false;

  return res.status(409).json({
    success: false,
    code: 'PAYMENT_TOTAL_INCONSISTENT',
    message: 'Le montant net payé dépasse le montant total de l’achat.',
  });
}

const remainingCents = totalAmountCents - netPaidCents;

    if (amountCents > remainingCents) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PAYMENT_EXCEEDS_REMAINING',
        message: 'Le paiement dépasse le montant restant à payer.',
        data: {
      remainingAmount: bigIntToDecimal(
  remainingCents > 0n ? remainingCents : 0n,
  2
),
requestedAmount: bigIntToDecimal(amountCents, 2),
        },
      });
    }

    const paymentDate = data.paymentDate
      ? data.paymentDate.slice(0, 19).replace('T', ' ')
      : null;

    const [result] = await connection.execute(
      `INSERT INTO purchase_payments (
   business_id,
   purchase_id,
   payment_type,
   amount,
   payment_method,
   transaction_reference,
   payment_date,
   notes,
   recorded_by
 ) VALUES (?, ?, 'payment', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`,
      [
        businessId,
        purchaseId,
      bigIntToDecimal(amountCents, 2),
        data.paymentMethod,
        data.transactionReference ?? null,
        paymentDate,
        data.notes ?? null,
        userId,
      ]
    );

  const newTotalPaidCents = totalPaidCents + amountCents;
const newNetPaidCents = netPaidCents + amountCents;
const newRemainingCents = totalAmountCents - newNetPaidCents;

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: 'Paiement enregistré avec succès.',
      data: {
        id: result.insertId,
        purchaseId,
        amount: bigIntToDecimal(amountCents, 2),
        paymentMethod: data.paymentMethod,
        transactionReference: data.transactionReference ?? null,
      totalPaid: bigIntToDecimal(newTotalPaidCents, 2),
totalRefunded: bigIntToDecimal(totalRefundedCents, 2),
netPaid: bigIntToDecimal(newNetPaidCents, 2),
remainingAmount: bigIntToDecimal(newRemainingCents, 2),
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

async function recordPurchaseRefund(req, res, next) {
  const parsed = recordPurchaseRefundSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Données du remboursement invalides.',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const purchaseId = Number(req.params.id);
  const businessId = req.business.id;
  const userId = req.user.id;

  if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Identifiant d'achat invalide.",
    });
  }

  if (!['owner', 'manager'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      code: 'PURCHASE_REFUND_FORBIDDEN',
      message: "Vous n'êtes pas autorisé à rembourser cet achat.",
    });
  }

  const data = parsed.data;
  let amountCents;

  try {
    amountCents = decimalToBigInt(
      data.amount,
      2,
      'Montant du remboursement'
    );
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: 'Le montant du remboursement est invalide.',
    });
  }

  if (amountCents > MAX_DECIMAL_15_2) {
    return res.status(400).json({
      success: false,
      message: 'Le montant du remboursement dépasse la limite autorisée.',
    });
  }

  let connection;
  let transactionStarted = false;

  try {
    connection = await pool.getConnection();

    await connection.beginTransaction();
    transactionStarted = true;

    const [purchases] = await connection.execute(
      `SELECT id, status, total_amount AS totalAmount
       FROM purchases
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [purchaseId, businessId]
    );

    if (purchases.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Achat introuvable.',
      });
    }

    const purchase = purchases[0];

    if (purchase.status !== 'received') {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PURCHASE_NOT_RECEIVED',
        message: 'Seul un achat réceptionné peut être remboursé.',
      });
    }

    const [totals] = await connection.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END), 0) AS totalPaid,
         COALESCE(SUM(CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END), 0) AS totalRefunded
       FROM purchase_payments
       WHERE purchase_id = ? AND business_id = ?`,
      [purchaseId, businessId]
    );

    const totalAmountCents = decimalToBigInt(
      purchase.totalAmount,
      2,
      'Montant total de l’achat'
    );

    const totalPaidCents = decimalToBigInt(
      totals[0].totalPaid,
      2,
      'Montant total payé'
    );

    const totalRefundedCents = decimalToBigInt(
      totals[0].totalRefunded,
      2,
      'Montant total remboursé'
    );

    if (totalRefundedCents > totalPaidCents) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'REFUND_TOTAL_INCONSISTENT',
        message: 'Le total des remboursements dépasse le total des paiements.',
      });
    }

    const netPaidCents = totalPaidCents - totalRefundedCents;

    if (netPaidCents > totalAmountCents) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PAYMENT_TOTAL_INCONSISTENT',
        message: 'Le montant net payé dépasse le montant total de l’achat.',
      });
    }

    if (amountCents > netPaidCents) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'REFUND_EXCEEDS_NET_PAID',
        message: 'Le remboursement dépasse le montant net déjà payé.',
        data: {
          refundableAmount: bigIntToDecimal(netPaidCents, 2),
          requestedAmount: bigIntToDecimal(amountCents, 2),
        },
      });
    }

    const paymentDate = data.paymentDate
      ? data.paymentDate.slice(0, 19).replace('T', ' ')
      : null;

    const [result] = await connection.execute(
      `INSERT INTO purchase_payments (
         business_id,
         purchase_id,
         payment_type,
         amount,
         payment_method,
         transaction_reference,
         payment_date,
         notes,
         recorded_by
       ) VALUES (?, ?, 'refund', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`,
      [
        businessId,
        purchaseId,
        bigIntToDecimal(amountCents, 2),
        data.paymentMethod,
        data.transactionReference ?? null,
        paymentDate,
        data.notes ?? null,
        userId,
      ]
    );

    const newTotalRefundedCents = totalRefundedCents + amountCents;
    const newNetPaidCents = netPaidCents - amountCents;
    const newRemainingCents = totalAmountCents - newNetPaidCents;

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: 'Remboursement enregistré avec succès.',
      data: {
        id: result.insertId,
        purchaseId,
        paymentType: 'refund',
        amount: bigIntToDecimal(amountCents, 2),
        paymentMethod: data.paymentMethod,
        transactionReference: data.transactionReference ?? null,
        totalPaid: bigIntToDecimal(totalPaidCents, 2),
        totalRefunded: bigIntToDecimal(newTotalRefundedCents, 2),
        netPaid: bigIntToDecimal(newNetPaidCents, 2),
        remainingAmount: bigIntToDecimal(newRemainingCents, 2),
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

async function cancelPurchase(req, res, next) {
  const purchaseId = Number(req.params.id);
  const businessId = req.business.id;
  const userId = req.user.id;

  if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Identifiant d'achat invalide.",
    });
  }

  // Seuls le propriétaire et le gestionnaire peuvent annuler un achat.
  if (!['owner', 'manager'].includes(req.business.role)) {
    return res.status(403).json({
      success: false,
      code: 'PURCHASE_CANCELLATION_FORBIDDEN',
      message: "Vous n'êtes pas autorisé à annuler cet achat.",
    });
  }

  const rawReason = req.body?.reason;

  if (
    rawReason !== undefined &&
    rawReason !== null &&
    typeof rawReason !== 'string'
  ) {
    return res.status(400).json({
      success: false,
      message: "Le motif d'annulation doit être un texte.",
    });
  }

  const reason = rawReason?.trim() || null;

  if (reason && reason.length > 255) {
    return res.status(400).json({
      success: false,
      message: "Le motif d'annulation ne doit pas dépasser 255 caractères.",
    });
  }

  let connection;
  let transactionStarted = false;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Verrouiller l'achat pour empêcher deux annulations simultanées.
    const [purchases] = await connection.execute(
      `SELECT id, status
       FROM purchases
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [purchaseId, businessId]
    );

    if (purchases.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Achat introuvable.',
      });
    }

    const purchaseStatus = purchases[0].status;

    if (purchaseStatus === 'cancelled') {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PURCHASE_ALREADY_CANCELLED',
        message: 'Cet achat a déjà été annulé.',
      });
    }

    if (!['draft', 'received'].includes(purchaseStatus)) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        code: 'PURCHASE_STATUS_INVALID',
        message: "Le statut actuel de cet achat ne permet pas son annulation.",
      });
    }
    if (purchaseStatus === 'received') {
      const [paymentTotals] = await connection.execute(
        `SELECT
           COALESCE(SUM(
             CASE WHEN payment_type = 'payment' THEN amount ELSE 0 END
           ), 0) AS totalPaid,
           COALESCE(SUM(
             CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END
           ), 0) AS totalRefunded
         FROM purchase_payments
         WHERE purchase_id = ? AND business_id = ?`,
        [purchaseId, businessId]
      );

      const totalPaidCents = decimalToBigInt(
        paymentTotals[0].totalPaid,
        2,
        'Total payé'
      );

      const totalRefundedCents = decimalToBigInt(
        paymentTotals[0].totalRefunded,
        2,
        'Total remboursé'
      );

      if (totalRefundedCents > totalPaidCents) {
        throw new Error(
          'Incohérence financière : les remboursements dépassent les paiements.'
        );
      }

      const netPaidCents = totalPaidCents - totalRefundedCents;

      if (netPaidCents > 0n) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          code: 'PURCHASE_REFUND_REQUIRED',
          message: 'Cet achat ne peut pas être annulé tant que les sommes versées au fournisseur ne sont pas intégralement remboursées.',
          amountToRefund: bigIntToDecimal(netPaidCents, 2),
        });
      }
    }

    let items = [];
    const productsById = new Map();
    const totalsByProduct = new Map();
    const newValuesByProduct = new Map();

    // Un achat en brouillon n'a jamais modifié le stock.
    if (purchaseStatus === 'received') {
      const [purchaseItems] = await connection.execute(
        `SELECT product_id AS productId,
                product_name AS productName,
                quantity,
                unit_cost AS unitCost
         FROM purchase_items
         WHERE purchase_id = ? AND business_id = ?
         ORDER BY product_id, id
         FOR UPDATE`,
        [purchaseId, businessId]
      );

      items = purchaseItems;

      if (items.length === 0) {
        throw new Error(
          "Impossible d'annuler un achat réceptionné sans produits."
        );
      }

      const productIds = [
        ...new Set(items.map(item => Number(item.productId))),
      ].sort((a, b) => a - b);

      // Vérifier et agréger les quantités avant toute modification.
      for (const item of items) {
        const productId = Number(item.productId);

        if (!Number.isSafeInteger(productId) || productId <= 0) {
          throw new Error('Identifiant de produit invalide.');
        }

        const quantityMilli = decimalToBigInt(
          item.quantity,
          3,
          "Quantité à retirer"
        );

        const unitCostCents = decimalToBigInt(
          item.unitCost,
          2,
          "Coût unitaire"
        );

        if (
          quantityMilli <= 0n ||
          quantityMilli > MAX_DECIMAL_15_3 ||
          unitCostCents > MAX_DECIMAL_15_2
        ) {
          throw new Error('Une quantité ou un coût est invalide.');
        }

        const totals = totalsByProduct.get(productId) || {
          quantityMilli: 0n,
        };

        totals.quantityMilli += quantityMilli;

        if (totals.quantityMilli > MAX_DECIMAL_15_3) {
          throw new Error(
            `La quantité totale dépasse la limite pour le produit ${productId}.`
          );
        }

        totalsByProduct.set(productId, totals);
      }

      // Verrouiller tous les produits dans un ordre stable.
      for (const productId of productIds) {
        const [products] = await connection.execute(
          `SELECT id, name, stock_quantity AS stockQuantity
           FROM products
           WHERE id = ? AND business_id = ?
           FOR UPDATE`,
          [productId, businessId]
        );

        if (products.length === 0) {
          throw new Error(`Le produit ${productId} est introuvable.`);
        }

        productsById.set(productId, products[0]);
      }

      // Vérifier le stock disponible pour TOUS les produits.
      // Aucune mise à jour n'est effectuée pendant cette vérification.
      for (const productId of productIds) {
        const product = productsById.get(productId);
        const totals = totalsByProduct.get(productId);

        const stockBefore = decimalToBigInt(
          product.stockQuantity,
          3,
          'Stock disponible'
        );

        const requestedQuantity = totals.quantityMilli;

        if (stockBefore < requestedQuantity) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(409).json({
            success: false,
            code: 'INSUFFICIENT_STOCK_FOR_PURCHASE_CANCELLATION',
            message:
              `Annulation impossible : le stock du produit "${product.name}" est insuffisant.`,
            data: {
              productId,
              availableStock: bigIntToDecimal(stockBefore, 3),
              requestedQuantity: bigIntToDecimal(requestedQuantity, 3),
            },
          });
        }

        const stockAfter = stockBefore - requestedQuantity;

        newValuesByProduct.set(productId, {
          stockBefore,
          stockAfter,
          quantityRemoved: requestedQuantity,
        });
      }

      // Toutes les vérifications sont réussies : modifier les stocks.
      for (const productId of productIds) {
        const values = newValuesByProduct.get(productId);

        await connection.execute(
          `UPDATE products
           SET stock_quantity = ?
           WHERE id = ? AND business_id = ?`,
          [
            bigIntToDecimal(values.stockAfter, 3),
            productId,
            businessId,
          ]
        );
      }

      // Créer un mouvement négatif pour chaque ligne d'achat.
      const runningStock = new Map();

      for (const productId of productIds) {
        runningStock.set(
          productId,
          newValuesByProduct.get(productId).stockBefore
        );
      }

      for (const item of items) {
        const productId = Number(item.productId);

        const quantityMilli = decimalToBigInt(
          item.quantity,
          3,
          "Quantité du mouvement d'annulation"
        );

        const unitCostCents = decimalToBigInt(
          item.unitCost,
          2,
          "Coût du mouvement d'annulation"
        );

        const stockBefore = runningStock.get(productId);
        const stockAfter = stockBefore - quantityMilli;

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
           ) VALUES (?, ?, 'purchase_cancel', ?, ?, ?, ?, 'purchase', ?, ?, ?)`,
          [
            businessId,
            productId,
            `-${bigIntToDecimal(quantityMilli, 3)}`,
            bigIntToDecimal(stockBefore, 3),
            bigIntToDecimal(stockAfter, 3),
            bigIntToDecimal(unitCostCents, 2),
            purchaseId,
            reason || `Annulation de l'achat ${purchaseId}`,
            userId,
          ]
        );

        runningStock.set(productId, stockAfter);
      }
    }

    // Modifier le statut de l'achat.
    const [updateResult] = await connection.execute(
      `UPDATE purchases
       SET status = 'cancelled'
       WHERE id = ?
         AND business_id = ?
         AND status = ?`,
      [purchaseId, businessId, purchaseStatus]
    );

    if (updateResult.affectedRows !== 1) {
      throw new Error("L'annulation de cet achat n'a pas pu être confirmée.");
    }

    // Conserver la trace de l'annulation.
    const auditDetails = {
      previousStatus: purchaseStatus,
      newStatus: 'cancelled',
      reason,
      itemCount: items.length,
      productCount: newValuesByProduct.size,
      stockUpdated: purchaseStatus === 'received',
    };

    await connection.execute(
      `INSERT INTO audit_logs (
         business_id,
         user_id,
         action,
         entity_type,
         entity_id,
         details
       ) VALUES (?, ?, 'purchase_cancelled', 'purchase', ?, ?)`,
      [
        businessId,
        userId,
        purchaseId,
        JSON.stringify(auditDetails),
      ]
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message:
        purchaseStatus === 'received'
          ? 'Achat annulé et stock retiré avec succès.'
          : 'Brouillon d’achat annulé avec succès.',
      data: {
        id: purchaseId,
        status: 'cancelled',
        stockUpdated: purchaseStatus === 'received',
        products: [...newValuesByProduct.entries()].map(
          ([productId, values]) => ({
            productId,
            quantityRemoved: bigIntToDecimal(
              values.quantityRemoved,
              3
            ),
            stockQuantity: bigIntToDecimal(
              values.stockAfter,
              3
            ),
          })
        ),
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
  listPurchases,
  getPurchaseById,
  createPurchase,
  receivePurchase,
  recordPurchasePayment,
  recordPurchaseRefund,
  cancelPurchase,
};
