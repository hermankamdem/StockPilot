
const { z } = require('zod');

const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères.').max(100, 'Le nom ne doit pas dépasser 100 caractères.'),
  description: z.preprocess(
    (value) => {
      if (value === null || value === '') {
        return undefined;
      }

      return value;
    },
    z.string()
      .trim()
      .max(255, 'La description ne doit pas dépasser 255 caractères.')
      .optional()
  ),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères.').max(100, 'Le nom ne doit pas dépasser 100 caractères.').optional(),
  description: z.preprocess(
    (value) => {
      if (value === null) {
        return null;
      }

      if (value === '') {
        return null;
      }

      return value;
    },
    z.string()
      .trim()
      .max(255, 'La description ne doit pas dépasser 255 caractères.')
      .nullable()
      .optional()
  ),
}).refine(
  (data) => data.name !== undefined || data.description !== undefined,
  {
    message: 'Fournissez au moins un champ à modifier.',
  }
);

module.exports = {
  createCategorySchema,
  updateCategorySchema,
};
