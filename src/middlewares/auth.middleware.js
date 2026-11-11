
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

async function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentification requise.',
    });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({
      success: false,
      message: 'Configuration de sécurité manquante.',
    });
  }

  const token = authorization.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload.sub) {
      return res.status(401).json({
        success: false,
        message: 'Jeton invalide.',
      });
    }

    const [users] = await pool.execute(
      `SELECT id, full_name, email, phone, status
       FROM users
       WHERE id = ? AND status = 'active'
       LIMIT 1`,
      [payload.sub]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Compte introuvable ou désactivé.',
      });
    }

    req.user = users[0];
    return next();
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError' ||
      error.name === 'NotBeforeError'
    ) {
      return res.status(401).json({
        success: false,
        message: 'Jeton invalide ou expiré.',
      });
    }

    return next(error);
  }
}

module.exports = { authenticateToken };
