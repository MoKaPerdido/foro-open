require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { pool, poolConnect, sql } = require('./db');

const app = express();

// Middleware de sesiones
app.use(session({
    secret: 'clave_super_secreta',
    resave: false,
    saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 día
}));

// Exponer sesión a todas las vistas EJS
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// Motor de plantillas EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares para JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de usuarios
const usuariosRoutes = require('./routes/usuarios');
app.use('/usuarios', usuariosRoutes);

// Páginas principales
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/enlace_1', (req, res) => {
  res.render('enlace_1', { session: req.session });
});

app.get('/enlace_2', (req, res) => {
  res.render('enlace_2', { session: req.session });
});

// Pagina Foro
const foroRoutes = require('./routes/foro');
app.use('/foro', foroRoutes);

// Páginas EJS dinámicas
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('login');
});

app.get('/registro', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('registro');
});

app.get('/perfil', async (req, res) => {
  if (!req.session.usuario) return res.redirect('/login');

  try {
    await poolConnect;

    const result = await pool.request()
      .input('usuario_id', sql.Int, req.session.usuario.id)
      .query(`
        SELECT id, titulo, etiquetas, fecha_publicacion
        FROM publicaciones
        WHERE usuario_id = @usuario_id
        ORDER BY fecha_publicacion DESC
      `);

    const publicacionesUsuario = result.recordset;

    res.render('perfil', {
      session: req.session,
      publicaciones: publicacionesUsuario
    });
  } catch (err) {
    console.error('Error al obtener publicaciones del perfil:', err);
    res.status(500).send('Error al cargar el perfil.');
  }
});

// Vista de administración
app.get('/admin/usuarios', async (req, res) => {
  if (!req.session.usuario || req.session.usuario.correo !== process.env.ADMIN_EMAIL) {
    return res.status(403).send('Acceso denegado');
    }

  try {
    await poolConnect;
    const result = await pool.request().query('SELECT * FROM usuarios');
    res.render('usuarios', { usuarios: result.recordset });
  } catch (err) {
    console.error('Error al cargar usuarios:', err);
    res.status(500).send('Error al mostrar usuarios');
  }
});

// Servidor
const PORT = process.env.PORT || 3000;

// Middleware para forzar HTTPS en producción 
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
