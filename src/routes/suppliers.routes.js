const express = require('express');

const {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  archiveSupplier,
  getSupplierHistory,
} = require('../controllers/suppliers.controller');

const { authenticateToken } = require('../middlewares/auth.middleware');

const {
  loadBusinessContext,
  requireWritableSubscription,
} = require('../middlewares/subscription.middleware');

const router = express.Router();

router.use(authenticateToken, loadBusinessContext);

router.get('/', listSuppliers);
router.get('/:id/history', getSupplierHistory);
router.get('/:id', getSupplier);

router.post('/', requireWritableSubscription, createSupplier);
router.put('/:id', requireWritableSubscription, updateSupplier);
router.patch('/:id/archive', requireWritableSubscription, archiveSupplier);

module.exports = router;