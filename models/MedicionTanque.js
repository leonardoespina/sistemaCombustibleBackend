const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const MedicionTanque = sequelize.define(
  "MedicionTanque",
  {
    id_medicion: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    id_tanque: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    id_usuario: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    fecha_medicion: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    hora_medicion: {
      type: DataTypes.TIME,
      allowNull: false,
    },
    medida_inicial: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: "Altura vara inicial (antes de operación si aplica)",
    },
    medida_final: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: "Altura vara final",
    },
    medida_vara: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    volumen_real: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: "Volumen calculado basado en la vara y tabla de aforo",
    },
    volumen_teorico: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: "Nivel actual en el sistema al momento de la medición",
    },
    diferencia: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: "Diferencia neta (Teórico - Real)",
    },
    merma_evaporacion: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0,
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    estado: {
      type: DataTypes.ENUM("PROCESADO", "ANULADO"),
      defaultValue: "PROCESADO",
    },
    fecha_registro: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "mediciones_tanque",
    timestamps: false,
  }
);

MedicionTanque.associate = (models) => {
  MedicionTanque.belongsTo(models.Tanque, { foreignKey: "id_tanque", as: "Tanque" });
  MedicionTanque.belongsTo(models.Usuario, { foreignKey: "id_usuario", as: "Usuario" });
};

module.exports = MedicionTanque;
