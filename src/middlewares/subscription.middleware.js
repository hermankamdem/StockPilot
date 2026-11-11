
const { pool } = require('../config/db');

async function loadBusinessContext(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise.',
      });
    }

    const [rows] = await pool.execute(
      `SELECT
         b.id AS business_id,
         b.name AS business_name,
         b.status AS business_status,
         bu.role AS user_role,
         s.id AS subscription_id,
         s.status AS subscription_status,
         s.trial_ends_at,
         s.end_date,
         s.next_payment_date,
         s.amount,
         p.id AS plan_id,
         p.name AS plan_name,
         p.max_users,
         p.max_products
       FROM business_users bu
       INNER JOIN businesses b
         ON b.id = bu.business_id
       LEFT JOIN subscriptions s
         ON s.current_business_id = b.id
       LEFT JOIN plans p
         ON p.id = s.plan_id
       WHERE bu.user_id = ?
         AND bu.status = 'active'
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Aucune entreprise active associée à ce compte.',
      });
    }

    req.business = {
      id: rows[0].business_id,
      name: rows[0].business_name,
      status: rows[0].business_status,
      role: rows[0].user_role,
    };

    req.subscription = rows[0].subscription_id
      ? {
          id: rows[0].subscription_id,
          status: rows[0].subscription_status,
          trialEndsAt: rows[0].trial_ends_at,
          endDate: rows[0].end_date,
          nextPaymentDate: rows[0].next_payment_date,
          amount: rows[0].amount,
          planId: rows[0].plan_id,
          planName: rows[0].plan_name,
          maxUsers: rows[0].max_users,
          maxProducts: rows[0].max_products,
        }
      : null;

    next();
  } catch (error) {
    next(error);
  }
}

async function requireWritableSubscription(req, res, next) {
  try {
    if (!req.business || !req.subscription) {
      return res.status(403).json({
        success: false,
        message: 'Aucun abonnement courant disponible.',
      });
    }

    if (req.business.status !== 'active') {
      return res.status(403).json({
        success: false,
        code: 'BUSINESS_NOT_ACTIVE',
        message: 'Cette entreprise ne peut pas effectuer d’opérations.',
      });
    }

    const subscription = req.subscription;

    if (subscription.status === 'trial') {
      const [rows] = await pool.execute(
        `SELECT (trial_ends_at > NOW()) AS trial_is_valid
         FROM subscriptions
         WHERE id = ?
         LIMIT 1`,
        [subscription.id]
      );

      if (
        !subscription.trialEndsAt ||
        rows.length === 0 ||
        Number(rows[0].trial_is_valid) !== 1
      ) {
        return res.status(403).json({
          success: false,
          code: 'TRIAL_EXPIRED',
          message: 'Votre essai gratuit est terminé. Passez à un abonnement payant pour reprendre les opérations.',
          readOnly: true,
        });
      }
    } else if (subscription.status === 'active') {
      const [rows] = await pool.execute(
        `SELECT (
           end_date IS NULL OR end_date >= CURDATE()
         ) AS subscription_is_valid
         FROM subscriptions
         WHERE id = ?
         LIMIT 1`,
        [subscription.id]
      );

      if (
        rows.length === 0 ||
        Number(rows[0].subscription_is_valid) !== 1
      ) {
        return res.status(403).json({
          success: false,
          code: 'SUBSCRIPTION_EXPIRED',
          message: 'Votre abonnement a expiré. Renouvelez-le pour reprendre les opérations.',
          readOnly: true,
        });
      }
     } else {
      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_NOT_WRITABLE',
        message: 'Votre abonnement ne permet pas actuellement de modifier les données.',
        readOnly: true,
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
function requireActiveBusiness(req, res, next) {
  if (!req.business) {
    return res.status(403).json({
      success: false,
      message: 'Contexte entreprise indisponible.',
    });
  }

  if (req.business.status !== 'active') {
    return res.status(403).json({
      success: false,
      code: 'BUSINESS_NOT_ACTIVE',
      message: 'Cette entreprise ne peut pas effectuer d’opérations.',
    });
  }

  next();
}

module.exports = {
  loadBusinessContext,
  requireWritableSubscription,
    requireActiveBusiness,
};
