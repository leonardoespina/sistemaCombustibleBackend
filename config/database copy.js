const { Sequelize } = require("sequelize");
require("dotenv").config();

// ==========================================
// MODO DE CONEXIÓN: 'local' o 'supabase'
const mode = 'local'; 
// const mode = 'supabase';
// ==========================================

const isSupabase = mode === 'supabase';

let sequelize;

if (isSupabase) {
  // Configuración sugerida por Supabase
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL no definida en el archivo .env');
  }

  sequelize = new Sequelize(connectionString, {
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    logging: false,
    define: {
      underscored: true,
      freezeTableName: true,
    },
  });
} else {
  // Configuración Local
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      dialect: "postgres",
      timezone: "-04:00",
      logging: false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  );
}

const dbConnect = async () => {
  try {
    await sequelize.authenticate();
    console.log(`✅ Conexión a PostgreSQL (${mode.toUpperCase()}) exitosa.`);
    // await sequelize.sync({ alter: true }); // Comentado por seguridad en producción si prefieres
    console.log("✅ Autenticación completada.");
  } catch (error) {
    console.error(`❌ Error conectando a PostgreSQL (${mode.toUpperCase()}):`, error);
    process.exit(1);
  }
};

module.exports = { sequelize, dbConnect };
