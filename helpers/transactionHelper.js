const { sequelize } = require('../config/database');

/**
 * Ejecuta una operación dentro de una transacción de Sequelize,
 * configurando previamente la IP del cliente para que sea accesible
 * desde los triggers de auditoría de PostgreSQL.
 * 
 * @param {Object} req - Objeto Request de Express (para obtener la IP)
 * @param {Function} callback - Función asíncrona que recibe la transacción 't'
 * @returns {Promise<any>} - El resultado de la función callback
 */
const withTransaction = async (req, callback) => {
  const t = await sequelize.transaction();
  try {
    // Configurar IP para el trigger de auditoría
    // Nota: req.ip puede ser ::1 en local, Postgres lo maneja como INET válido.
    const clientIp = req.ip || '127.0.0.1';
    
    // Seteamos la variable de configuración local para esta transacción
    await sequelize.query(`SET LOCAL app.current_ip = :ip`, {
      replacements: { ip: clientIp },
      transaction: t
    });

    // Ejecutamos la lógica del controlador pasando la transacción
    const result = await callback(t);

    await t.commit();
    return result;
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

module.exports = { withTransaction };
