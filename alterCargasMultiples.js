require("dotenv").config({ path: "./.env" });
const { sequelize } = require("./config/database");
const { DataTypes } = require("sequelize");

async function execute() {
    try {
        await sequelize.authenticate();
        console.log("Conexión a la base de datos establecida.");

        // 1. Crear tabla cargas_cisterna_tanques
        await sequelize.query(`
      CREATE TABLE IF NOT EXISTS cargas_cisterna_tanques (
        id SERIAL PRIMARY KEY,
        id_carga INTEGER NOT NULL REFERENCES cargas_cisterna(id_carga) ON DELETE CASCADE,
        id_tanque INTEGER NOT NULL REFERENCES tanques(id_tanque),
        medida_inicial DECIMAL(10, 2),
        medida_final DECIMAL(10, 2),
        litros_iniciales DECIMAL(15, 2),
        litros_finales DECIMAL(15, 2),
        litros_recibidos DECIMAL(15, 2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
        console.log("Tabla cargas_cisterna_tanques creada/verificada exitosamente.");

        // 2. Relajar constricciones en cargas_cisterna para hacerlas allowNull
        // Los campos de tanque quedarán opcionales ya que la información estara en la tabla de detalle.
        const camposAlterar = [
            'id_tanque', 'medida_inicial', 'medida_final',
            'litros_iniciales', 'litros_finales'
        ];

        for (const campo of camposAlterar) {
            try {
                await sequelize.query(`ALTER TABLE cargas_cisterna ALTER COLUMN ${campo} DROP NOT NULL;`);
                console.log(`Columna ${campo} en cargas_cisterna modificada a NULLable.`);
            } catch (err) {
                // Ignorar si ya era NULLable
                console.log(`Omitiendo modificación de ${campo}: ${err.message}`);
            }
        }

        console.log("Migración completada con éxito.");
    } catch (error) {
        console.error("Error al ejecutar script:", error);
    } finally {
        await sequelize.close();
    }
}

execute();
