const express = require('express');

const {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  archiveExpense,
} = require('../controllers/expenses.controller');

const { authenticateToken } = require('../middlewares/auth.middleware');

const {
  loadBusinessContext,
  requireWritableSubscription,
} = require('../middlewares/subscription.middleware');

const router = express.Router();

router.use(authenticateToken, loadBusinessContext);

// Consultation des dépenses
router.get('/', listExpenses);
router.get('/:id', getExpense);

// Gestion des dépenses
router.post('/', requireWritableSubscription, createExpense);
router.put('/:id', requireWritableSubscription, updateExpense);
router.patch('/:id/archive', requireWritableSubscription, archiveExpense);

module.exports = router;