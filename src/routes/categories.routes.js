
const express = require('express');

const { authenticateToken } = require('../middlewares/auth.middleware');
const {
  loadBusinessContext,
  requireWritableSubscription,
} = require('../middlewares/subscription.middleware');

const {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
} = require('../controllers/categories.controller');

const router = express.Router();

// Toutes les routes exigent une authentification
// et une boutique active associée à l'utilisateur.
router.use(authenticateToken, loadBusinessContext);

// GET /api/categories
router.get('/', listCategories);

// GET /api/categories/:id
router.get('/:id', getCategory);

// POST /api/categories
router.post('/', requireWritableSubscription, createCategory);

// PUT /api/categories/:id
router.put('/:id', requireWritableSubscription, updateCategory);

module.exports = router;
