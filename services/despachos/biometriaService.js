const Biometria = require("../../models/Biometria");
const Categoria = require("../../models/Categoria");
const Dependencia = require("../../models/Dependencia");
const Subdependencia = require("../../models/Subdependencia");
const { paginate } = require("../../helpers/paginationHelper");
const { executeTransaction } = require("../../helpers/transactionHelper");
const { Op } = require("sequelize");
const axios = require("axios");

// ============================================================================
// 🔧 CONFIGURACIÓN SIMPLE - COMENTA/DESCOMENTA SEGÚN NECESITES
// ============================================================================

// 🏠 PARA PRUEBAS LOCALES (descomenta esta línea, comenta la otra)
const BIOMETRIC_SERVICE_URL = "http://localhost:7000";

// 🌐 PARA PRODUCCIÓN/RENDER (descomenta esta línea, comenta la otra)
//const BIOMETRIC_SERVICE_URL = "https://captura-huellas-microservicio.onrender.com";

// ⚠️ IMPORTANTE: Solo una línea debe estar descomentada a la vez
// ============================================================================

console.log(
  `✅ Microservicio configurado en Servicio: ${BIOMETRIC_SERVICE_URL}`,
);

/**
 * Registrar o actualizar biometría
 */
exports.registrarBiometria = async (data, clientIp) => {
  const {
    id_biometria,
    cedula,
    nombre,
    rol,
    id_categoria,
    id_dependencia,
    id_subdependencia,
    huellas,
  } = data;

  return await executeTransaction(clientIp, async (t) => {
    let registro;

    // CASO 1: ACTUALIZACIÓN (Si viene ID)
    if (id_biometria) {
      registro = await Biometria.findByPk(id_biometria, { transaction: t });
      if (!registro) {
        throw new Error("Registro biométrico no encontrado para actualizar");
      }

      // Validar si cambió la cédula y si la nueva ya existe en otro registro
      if (cedula && cedula !== registro.cedula) {
        const cedulaExiste = await Biometria.findOne({
          where: { cedula, id_biometria: { [Op.ne]: id_biometria } },
          transaction: t,
        });
        if (cedulaExiste) {
          throw new Error(
            `La cédula ${cedula} ya está registrada por otra persona.`,
          );
        }
      }

      // Actualizar datos básicos
      const updateData = {
        cedula,
        nombre,
        rol,
        id_categoria,
        id_dependencia,
        id_subdependencia,
        fecha_modificacion: new Date(),
      };

      // Actualizar huellas SOLO si se enviaron nuevas
      if (huellas && huellas.length > 0) {
        updateData.template = JSON.stringify({
          templates: huellas,
          updatedAt: new Date().toISOString(),
        });
      }

      await registro.update(updateData, { transaction: t });
    } else {
      // CASO 2: CREACIÓN (Nuevo Registro)

      // Validación de Duplicados
      const existe = await Biometria.findOne({
        where: { cedula },
        transaction: t,
      });
      if (existe) {
        throw new Error(
          `La cédula ${cedula} ya posee un registro biométrico activo o inactivo.`,
        );
      }

      // Validar que vengan huellas para un registro nuevo
      if (!huellas || huellas.length === 0) {
        throw new Error(
          "Se requieren muestras de huellas para un nuevo registro.",
        );
      }

      const biometricData = JSON.stringify({
        templates: huellas,
        updatedAt: new Date().toISOString(),
      });

      registro = await Biometria.create(
        {
          cedula,
          nombre,
          rol,
          id_categoria,
          id_dependencia,
          id_subdependencia,
          template: biometricData,
        },
        { transaction: t },
      );
    }

    return {
      msg: id_biometria
        ? "Registro actualizado correctamente"
        : "Identidad biométrica registrada correctamente",
      registro,
    };
  });
};

/**
 * Comparar dos huellas directamente
 */
exports.compararHuellas = async (muestra1, muestra2) => {
  if (!muestra1 || !muestra2) {
    throw new Error("Se requieren ambas muestras para comparar");
  }

  try {
    const response = await axios.post(
      `${BIOMETRIC_SERVICE_URL}/api/verify`,
      {
        probe: muestra1,
        candidate: muestra2,
      },
      {
        timeout: BIOMETRIC_SERVICE_URL.includes("localhost") ? 10000 : 30000,
        headers: { "Content-Type": "application/json" },
      },
    );

    return response.data;
  } catch (error) {
    console.error("❌ Error en comparación directa:", error.message);
    throw new Error(`Error en el servicio biométrico: ${error.message}`);
  }
};

/**
 * Verificar identidad (Matching 1:N contra templates de una persona)
 */
exports.verificarIdentidad = async (cedula, muestraActual) => {
  console.log("=== INICIO VERIFICACIÓN BIOMÉTRICA (SERVICIO) ===");
  console.log(
    "🔧 Entorno:",
    BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER",
  );

  if (!cedula || !muestraActual) {
    throw new Error("Cédula y muestra biométrica son requeridas");
  }

  const registro = await Biometria.findOne({
    where: { cedula, estado: "ACTIVO" },
  });

  if (!registro) {
    console.log("❌ Cédula no encontrada");
    throw new Error("Persona no registrada");
  }

  const biometricData = JSON.parse(registro.template);

  console.log(
    `🔢 Comparando contra ${biometricData.templates.length} template(s)`,
  );

  const matchPromises = biometricData.templates.map(
    async (templateGuardado, index) => {
      try {
        // console.log(`📤 Enviando comparación ${index + 1}...`);

        const response = await axios.post(
          `${BIOMETRIC_SERVICE_URL}/api/verify`,
          {
            probe: muestraActual,
            candidate: templateGuardado,
          },
          {
            timeout: BIOMETRIC_SERVICE_URL.includes("localhost")
              ? 10000
              : 30000,
            headers: { "Content-Type": "application/json" },
          },
        );

        const { match, score } = response.data;
        // console.log(`✅ Template ${index + 1} - Score: ${score}, Match: ${match}`);
        return score;
      } catch (error) {
        console.error(`❌ Error template ${index + 1}:`, error.message);
        return 0;
      }
    },
  );

  const scores = await Promise.all(matchPromises);
  const mejorScore = Math.max(...scores);
  const umbral = 40;

  console.log(`🎯 Mejor score: ${mejorScore} (umbral: ${umbral})`);

  if (mejorScore >= umbral) {
    console.log(`✅ MATCH ENCONTRADO!`);
    return {
      match: true,
      score: mejorScore,
      persona: registro,
      entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER",
    };
  } else {
    console.log("❌ NO HAY COINCIDENCIA");
    return {
      match: false,
      msg: "La huella no coincide",
      score: mejorScore,
      entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER",
    };
  }
};

/**
 * Obtener listado de registros paginados
 */
exports.obtenerRegistros = async (query) => {
  const searchableFields = ["nombre", "cedula"];
  const where = { estado: "ACTIVO" };

  return await paginate(Biometria, query, {
    where,
    searchableFields,
    include: [
      { model: Categoria, as: "Categoria", attributes: ["nombre"] },
      {
        model: Dependencia,
        as: "Dependencia",
        attributes: ["nombre_dependencia"],
      },
      { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
    ],
  });
};

/**
 * Eliminar (desactivar) registro
 */
exports.eliminarRegistro = async (id) => {
  const registro = await Biometria.findByPk(id);
  if (!registro) throw new Error("Registro no encontrado");

  await registro.update({ estado: "INACTIVO", fecha_modificacion: new Date() });

  return {
    id_biometria: id,
    estado: "INACTIVO",
    msg: "Registro biométrico desactivado",
  };
};

/**
 * Verificar conexión con microservicio
 */
exports.verificarConexionMicroservicio = async () => {
  try {
    const healthCheck = await axios.get(
      BIOMETRIC_SERVICE_URL.includes("localhost")
        ? "http://localhost:7000/health"
        : "https://captura-huellas-microservicio.onrender.com/health",
      { timeout: 5000 },
    );

    return {
      conectado: healthCheck.data === "OK",
      entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER",
      urlBase: BIOMETRIC_SERVICE_URL,
      healthCheck: healthCheck.data,
      mensaje: "✅ Microservicio disponible",
    };
  } catch (error) {
    throw {
      conectado: false,
      entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER",
      urlBase: BIOMETRIC_SERVICE_URL,
      error: error.message,
      mensaje: BIOMETRIC_SERVICE_URL.includes("localhost")
        ? "❌ Microservicio local no responde. Ejecuta: java -jar target\\biometric-service-1.0-SNAPSHOT.jar"
        : "❌ Microservicio en Render no disponible. Puede estar en 'cold start'.",
    };
  }
};
