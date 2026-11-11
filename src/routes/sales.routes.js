
const express = require('express');

const {
  listSales,
  getSaleById,
  createSale,
  confirmSale,
    cancelSale,
      createSalePayment,
} = require('../controllers/sales.controller');

const {
  authenticateToken,
} = require('../middlewares/auth.middleware');

const {
  loadBusinessContext,
  requireWritableSubscription,
} = require('../middlewares/subscription.middleware');

const router = express.Router();

router.use(authenticateToken);
router.use(loadBusinessContext);

router.get('/', listSales);
router.get('/:id', getSaleById);
router.post(
  '/:id/confirm',
  requireWritableSubscription,
  confirmSale
);

router.post(
  '/',
  requireWritableSubscription,
  createSale
);
router.post(
  '/:id/cancel',
  requireWritableSubscription,
  cancelSale
);
router.post(
  '/:id/payments',
  requireWritableSubscription,
  createSalePayment
);
module.exports = router;
