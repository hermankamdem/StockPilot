const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    console.log('Connexion à la base de données établie.');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        migration VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_schema_migrations_migration (migration)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const [existing] = await connection.execute(
        'SELECT id FROM schema_migrations WHERE migration = ?',
        [file]
      );

      if (existing.length > 0) {
        console.log(`Déjà appliquée : ${file}`);
        continue;
      }

      const sql = fs.readFileSync(
        path.join(MIGRATIONS_DIR, file),
        'utf8'
      ).trim();

      if (!sql) {
        throw new Error(`Migration vide : ${file}`);
      }

      console.log(`Exécution : ${file}`);

      await connection.query(sql);

      await connection.execute(
        'INSERT INTO schema_migrations (migration) VALUES (?)',
        [file]
      );

      console.log(`Migration appliquée : ${file}`);
    }

    console.log('Toutes les migrations ont été traitées.');
  } catch (error) {
    console.error('Erreur pendant les migrations :', error.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigrations();