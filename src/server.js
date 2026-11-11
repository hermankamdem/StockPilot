
require('dotenv').config();

const app = require('./app');
const { testConnection, pool } = require('./config/db');

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  try {
    await testConnection();

    app.listen(PORT, () => {
      console.log(`StockPilot API démarrée sur http://localhost:${PORT}`);
      console.log(`Vérification : http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Impossible de démarrer StockPilot :', error.message);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  }
}

startServer();
