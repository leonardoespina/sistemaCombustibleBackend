const Usuario = require("../models/Usuario");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");
const Categoria = require("../models/Categoria");
const Dependencia = require("../models/Dependencia");
const Subdependencia = require("../models/Subdependencia");

// --- CREAR USUARIO (Solo Admin) ---
exports.crearUsuario = async (req, res) => {
  const {
    nombre,
    apellido,
    cedula,
    password,
    tipo_usuario,
    id_categoria,
    id_dependencia,
    id_subdependencia,
  } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Verificar Cédula Duplicada
      let usuario = await Usuario.findOne({
        where: { cedula },
        transaction: t,
      });
      if (usuario) {
        return res.status(400).json({ msg: "La cédula ya está registrada" });
      }

      // 2. Hashear Password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // 3. Guardar en BD
      usuario = await Usuario.create(
        {
          nombre,
          apellido,
          cedula,
          password: hashedPassword,
          tipo_usuario: tipo_usuario || "INSPECTOR",
          registrado_por: req.usuario.id_usuario, // ID del Admin
          fecha_registro: new Date(),
          estado: "ACTIVO",
          id_categoria,
          id_dependencia,
          id_subdependencia,
        },
        { transaction: t },
      );

      // Notificar a clientes (fuera de la transacción idealmente, pero aquí está bien)
      req.io.emit("usuarios:creado", usuario);

      res.status(201).json({
        msg: "Usuario creado exitosamente",
        usuario,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error en el servidor" });
    }
  }
};

// --- LOGIN (Público) ---
exports.loginUsuario = async (req, res) => {
  const { cedula, password, forzar } = req.body;

  try {
    const usuario = await Usuario.findOne({
      where: { cedula },
      include: [{ model: Dependencia, as: "Dependencia" }],
    });

    if (!usuario)
      return res.status(400).json({ msg: "Credenciales incorrectas (Cédula)" });
    if (usuario.estado !== "ACTIVO")
      return res.status(403).json({ msg: "Usuario Inactivo" });

    const isMatch = await bcrypt.compare(password, usuario.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ msg: "Credenciales incorrectas (Password)" });

    // CONTROL DE SESIÓN ÚNICA - Mejorado (Verificación de presencia real)
    if (usuario.id_sesion && !forzar) {
      // Verificamos si el usuario tiene realmente algún socket conectado en el servidor
      // Usamos el registro activeSockets que creamos en app.js
      const userSockets = req.io.activeSockets?.get(usuario.id_usuario);
      const isActuallyOnline = userSockets && userSockets.size > 0;

      console.log(
        `[DEBUG Login] Usuario: ${usuario.id_usuario}, id_sesion_en_bd: ${usuario.id_sesion}, isActuallyOnline: ${isActuallyOnline}`,
      );

      if (isActuallyOnline) {
        // Hay alguien conectado realmente, pedimos confirmación
        return res.status(409).json({
          msg: "Ya tienes una sesión abierta. ¿Deseas cerrarla en el otro dispositivo para continuar aquí?",
          sesion_activa: true,
        });
      }

      // Si no hay sockets activos, la sesión en BD es "huérfana" (ej. cierre sucio o reinicio)
      // Permitimos el paso sin preguntar
    }

    // Si llegamos aquí es porque o no había sesión, o el usuario aceptó FORZAR el inicio.
    if (usuario.id_sesion && forzar) {
      // EXPULSIÓN INMEDIATA: Notificar al socket del otro dispositivo que debe cerrarse.
      // Usamos la sala privada 'usuario_ID' que creamos en app.js
      if (req.io) {
        req.io.to(`usuario_${usuario.id_usuario}`).emit("sesion:expulsar");
        console.log(
          `Emitida orden de expulsión para el usuario ${usuario.id_usuario}`,
        );
      }
    }

    // Generar un ID de sesión único para esta conexión
    const nuevoIdSesion = crypto.randomUUID();

    await usuario.update({
      ultimo_acceso: new Date(),
      id_sesion: nuevoIdSesion,
    });

    const payload = {
      id_usuario: usuario.id_usuario,
      tipo_usuario: usuario.tipo_usuario,
      nombre: usuario.nombre,
      id_sesion: nuevoIdSesion, // Incluimos el ID de sesión en el token
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    res.json({ msg: "Login OK", token, usuario });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error en el login" });
  }
};

// --- LOGOUT (Privado) ---
exports.logoutUsuario = async (req, res) => {
  try {
    const { id_usuario } = req.usuario;

    // Limpiar el ID de sesión en la base de datos
    await Usuario.update({ id_sesion: null }, { where: { id_usuario } });

    res.json({ msg: "Sesión cerrada correctamente" });
  } catch (error) {
    console.error("Error en logout:", error);
    res.status(500).json({ msg: "Error al cerrar sesión" });
  }
};

// --- OBTENER USUARIOS (Solo Admin) ---
exports.obtenerUsuarios = async (req, res) => {
  try {
    const searchableFields = ["nombre", "apellido", "cedula"];

    const where = {};
    // Solo permitimos ver INACTIVOS si es admin.
    // Aunque este controlador usualmente solo es para admins, mantenemos consistencia.
    if (!req.usuario || req.usuario.tipo_usuario !== "ADMIN") {
      where.estado = "ACTIVO";
    }

    const paginatedResults = await paginate(Usuario, req.query, {
      where,
      searchableFields,
      attributes: { exclude: ["password"] },
      include: [
        {
          model: Categoria,
          as: "Categoria",
          attributes: ["id_categoria", "nombre"],
        },
        {
          model: Dependencia,
          as: "Dependencia",
          attributes: ["id_dependencia", "nombre_dependencia"],
        },
        {
          model: Subdependencia,
          as: "Subdependencia",
          attributes: ["id_subdependencia", "nombre"],
        },
      ],
    });

    res.json(paginatedResults);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error obteniendo usuarios" });
  }
};

// --- ACTUALIZAR USUARIO (Solo Admin - PUT) ---
exports.actualizarUsuario = async (req, res) => {
  const { id } = req.params; // ID del usuario a editar
  const { password, cedula, ...restoDatos } = req.body; // Separamos password y cedula para tratarlos especial

  try {
    await withTransaction(req, async (t) => {
      // 1. Verificar si el usuario existe
      let usuario = await Usuario.findByPk(id, { transaction: t });
      if (!usuario) {
        return res.status(404).json({ msg: "Usuario no encontrado" });
      }

      // 2. Verificar si cambiaron la cédula y si ya existe otra igual
      if (cedula && cedula !== usuario.cedula) {
        const cedulaExiste = await Usuario.findOne({
          where: {
            cedula,
            id_usuario: { [Op.ne]: id },
          },
          transaction: t,
        });
        if (cedulaExiste) {
          return res
            .status(400)
            .json({ msg: "La cédula ya está registrada por otro usuario" });
        }
        usuario.cedula = cedula;
      }

      // 3. Verificar si enviaron contraseña nueva para hashearla
      if (password) {
        const salt = await bcrypt.genSalt(10);
        usuario.password = await bcrypt.hash(password, salt);
      }

      // 4. Actualizar resto de campos
      Object.assign(usuario, restoDatos);

      // Actualizamos la fecha de modificación
      usuario.fecha_modificacion = new Date();

      // 5. Guardar cambios
      await usuario.save({ transaction: t });

      // Notificar a clientes
      req.io.emit("usuarios:actualizado", usuario);

      res.json({
        msg: "Usuario actualizado correctamente",
        usuario,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar usuario" });
    }
  }
};

// --- ELIMINAR (DESACTIVAR) USUARIO (Solo Admin - DELETE) ---
exports.desactivarUsuario = async (req, res) => {
  const { id } = req.params;

  try {
    await withTransaction(req, async (t) => {
      // 1. Buscar usuario
      const usuario = await Usuario.findByPk(id, { transaction: t });

      if (!usuario) {
        return res.status(404).json({ msg: "Usuario no encontrado" });
      }

      // 2. Validar que no se esté eliminando a sí mismo
      if (usuario.id_usuario === req.usuario.id_usuario) {
        return res.status(400).json({
          msg: "No puedes desactivar tu propio usuario administrador",
        });
      }

      // 3. Soft Delete: Cambiar estado a INACTIVO
      await usuario.update(
        {
          estado: "INACTIVO",
          fecha_modificacion: new Date(),
        },
        { transaction: t },
      );

      // Notificar a clientes
      req.io.emit("usuarios:actualizado", usuario);

      res.json({ msg: "Usuario desactivado exitosamente (Soft Delete)" });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al desactivar usuario" });
    }
  }
};

// --- CAMBIAR CONTRASEÑA (Propio Usuario) ---
exports.cambiarPassword = async (req, res) => {
  const { passwordActual, nuevaPassword } = req.body;
  const { id_usuario } = req.usuario;

  try {
    const usuario = await Usuario.findByPk(id_usuario);
    if (!usuario) return res.status(404).json({ msg: "Usuario no encontrado" });

    // 1. Verificar password actual
    const isMatch = await bcrypt.compare(passwordActual, usuario.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ msg: "La contraseña actual es incorrecta" });

    // 2. Hashear nueva password
    const salt = await bcrypt.genSalt(10);
    usuario.password = await bcrypt.hash(nuevaPassword, salt);

    // 3. Limpiar sesión (obligar a re-login por seguridad)
    usuario.id_sesion = null;

    await usuario.save();

    res.json({
      msg: "Contraseña actualizada exitosamente. Por seguridad, su sesión ha sido cerrada.",
    });
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);
    res.status(500).json({ msg: "Error al actualizar la contraseña" });
  }
};

// --- OBTENER LISTA DE ALMACENISTAS ---
exports.obtenerListaAlmacenistas = async (req, res) => {
  try {
    const usuarios = await Usuario.findAll({
      where: { estado: "ACTIVO", tipo_usuario: "ALMACENISTA" },
      attributes: ["id_usuario", "nombre", "apellido", "cedula"],
      order: [["nombre", "ASC"]],
    });
    // Renombrar id_usuario a id_almacenista para compatibilidad con el front si es necesario,
    // pero mejor mantener consistencia
    const result = usuarios.map((u) => ({
      id_almacenista: u.id_usuario,
      id_usuario: u.id_usuario,
      nombre: u.nombre,
      apellido: u.apellido,
      cedula: u.cedula,
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener almacenistas" });
  }
};

// --- OBTENER LISTA DE CHOFERES (USUARIOS O PERSONAL) ---
exports.obtenerListaChoferes = async (req, res) => {
  try {
    // Por ahora sacamos de Usuarios, podrías filtrar por un rol específico si existe
    const usuarios = await Usuario.findAll({
      where: { estado: "ACTIVO" },
      attributes: ["id_usuario", "nombre", "apellido", "cedula"],
      order: [["nombre", "ASC"]],
    });
    const result = usuarios.map((u) => ({
      id_chofer: u.id_usuario,
      id_usuario: u.id_usuario,
      nombre: u.nombre,
      apellido: u.apellido,
      cedula: u.cedula,
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener choferes" });
  }
};
