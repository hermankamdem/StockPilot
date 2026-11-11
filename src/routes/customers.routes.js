const express = require('express');

const {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  archiveCustomer,
  getCustomerHistory,
} = require('../controllers/customers.controller');

const { authenticateToken } = require('../middlewares/auth.middleware');

const {
  loadBusinessContext,
  requireWritableSubscription,
} = require('../middlewares/subscription.middleware');

const router = express.Router();

router.use(authenticateToken, loadBusinessContext);

router.get('/', listCustomers);
router.get('/:id/history', getCustomerHistory);
router.get('/:id', getCustomer);

router.post('/', requireWritableSubscription, createCustomer);
router.put('/:id', requireWritableSubscription, updateCustomer);
router.patch('/:id/archive', requireWritableSubscription, archiveCustomer);

module.exports = router;
