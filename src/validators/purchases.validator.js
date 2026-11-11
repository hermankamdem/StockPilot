
const { z } = require('zod');


const purchaseItemSchema = z.object({
  productId: z.coerce
    .number()
    .int("L'identifiant du produit doit être un entier.")
    .positive('Le produit est obligatoire.'),

  quantity: z.union([
    z.string(),
    z.number().finite(),
  ])
    .transform((value) => String(value).trim())
    .superRefine((value, ctx) => {
      const pattern = /^\d+(?:\.\d{1,3})?$/;

      if (!pattern.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'La quantité doit comporter au maximum 3 décimales.',
        });
        return;
      }

      const [integerPart, decimalPart = ''] = value.split('.');
      const quantityMilli =
        BigInt(integerPart) * 1000n +
        BigInt(decimalPart.padEnd(3, '0'));

      if (quantityMilli <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'La quantité doit être supérieure à zéro.',
        });
        return;
      }

      if (quantityMilli > 999999999999999n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'La quantité dépasse la limite autorisée.',
        });
      }
    }),

 
 
  unitCost: z.union([
    z.string(),
    z.number().finite(),
  ])
    .transform((value) => String(value).trim())
    .superRefine((value, ctx) => {
      const pattern = /^\d+(?:\.\d{1,2})?$/;

      if (!pattern.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Le coût unitaire doit comporter au maximum 2 décimales.',
        });
        return;
      }

      const [integerPart, decimalPart = ''] = value.split('.');

      const costCents =
        BigInt(integerPart) * 100n +
        BigInt(decimalPart.padEnd(2, '0'));

      if (costCents > 999999999999999n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Le coût unitaire dépasse la limite autorisée.',
        });
      }
    }),
  });

const createPurchaseSchema = z.object({
  supplierId: z.coerce
    .number()
    .int()
    .positive()
    .nullable()
    .optional(),

  reference: z.string().trim().min(1).max(80).optional(),

  purchaseDate: z
  .string()
  .datetime()
  .optional()
  .refine(
    (value) => !value || new Date(value).getTime() <= Date.now(),
    'La date de l’achat ne peut pas être dans le futur.'
  ),

  notes: z.string().trim().max(2000).nullable().optional(),

  items: z
    .array(purchaseItemSchema)
    .min(1, 'Un achat doit contenir au moins un produit.')
    .max(100, 'Un achat ne peut pas contenir plus de 100 lignes.'),
});

const financialOperationSchema = z.object({
 
  amount: z.union([
    z.string(),
    z.number().finite(),
  ])
    .transform((value) => String(value).trim())
    .superRefine((value, ctx) => {
      const pattern = /^\d+(?:\.\d{1,2})?$/;

      if (!pattern.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Le montant doit comporter au maximum 2 décimales.',
        });
        return;
      }

      const [integerPart, decimalPart = ''] = value.split('.');

      const amountInCents =
        BigInt(integerPart) * 100n +
        BigInt(decimalPart.padEnd(2, '0'));

      if (amountInCents <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
         message: 'Le montant de l’opération financière doit être supérieur à zéro.',
        });
        return;
      }

      if (amountInCents > 999999999999999n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
         message: 'Le montant dépasse la limite autorisée pour une opération financière.',
        });
      }
    }),

  paymentMethod: z.enum([
    'cash',
    'mtn_momo',
    'orange_money',
    'bank_transfer',
    'other',
  ]),

  transactionReference: z.string().trim().max(120).nullable().optional(),

  paymentDate: z
  .string()
  .datetime()
  .optional()
  .refine(
    (value) => !value || new Date(value).getTime() <= Date.now(),
    'La date du paiement ne peut pas être dans le futur.'
  ),

  notes: z.string().trim().max(255).nullable().optional(),
});
const recordPurchasePaymentSchema = financialOperationSchema;
const recordPurchaseRefundSchema = financialOperationSchema;

module.exports = {
  createPurchaseSchema,
  recordPurchasePaymentSchema,
  recordPurchaseRefundSchema,
};
