
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const {
  registerSchema,
  loginSchema,
} = require('../validators/auth.validator');

// INSCRIPTION
async function register(req, res, next) {
  let connection;
  let transactionStarted = false;

  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Données d’inscription invalides.',
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'La configuration de sécurité du serveur est incomplète.',
      });
    }

    const {
      fullName,
      email,
      password,
      phone,
      businessName,
      planId,
    } = validation.data;

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Vérifier que le forfait existe et est actif.
    const [plans] = await connection.execute(
      `SELECT id, name, monthly_price, max_users, max_products
       FROM plans
       WHERE id = ? AND status = 'active'
       LIMIT 1`,
      [planId]
    );

    if (plans.length === 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: 'Le forfait sélectionné est introuvable ou inactif.',
      });
    }

    // Vérifier si l'adresse e-mail est déjà utilisée.
    const [existingUsers] = await connection.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (existingUsers.length > 0) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: 'Cette adresse e-mail est déjà utilisée.',
      });
    }

    // Ne jamais enregistrer le mot de passe en clair.
    const passwordHash = await bcrypt.hash(password, 12);

    const [userResult] = await connection.execute(
      `INSERT INTO users (full_name, email, password_hash, phone, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [fullName, email, passwordHash, phone || null]
    );

    const userId = userResult.insertId;
    const plan = plans[0];

    // Créer l'entreprise.
    const [businessResult] = await connection.execute(
      `INSERT INTO businesses
         (name, phone, email, currency, timezone, status)
       VALUES (?, ?, ?, 'XAF', 'Africa/Douala', 'active')`,
      [businessName, phone || null, email]
    );

    const businessId = businessResult.insertId;

    // Associer l'utilisateur à son entreprise comme propriétaire.
    await connection.execute(
      `INSERT INTO business_users
         (business_id, user_id, role, status)
       VALUES (?, ?, 'owner', 'active')`,
      [businessId, userId]
    );

    // Créer l'abonnement d'essai gratuit de cinq jours.
    await connection.execute(
      `INSERT INTO subscriptions
         (business_id, plan_id, status, start_date, trial_ends_at,
          end_date, next_payment_date, amount, current_business_id)
       VALUES (
         ?, ?, 'trial', CURDATE(),
         DATE_ADD(NOW(), INTERVAL 5 DAY),
         NULL,
         DATE_ADD(CURDATE(), INTERVAL 5 DAY),
         ?, ?
       )`,
      [businessId, plan.id, plan.monthly_price, businessId]
    );

    // Valider toutes les créations ensemble.
    await connection.commit();
    transactionStarted = false;

    // Créer le jeton de connexion.
    const token = jwt.sign(
      { sub: String(userId) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Compte créé avec succès. Votre essai gratuit a commencé.',
      token,
      user: {
        id: userId,
        fullName,
        email,
        phone: phone || null,
      },
      business: {
        id: businessId,
        name: businessName,
        currency: 'XAF',
        role: 'owner',
      },
      subscription: {
        planId: plan.id,
        planName: plan.name,
        amount: plan.monthly_price,
        status: 'trial',
        trialDays: 5,
      },
    });
  } catch (error) {
    if (connection && transactionStarted) {
      await connection.rollback().catch(() => {});
    }

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Cette adresse e-mail ou cette ressource existe déjà.',
      });
    }

    next(error);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

// CONNEXION
async function login(req, res, next) {
  try {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Données de connexion invalides.',
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'La configuration de sécurité du serveur est incomplète.',
      });
    }

    const { email, password } = validation.data;

    const [users] = await pool.execute(
      `SELECT id, full_name, email, password_hash, phone, status
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (
      users.length === 0 ||
      users[0].status !== 'active' ||
      !(await bcrypt.compare(password, users[0].password_hash))
    ) {
      return res.status(401).json({
        success: false,
        message: 'Adresse e-mail ou mot de passe incorrect.',
      });
    }

    const user = users[0];

    const [businesses] = await pool.execute(
      `SELECT b.id, b.name, b.currency, bu.role
       FROM business_users bu
       INNER JOIN businesses b ON b.id = bu.business_id
       WHERE bu.user_id = ?
         AND bu.status = 'active'
         AND b.status = 'active'
       ORDER BY b.id`,
      [user.id]
    );

    const token = jwt.sign(
      { sub: String(user.id) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Connexion réussie.',
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
      },
      businesses,
    });
  } catch (error) {
    next(error);
  }
}

// PROFIL DE L'UTILISATEUR CONNECTÉ
async function me(req, res) {
  return res.status(200).json({
    success: true,
    user: {
      id: req.user.id,
      fullName: req.user.full_name,
      email: req.user.email,
      phone: req.user.phone,
    },
  });
}

module.exports = { register, login, me };
