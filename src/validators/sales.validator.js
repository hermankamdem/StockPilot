
const { z } = require('zod');

const saleItemSchema = z.object({
  productId: z.coerce
    .number()
    .int('L’identifiant du produit doit être un entier.')
    .positive('Le produit est obligatoire.'),

  quantity: z.coerce
    .number()
    .positive('La quantité doit être supérieure à zéro.')
    .refine(
      (value) =>
        Number.isFinite(value) &&
        Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7,
      'La quantité doit comporter au maximum 3 décimales.'
    ),
});

const createSaleSchema = z.object({
  customerId: z.coerce
    .number()
    .int()
    .positive()
    .nullable()
    .optional(),

  notes: z.string().trim().max(2000).nullable().optional(),

  items: z
    .array(saleItemSchema)
    .min(1, 'Une vente doit contenir au moins un produit.')
    .max(100, 'Une vente ne peut pas contenir plus de 100 lignes.'),
});
const createSalePaymentSchema = z.object({
  amount: z.coerce
    .number()
    .positive('Le montant du paiement doit être supérieur à zéro.')
    .finite('Le montant doit être un nombre valide.')
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
      'Le montant doit comporter au maximum 2 décimales.'
    ),

  paymentMethod: z.enum([
    'cash',
    'mtn_momo',
    'orange_money',
    'bank_transfer',
    'other',
  ]),

  transactionReference: z.string().trim().max(120).nullable().optional(),

  paymentDate: z.coerce.date().optional(),

 notes: z.string().trim().max(255).nullable().optional(),
});

module.exports = { 
  createSaleSchema,
  createSalePaymentSchema 
  };