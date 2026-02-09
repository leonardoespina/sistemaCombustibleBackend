const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  String(process.env.DB_PASS || ""), // Convierte a string vacío si es undefined
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432, // ← Agregado puerto por defecto de PostgreSQL
    dialect: "postgres",
    timezone: "-04:00",
    logging: false, // Desactiva logs de SQL en consola para limpieza
    pool: { // ← Recomendado para producción
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

const dbConnect = async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Conexión a PostgreSQL exitosa.");
    
    // Sincronización controlada de modelos para evitar errores de FK
    // Importamos modelos dinámicamente aquí para evitar dependencia circular
    const models = require("../models");
    
    // Sincronización secuencial para asegurar que las tablas padre existan antes que las hijas
    console.log("⏳ Sincronizando modelos en orden jerárquico...");
    
    // 1. Tablas Independientes o de Nivel 1
    // (Usuarios, Combustibles, Categorias, Llenaderos ya suelen existir, pero sync masivo las maneja)
    
    // 2. Tablas de Cupos (Orden estricto)
    if (models.CupoBase) await models.CupoBase.sync({ alter: true });
    if (models.CupoActual) await models.CupoActual.sync({ alter: true });
    if (models.ConsumoCupo) await models.ConsumoCupo.sync({ alter: true });
    if (models.RecargaCupo) await models.RecargaCupo.sync({ alter: true });
    if (models.HistorialCupoMensual) await models.HistorialCupoMensual.sync({ alter: true });

    // 3. Sincronización final del resto de la base de datos
    await sequelize.sync({ alter: true });
    
    console.log("✅ Modelos sincronizados con PostgreSQL.");
  } catch (error) {
    console.error("❌ Error conectando a PostgreSQL:", error);
    process.exit(1);
  }
};

module.exports = { sequelize, dbConnect };