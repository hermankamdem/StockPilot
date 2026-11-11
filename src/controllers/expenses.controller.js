const { pool } = require('../config/db');
const {
  createExpenseSchema,
  updateExpenseSchema,
    listExpensesQuerySchema,

} = require('../validators/expenses.validator');

function isValidId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.toISOString().slice(0, 10) === value;
}
function hasManagementRole(req, res) {
  if (!['owner', 'manager'].includes(req.business.role)) {
    res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Vous n’avez pas les droits nécessaires pour effectuer cette opération.',
    });

    return false;
  }

  return true;
}
async function createExpense(req, res, next) {
  try {
    if (!hasManagementRole(req, res)) return;

    const validation = createExpenseSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Les données fournies sont invalides.',
        errors: validation.error.issues,
      });
    }

    const {
      category,
      description,
      amount,
      payment_method,
      expense_date,
    } = validation.data;

    const [result] = await pool.execute(
      `INSERT INTO expenses (
        business_id,
        category,
        description,
        amount,
        payment_method,
        expense_date,
        recorded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.business.id,
        category,
        description,
        amount,
        payment_method,
        expense_date
          ? new Date(expense_date).toISOString().slice(0, 19).replace('T', ' ')
          : new Date(),
        req.user.id,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Dépense enregistrée avec succès.',
      data: {
        id: result.insertId,
      },
    });
  } catch (error) {
    next(error);
  }
}
async function listExpenses(req, res, next) {
  try {
    const validation = listExpensesQuerySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_EXPENSE_FILTERS',
        message: 'Les paramètres de recherche sont invalides.',
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const {
      category,
      payment_method,
      status,
      start_date,
      end_date,
      search,
    } = validation.data;

    if (start_date && !isValidDate(start_date)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_START_DATE',
        message: 'La date de début doit respecter le format YYYY-MM-DD et être valide.',
      });
    }

    if (end_date && !isValidDate(end_date)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_END_DATE',
        message: 'La date de fin doit respecter le format YYYY-MM-DD et être valide.',
      });
    }

    if (start_date && end_date && start_date > end_date) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DATE_RANGE',
        message: 'La date de début ne peut pas être postérieure à la date de fin.',
      });
    }

    const conditions = ['e.business_id = ?'];
    const params = [req.business.id];

    if (category) {
      conditions.push('e.category = ?');
      params.push(category);
    }

    if (payment_method) {
      conditions.push('e.payment_method = ?');
      params.push(payment_method);
    }

    conditions.push('e.status = ?');
    params.push(status);

    if (start_date) {
      conditions.push('e.expense_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      conditions.push('e.expense_date < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(end_date);
    }

    if (search) {
      conditions.push('(e.description LIKE ? OR e.category LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const [expenses] = await pool.execute(
      `SELECT
         e.id,
         e.category,
         e.description,
         e.amount,
         e.payment_method,
         e.expense_date,
         e.status,
         e.created_at,
         u.full_name AS recorded_by_name
       FROM expenses e
       INNER JOIN users u ON u.id = e.recorded_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.expense_date DESC, e.id DESC`,
      params
    );

    return res.status(200).json({
      success: true,
      data: expenses,
    });
  } catch (error) {
    next(error);
  }
}
async function getExpense(req, res, next) {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Identifiant de dépense invalide.',
      });
    }

    const [expenses] = await pool.execute(
      `SELECT
         e.id,
         e.category,
         e.description,
         e.amount,
         e.payment_method,
         e.expense_date,
         e.status,
         e.created_at,
         u.full_name AS recorded_by_name
       FROM expenses e
       INNER JOIN users u ON u.id = e.recorded_by
       WHERE e.id = ?
         AND e.business_id = ?
       LIMIT 1`,
      [id, req.business.id]
    );

    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'EXPENSE_NOT_FOUND',
        message: 'Dépense introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      data: expenses[0],
    });
  } catch (error) {
    next(error);
  }
}
async function updateExpense(req, res, next) {
  try {
    if (!hasManagementRole(req, res)) return;

    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Identifiant de dépense invalide.',
      });
    }

    const validation = updateExpenseSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Les données fournies sont invalides.',
        errors: validation.error.issues,
      });
    }

    const [expenses] = await pool.execute(
      `SELECT id, status
       FROM expenses
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [id, req.business.id]
    );

    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'EXPENSE_NOT_FOUND',
        message: 'Dépense introuvable.',
      });
    }

    if (expenses[0].status === 'archived') {
      return res.status(409).json({
        success: false,
        code: 'EXPENSE_ARCHIVED',
        message: 'Une dépense archivée ne peut pas être modifiée.',
      });
    }

    const fields = [];
    const values = [];
    const data = validation.data;

    for (const field of ['category', 'description', 'amount', 'payment_method']) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }

    if (data.expense_date !== undefined) {
      fields.push('expense_date = ?');
      values.push(
        new Date(data.expense_date).toISOString().slice(0, 19).replace('T', ' ')
      );
    }

    values.push(id, req.business.id);

    await pool.execute(
      `UPDATE expenses
       SET ${fields.join(', ')}
       WHERE id = ? AND business_id = ?`,
      values
    );

    return res.status(200).json({
      success: true,
      message: 'Dépense modifiée avec succès.',
    });
  } catch (error) {
    next(error);
  }
}
async function archiveExpense(req, res, next) {
  try {
    if (!hasManagementRole(req, res)) return;

    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Identifiant de dépense invalide.',
      });
    }

    const [expenses] = await pool.execute(
      `SELECT id, status
       FROM expenses
       WHERE id = ? AND business_id = ?
       LIMIT 1`,
      [id, req.business.id]
    );

    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'EXPENSE_NOT_FOUND',
        message: 'Dépense introuvable.',
      });
    }

    if (expenses[0].status === 'archived') {
      return res.status(409).json({
        success: false,
        code: 'EXPENSE_ALREADY_ARCHIVED',
        message: 'Cette dépense est déjà archivée.',
      });
    }

    await pool.execute(
      `UPDATE expenses
       SET status = 'archived'
       WHERE id = ? AND business_id = ?`,
      [id, req.business.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Dépense archivée avec succès.',
    });
  } catch (error) {
    next(error);
  }
}
module.exports = {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  archiveExpense,
 
};