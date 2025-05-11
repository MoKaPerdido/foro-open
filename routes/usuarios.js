require('dotenv').config();
const nodemailer = require('nodemailer');
const codigosRecuperacion = new Map(); // clave: correo, valor: { codigo, expiracion }

const express = require('express');
const router = express.Router();
const { pool, sql, poolConnect } = require('../db');

// ✅ Transportador global, accesible desde todas las rutas
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Crear usuario y redirigir al inicio con sesión iniciada
router.post('/', async (req, res) => {
  const { nombre_usuario, correo, contraseña, estado } = req.body;

  if (!nombre_usuario || !correo || !contraseña) {
    return res.status(400).send('Todos los campos son obligatorios');
  }

  try {
    await poolConnect;

    // 1. Crear nuevo usuario
    await pool.request()
      .input('nombre_usuario', sql.NVarChar, nombre_usuario)
      .input('correo', sql.NVarChar, correo)
      .input('contraseña', sql.NVarChar, contraseña)
      .input('estado', sql.NVarChar, estado || 'desconectado')
      .query(`
        INSERT INTO usuarios (nombre_usuario, correo, contraseña, estado) 
        VALUES (@nombre_usuario, @correo, @contraseña, @estado)
      `);

    // 2. Recuperar el usuario creado
    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM usuarios WHERE correo = @correo');

    const nuevoUsuario = result.recordset[0];

    // 3. Guardar usuario en la sesión
    req.session.usuario = nuevoUsuario;

    // 4. Redirigir al inicio
    res.redirect('/');
  } catch (err) {
    console.error('Error al crear usuario:', err);
    res.status(500).send('Error al crear usuario');
  }
});

// Login
router.post('/login', async (req, res) => {
  const { correo, contraseña } = req.body;

  if (!correo || !contraseña) {
    return res.status(400).send('Correo y contraseña son obligatorios');
  }

  try {
    await poolConnect;

    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM usuarios WHERE correo = @correo');

    const usuario = result.recordset[0];

    if (usuario && usuario.contraseña === contraseña) {
      // Actualizar estado
      await pool.request()
        .input('estado', sql.NVarChar, 'en línea')
        .input('correo', sql.NVarChar, correo)
        .query('UPDATE usuarios SET estado = @estado WHERE correo = @correo');

      const nuevoUsuario = await pool.request()
        .input('correo', sql.NVarChar, correo)
        .query('SELECT * FROM usuarios WHERE correo = @correo');

      req.session.usuario = nuevoUsuario.recordset[0];

      res.redirect('/perfil');
    } else {
       // Usuario o contraseña incorrectos
  res.render('login', {
    error: 'Correo o contraseña incorrectos',
    session: req.session
  });
}
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// Logout
router.get('/logout', async (req, res) => {
  if (req.session.usuario) {
    try {
      await poolConnect;
      await pool.request()
        .input('estado', sql.NVarChar, 'desconectado')
        .input('correo', sql.NVarChar, req.session.usuario.correo)
        .query('UPDATE usuarios SET estado = @estado WHERE correo = @correo');
    } catch (err) {
      console.error('Error al actualizar estado al salir:', err);
    }
  }

  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Obtener todos los usuarios
router.get('/', async (req, res) => {
  try {
    await poolConnect;
    const result = await pool.request().query('SELECT * FROM usuarios');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener usuarios:', err);
    res.status(500).send('Error al obtener usuarios');
  }
});

// Página para mostrar formulario
router.get('/recuperar', (req, res) => {
  res.render('recuperar');
});

// Procesar solicitud de recuperación
router.post('/recuperar', async (req, res) => {
  const { correo } = req.body;

  if (!correo) return res.status(400).send('Correo requerido');

  try {
    await poolConnect;
    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM usuarios WHERE correo = @correo');

    const usuario = result.recordset[0];

    if (!usuario) return res.send('Correo no encontrado');

    const codigo = Math.floor(100000 + Math.random() * 900000); // Código de 6 dígitos
    codigosRecuperacion[correo] = { codigo, id: usuario.id };

    // Configurar el transportador de correos con las variables del .env
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: '"Soporte App" <tu-correo@gmail.com>',
      to: correo,
      subject: 'Código de recuperación de contraseña',
      html: `<p>Tu código de recuperación es: <strong>${codigo}</strong></p>`
    });

    // Redirigir a formulario de confirmación
    res.redirect(`/usuarios/restablecer?correo=${correo}`);
  } catch (err) {
    console.error('Error al enviar código:', err);
    res.status(500).send('Error al enviar el código');
  }
});

router.post('/enviar-codigo', async (req, res) => {
  const { correo } = req.body;

  if (!correo) return res.status(400).send('Correo requerido');

  try {
    await poolConnect;
    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM usuarios WHERE correo = @correo');

    if (result.recordset.length === 0) {
      return res.status(404).send('Correo no registrado');
    }

    const codigo = Math.floor(100000 + Math.random() * 900000); // código de 6 dígitos
    const expiracion = Date.now() + 5 * 60 * 1000; // válido por 5 minutos

    codigosRecuperacion.set(correo, { codigo, expiracion });

    await transporter.sendMail({
      from: `"Soporte Técnico" <${process.env.CORREO_APP}>`,
      to: correo,
      subject: 'Código de recuperación',
      text: `Tu código de verificación es: ${codigo}`
    });

    res.send('Código enviado al correo');
  } catch (err) {
    console.error('Error al enviar código:', err);
    res.status(500).send('Error al enviar el código');
  }
});

router.post('/verificar-codigo', (req, res) => {
  const { correo, codigo } = req.body;
  const registro = codigosRecuperacion.get(correo);

  if (!registro) {
    return res.status(400).send('Debes solicitar un código primero');
  }

  if (Date.now() > registro.expiracion) {
    codigosRecuperacion.delete(correo);
    return res.status(400).send('Código expirado. Solicita uno nuevo.');
  }

  if (registro.codigo.toString() !== codigo.toString()) {
    return res.status(400).send('Código incorrecto');
  }

  res.send('Código verificado');
});

router.post('/cambiar-clave', async (req, res) => {
  const { correo, nueva } = req.body;

  if (!correo || !nueva) return res.status(400).send('Datos incompletos');

  try {
    await poolConnect;

    await pool.request()
      .input('correo', sql.NVarChar, correo)
      .input('nueva', sql.NVarChar, nueva)
      .query(`
        UPDATE usuarios 
        SET contraseña = @nueva 
        WHERE correo = @correo
      `);

    codigosRecuperacion.delete(correo); // limpiar memoria
    res.send('Contraseña actualizada correctamente');
  } catch (err) {
    console.error('Error al cambiar contraseña:', err);
    res.status(500).send('Error al cambiar la contraseña');
  }
});

module.exports = router;
