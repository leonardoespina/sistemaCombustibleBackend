const Usuario = require("../models/Usuario");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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
      let usuario = await Usuario.findOne({ where: { cedula }, transaction: t });
      if (usuario) {
        return res.status(400).json({ msg: "La cédula ya está registrada" });
      }

      // 2. Hashear Password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // 3. Guardar en BD
      usuario = await Usuario.create({
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
      }, { transaction: t });

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
  // ... (El código de login se mantiene igual que tu versión anterior) ...
  const { cedula, password } = req.body;

  try {
    const usuario = await Usuario.findOne({ where: { cedula } });

    if (!usuario)
      return res.status(400).json({ msg: "Credenciales incorrectas (Cédula)" });
    if (usuario.estado !== "ACTIVO")
      return res.status(403).json({ msg: "Usuario Inactivo" });

    const isMatch = await bcrypt.compare(password, usuario.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ msg: "Credenciales incorrectas (Password)" });

    await usuario.update({ ultimo_acceso: new Date() });

    const payload = {
      id_usuario: usuario.id_usuario,
      tipo_usuario: usuario.tipo_usuario,
      nombre: usuario.nombre,
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

// --- OBTENER USUARIOS (Solo Admin) ---
exports.obtenerUsuarios = async (req, res) => {
  try {
    const searchableFields = ["nombre", "apellido", "cedula"];

    const where = {};
    // Solo permitimos ver INACTIVOS si es admin.
    // Aunque este controlador usualmente solo es para admins, mantenemos consistencia.
    if (!req.usuario || req.usuario.tipo_usuario !== 'ADMIN') {
      where.estado = 'ACTIVO';
    }

    const paginatedResults = await paginate(Usuario, req.query, {
      where,
      searchableFields,
      attributes: { exclude: ["password"] },
      include: [
        { model: Categoria, as: "Categoria", attributes: ["id_categoria", "nombre"] },
        { model: Dependencia, as: "Dependencia", attributes: ["id_dependencia", "nombre_dependencia"] },
        { model: Subdependencia, as: "Subdependencia", attributes: ["id_subdependencia", "nombre"] },
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
                id_usuario: { [Op.ne]: id }
            },
            transaction: t
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
        return res
          .status(400)
          .json({ msg: "No puedes desactivar tu propio usuario administrador" });
      }

      // 3. Soft Delete: Cambiar estado a INACTIVO
      await usuario.update({
        estado: "INACTIVO",
        fecha_modificacion: new Date(),
      }, { transaction: t });

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
