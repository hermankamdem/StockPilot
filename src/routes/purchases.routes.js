
const express = require('express');

const {
  listPurchases,
  getPurchaseById,
  createPurchase,
  receivePurchase,
  recordPurchasePayment,
  recordPurchaseRefund,
  cancelPurchase,
} = require('../controllers/purchases.controller');

const { authenticateToken } = require('../middlewares/auth.middleware');

const {
  loadBusinessContext,
  requireWritableSubscription,
  requireActiveBusiness,
} = require('../middlewares/subscription.middleware');

const router = express.Router();

router.use(authenticateToken);
router.use(loadBusinessContext);

// Liste des achats
router.get('/', listPurchases);

// Détails d'un achat
router.get('/:id', getPurchaseById);

// Création d'un brouillon d'achat
router.post('/', requireWritableSubscription, createPurchase);
router.post(
  '/:id/receive',
  requireWritableSubscription,
  receivePurchase
);
router.post(
  '/:id/payments',
  requireWritableSubscription,
  recordPurchasePayment
);

router.post(
  '/:id/refunds',
  requireActiveBusiness,
  recordPurchaseRefund
);
// Annulation d'un achat
router.post(
  '/:id/cancel',
  requireActiveBusiness,
  cancelPurchase
);
module.exports = router;
