
const mysql = require('mysql2/promise');

const requiredEnv = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
];

for (const key of requiredEnv) {
  if (process.env[key] === undefined) {
    throw new Error(`Variable d'environnement manquante : ${key}`);
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  const connection = await pool.getConnection();

  try {
    await connection.ping();
    console.log('Connexion MySQL réussie.');
  } finally {
    connection.release();
  }
}

module.exports = { pool, testConnection };
