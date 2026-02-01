const VehiculoSinPlaca = require("../models/VehiculoSinPlaca");
const { withTransaction } = require("../helpers/transactionHelper");

// --- FUNCIONES AUXILIARES ---

/**
 * Obtiene o crea el registro de configuración de correlativos
 */
async function obtenerOcrearRegistro(transaction = null) {
  const options = transaction ? { transaction } : {};
  let registro = await VehiculoSinPlaca.findByPk(1, options);

  if (!registro) {
    registro = await VehiculoSinPlaca.create({
      id: 1,
      ultimo_correlativo: 53,
      prefijo: "SPMB"
    }, options);
  }

  return registro;
}

/**
 * Genera una placa a partir de un correlativo
 */
function generarPlaca(correlativo, prefijo = "SPMB") {
  return `${prefijo}${String(correlativo).padStart(4, '0')}`;
}

// --- OBTENER ÚLTIMO CORRELATIVO ---
exports.obtenerUltimoCorrelativo = async (req, res) => {
  try {
    const registro = await obtenerOcrearRegistro();

    const siguiente = registro.ultimo_correlativo + 1;

    res.json({
      correlativo: registro.ultimo_correlativo, // Mantenemos el último real
      siguiente_correlativo: siguiente,         // Enviamos el siguiente explícitamente
      placaGenerada: generarPlaca(siguiente, registro.prefijo), // Generamos la placa con el SIGUIENTE
      prefijo: registro.prefijo
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener el último correlativo" });
  }
};

// --- GENERAR SIGUIENTE CORRELATIVO ---
exports.generarSiguienteCorrelativo = async (req, res) => {
  try {
    await withTransaction(req, async (t) => {
      const registro = await obtenerOcrearRegistro(t);

      const siguienteCorrelativo = registro.ultimo_correlativo + 1;

      await registro.update({
        ultimo_correlativo: siguienteCorrelativo,
        fecha_actualizacion: new Date()
      }, { transaction: t });

      res.json({
        correlativo: siguienteCorrelativo,
        placaGenerada: generarPlaca(siguienteCorrelativo, registro.prefijo),
        prefijo: registro.prefijo
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al generar el siguiente correlativo" });
    }
  }
};

// --- ACTUALIZAR CORRELATIVO MANUALMENTE (Solo Admin) ---
exports.actualizarCorrelativo = async (req, res) => {
  const { nuevoCorrelativo } = req.body;

  try {
    await withTransaction(req, async (t) => {
      const registro = await obtenerOcrearRegistro(t);

      await registro.update({
        ultimo_correlativo: nuevoCorrelativo,
        fecha_actualizacion: new Date()
      }, { transaction: t });

      res.json({
        msg: "Correlativo actualizado exitosamente",
        correlativo: nuevoCorrelativo,
        placaGenerada: generarPlaca(nuevoCorrelativo, registro.prefijo),
        prefijo: registro.prefijo
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar el correlativo" });
    }
  }
};

// --- OBTENER CONFIGURACIÓN ACTUAL ---
exports.obtenerConfiguracion = async (req, res) => {
  try {
    const registro = await VehiculoSinPlaca.findByPk(1);

    if (!registro) {
      res.json({
        existe: false,
        mensaje: "No existe configuración de correlativos",
        valorInicial: 53,
        prefijo: "SPMB"
      });
    } else {
      res.json({
        existe: true,
        ultimo_correlativo: registro.ultimo_correlativo,
        prefijo: registro.prefijo,
        fecha_actualizacion: registro.fecha_actualizacion
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener la configuración" });
  }
};