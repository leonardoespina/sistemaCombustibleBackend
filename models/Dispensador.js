const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Dispensador = sequelize.define(
  "Dispensador",
  {
    id_dispensador: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    codigo: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    id_tanque: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    estado: {
      type: DataTypes.ENUM("ACTIVO", "INACTIVO", "MANTENIMIENTO"),
      defaultValue: "ACTIVO",
    },
    registrado_por: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    fecha_registro: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    fecha_modificacion: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "dispensadores",
    timestamps: false,
  }
);

Dispensador.associate = (models) => {
  Dispensador.belongsTo(models.Tanque, { foreignKey: "id_tanque", as: "Tanque" });
  Dispensador.belongsTo(models.Usuario, { foreignKey: "registrado_por", as: "RegistradoPor" });
};

module.exports = Dispensador;
