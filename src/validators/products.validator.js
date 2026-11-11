
const { z } = require('zod');

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(180),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  unit: z.string().trim().min(1).max(30).default('piece'),
  purchasePrice: z.coerce.number().finite().min(0).default(0),
  sellingPrice: z.coerce.number().finite().min(0).default(0),
  initialStock: z.coerce.number().finite().min(0).default(0),
  alertThreshold: z.coerce.number().finite().min(0).default(0),
});

module.exports = { createProductSchema };
