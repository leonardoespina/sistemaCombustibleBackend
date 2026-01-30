const jwt = require('jsonwebtoken');

const autenticarUsuario = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ msg: 'No hay token, permiso denegado' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.usuario = decoded; // Aquí guardamos { id_usuario, tipo_usuario... }
        next();
    } catch (error) {
        res.status(401).json({ msg: 'Token no válido' });
    }
};

const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(500).json({ msg: 'Se requiere verificar el rol sin validar el token primero' });
        }

        if (!roles.includes(req.usuario.tipo_usuario)) {
             return res.status(403).json({
                msg: `Acceso denegado: Se requiere uno de los siguientes roles: ${roles.join(', ')}`
             });
        }
        next();
    }
}

module.exports = { autenticarUsuario, authorizeRole };
