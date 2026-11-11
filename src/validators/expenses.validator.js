const { z } = require('zod');

const paymentMethods = [
  'cash',
  'mtn_momo',
  'orange_money',
  'bank_transfer',
  'other',
];

const createExpenseSchema = z.object({
  category: z.string()
    .trim()
    .min(2, 'La catégorie doit contenir au moins 2 caractères.')
    .max(100, 'La catégorie ne doit pas dépasser 100 caractères.'),

  description: z.string()
    .trim()
    .min(2, 'La description doit contenir au moins 2 caractères.')
    .max(255, 'La description ne doit pas dépasser 255 caractères.'),

  amount: z.coerce.number()
    .positive('Le montant doit être supérieur à zéro.')
    .finite('Le montant doit être un nombre valide.'),

  payment_method: z.enum(paymentMethods, {
  error: 'Le moyen de paiement est invalide.',
}),

  expense_date: z.string()
    .datetime({ offset: true })
    .optional(),
});

const updateExpenseSchema = createExpenseSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  {
    message: 'Fournissez au moins un champ à modifier.',
  }
);
const listExpensesQuerySchema = z.object({
  category: z.string().trim().min(2).max(100).optional(),

  payment_method: z.enum(paymentMethods).optional(),

  status: z.enum(['active', 'archived']).default('active'),

  start_date: z.string().optional(),
  end_date: z.string().optional(),

  search: z.string().trim().max(100).optional(),
});

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
    listExpensesQuerySchema,

};