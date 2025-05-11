const { sql, pool, poolConnect } = require('../db');

// Obtener todos los usuarios
exports.obtenerUsuarios = async (req, res) => {
  try {
    await poolConnect;
    const result = await pool.request().query('SELECT * FROM usuarios');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener usuarios:', err);
    res.status(500).send('Error al obtener usuarios');
  }
};

// Crear un nuevo usuario
exports.crearUsuario = async (req, res) => {
  const { nombre_usuario, correo, contraseña, estado } = req.body;

  try {
    await poolConnect; // 👈 Esto era lo que faltaba
    await pool.request()
      .input('nombre_usuario', sql.NVarChar, nombre_usuario)
      .input('correo', sql.NVarChar, correo)
      .input('contraseña', sql.NVarChar, contraseña)
      .input('estado', sql.NVarChar, 'offline') // o 'activo' si preferís
      .query(`INSERT INTO usuarios (nombre_usuario, correo, contraseña, estado)
              VALUES (@nombre_usuario, @correo, @contraseña, @estado)`);

    res.status(201).send('Usuario creado con éxito');
  } catch (err) {
    console.error('Error al crear usuario:', err);
    res.status(500).send('Error al crear usuario');
  }
};
