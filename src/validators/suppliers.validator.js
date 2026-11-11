const { z } = require('zod');

const optionalText = (max, message) =>
  z.preprocess(
    (value) => {
      if (value === null || value === '') {
        return null;
      }

      return value;
    },
    z.string().trim().max(max, message).nullable().optional()
  );

const createSupplierSchema = z.object({
  name: z.string()
    .trim()
    .min(2, 'Le nom doit contenir au moins 2 caractères.')
    .max(150, 'Le nom ne doit pas dépasser 150 caractères.'),

  phone: optionalText(
    30,
    'Le numéro ne doit pas dépasser 30 caractères.'
  ),

  email: z.preprocess(
    (value) => value === '' ? null : value,
    z.string()
      .trim()
      .email('Adresse e-mail invalide.')
      .max(190, 'L’adresse e-mail ne doit pas dépasser 190 caractères.')
      .nullable()
      .optional()
  ),

  address: optionalText(
    255,
    'L’adresse ne doit pas dépasser 255 caractères.'
  ),

  notes: z.preprocess(
    (value) => value === '' ? null : value,
    z.string().nullable().optional()
  ),
});

const updateSupplierSchema = createSupplierSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  {
    message: 'Fournissez au moins un champ à modifier.',
  }
);

module.exports = {
  createSupplierSchema,
  updateSupplierSchema,
};