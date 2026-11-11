

const express = require('express');
const { authenticateToken } = require('../middlewares/auth.middleware');
const {
  loadBusinessContext,
  requireWritableSubscription,
} = require('../middlewares/subscription.middleware');
const {
  listProducts,
  createProduct,
} = require('../controllers/products.controller');

const router = express.Router();

router.get(
  '/',
  authenticateToken,
  loadBusinessContext,
  listProducts
);

router.post(
  '/',
  authenticateToken,
  loadBusinessContext,
  requireWritableSubscription,
  createProduct
);

module.exports = router;
