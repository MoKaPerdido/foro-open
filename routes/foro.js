const express = require('express');
const router = express.Router();
const { pool, sql, poolConnect } = require('../db');
const { requireLogin } = require('../middleware/auth');

// ==============================
// Mostrar publicaciones + comentarios + reacciones
// ==============================
router.get('/', async (req, res) => {
  try {
    await poolConnect;

    // 1. Obtener todas las publicaciones
    const publicaciones = await pool.request().query(`
      SELECT p.*, u.nombre_usuario
      FROM publicaciones p
      JOIN usuarios u ON p.usuario_id = u.id
      ORDER BY p.fecha_publicacion DESC
    `);

    const publicacionesConComentarios = [];

    for (let pub of publicaciones.recordset) {
      // 2. Obtener comentarios de cada publicación
      const comentarios = await pool.request()
        .input('pubId', sql.Int, pub.id)
        .query(`
          SELECT c.*, u.nombre_usuario
          FROM comentarios c
          JOIN usuarios u ON c.usuario_id = u.id
          WHERE c.publicacion_id = @pubId
          ORDER BY c.fecha_comentario ASC
        `);

      const comentariosConRespuestas = [];

      for (let com of comentarios.recordset) {
        // 3. Obtener respuestas por cada comentario
        const respuestas = await pool.request()
          .input('comentarioId', sql.Int, com.id)
          .query(`
            SELECT r.*, u.nombre_usuario
            FROM respuestas_comentarios r
            JOIN usuarios u ON r.usuario_id = u.id
            WHERE r.comentario_id = @comentarioId
            ORDER BY r.fecha_respuesta ASC
          `);

        com.respuestas = respuestas.recordset;
        comentariosConRespuestas.push(com);
      }

      publicacionesConComentarios.push({
        ...pub,
        comentarios: comentariosConRespuestas
      });
    }

    // 4. Obtener reacciones (like/dislike) agrupadas
    const reaccionesResult = await pool.request().query(`
      SELECT publicacion_id, tipo, COUNT(*) AS total
      FROM reacciones
      GROUP BY publicacion_id, tipo
    `);

    const conteoReacciones = {};
    reaccionesResult.recordset.forEach(r => {
      if (!conteoReacciones[r.publicacion_id]) {
        conteoReacciones[r.publicacion_id] = { like: 0, dislike: 0 };
      }
      conteoReacciones[r.publicacion_id][r.tipo] = r.total;
    });

    // 5. Integrar comentarios y reacciones en cada publicación
    const publicacionesConTodo = publicacionesConComentarios.map(pub => ({
      ...pub,
      reacciones: conteoReacciones[pub.id] || { like: 0, dislike: 0 }
    }));

    // 6. Renderizar vista
    res.render('foro', {
      publicaciones: publicacionesConTodo,
      session: req.session,
      etiquetaActiva: null // 🔧 solución para que foro.ejs siempre reciba la variable
    });
    

  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar el foro.');
  }
});

// ==============================
// Crear nueva publicación
// ==============================
router.post('/nueva', requireLogin, async (req, res) => {
  const { titulo, contenido, etiquetas } = req.body;

  try {
    await poolConnect;
    await pool.request()
      .input('usuarioId', sql.Int, req.session.usuario.id)
      .input('titulo', sql.NVarChar, titulo)
      .input('contenido', sql.NVarChar, contenido)
      .input('etiquetas', sql.NVarChar, etiquetas)
      .query(`
        INSERT INTO publicaciones (usuario_id, titulo, contenido, etiquetas, fecha_publicacion)
        VALUES (@usuarioId, @titulo, @contenido, @etiquetas, GETDATE())
      `);

    res.redirect('/foro');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear publicación.');
  }
});

// ==============================
// Comentar publicación
// ==============================
router.post('/comentar/:id', requireLogin, async (req, res) => {
  const publicacionId = req.params.id;
  const { comentario } = req.body;

  try {
    await poolConnect;
    await pool.request()
      .input('usuarioId', sql.Int, req.session.usuario.id)
      .input('publicacionId', sql.Int, publicacionId)
      .input('comentario', sql.NVarChar, comentario)
      .query(`
        INSERT INTO comentarios (usuario_id, publicacion_id, comentario, fecha_comentario)
        VALUES (@usuarioId, @publicacionId, @comentario, GETDATE())
      `);

    res.redirect('/foro');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al comentar.');
  }
});

// ==============================
// Responder a comentario
// ==============================
router.post('/responder/:comentarioId', requireLogin, async (req, res) => {
  const { comentarioId } = req.params;
  const { respuesta } = req.body;

  try {
    await poolConnect;
    await pool.request()
      .input('comentario_id', sql.Int, comentarioId)
      .input('usuario_id', sql.Int, req.session.usuario.id)
      .input('respuesta', sql.NVarChar, respuesta)
      .query(`
        INSERT INTO respuestas_comentarios (comentario_id, usuario_id, respuesta, fecha_respuesta)
        VALUES (@comentario_id, @usuario_id, @respuesta, GETDATE())
      `);

    res.redirect('/foro');
  } catch (err) {
    console.error('Error al responder comentario:', err);
    res.status(500).send('Error al guardar la respuesta.');
  }
});

// ==============================
// Editar publicación
// ==============================
router.get('/editar/:id', requireLogin, async (req, res) => {
  try {
    await poolConnect;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM publicaciones WHERE id = @id');

    const publicacion = result.recordset[0];

    if (!publicacion || publicacion.usuario_id !== req.session.usuario.id) {
      return res.status(403).send('No autorizado');
    }

    res.render('editar_publicacion', { publicacion });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar la publicación para editar.');
  }
});

// ==============================
// Guardar publicación editada
// ==============================
router.post('/editar/:id', requireLogin, async (req, res) => {
  const { titulo, contenido, etiquetas } = req.body;

  try {
    await poolConnect;

    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM publicaciones WHERE id = @id');

    const publicacion = result.recordset[0];

    if (!publicacion || publicacion.usuario_id !== req.session.usuario.id) {
      return res.status(403).send('No autorizado');
    }

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('titulo', sql.NVarChar, titulo)
      .input('contenido', sql.NVarChar, contenido)
      .input('etiquetas', sql.NVarChar, etiquetas)
      .query(`
        UPDATE publicaciones
        SET titulo = @titulo, contenido = @contenido, etiquetas = @etiquetas
        WHERE id = @id
      `);

    res.redirect('/foro');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al editar publicación.');
  }
});

// ==============================
// Eliminar publicación
// ==============================
router.post('/eliminar/:id', requireLogin, async (req, res) => {
  const id = parseInt(req.params.id);
  const usuario_id = req.session.usuario.id;

  try {
    await poolConnect;

    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM publicaciones WHERE id = @id');

    const publicacion = result.recordset[0];
    if (!publicacion || publicacion.usuario_id !== usuario_id) {
      return res.status(403).send('No tienes permiso para eliminar esta publicación.');
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM publicaciones WHERE id = @id');

    res.redirect('/foro');
  } catch (err) {
    console.error('Error al eliminar publicación:', err);
    res.status(500).send('Error al eliminar publicación');
  }
});

// ==============================
// Reaccionar (like / dislike)
// ==============================
router.post('/reaccionar/:id', requireLogin, async (req, res) => {
  const publicacionId = parseInt(req.params.id);
  const { tipo } = req.body;
  const usuarioId = req.session.usuario.id;

  if (!['like', 'dislike'].includes(tipo)) {
    return res.status(400).send('Tipo de reacción no válido.');
  }

  try {
    await poolConnect;

    const existe = await pool.request()
      .input('usuario_id', sql.Int, usuarioId)
      .input('publicacion_id', sql.Int, publicacionId)
      .query(`
        SELECT * FROM reacciones 
        WHERE usuario_id = @usuario_id AND publicacion_id = @publicacion_id
      `);

    if (existe.recordset.length > 0) {
      const reaccion = existe.recordset[0];

      if (reaccion.tipo === tipo) {
        // Quitar reacción
        await pool.request()
          .input('usuario_id', sql.Int, usuarioId)
          .input('publicacion_id', sql.Int, publicacionId)
          .query('DELETE FROM reacciones WHERE usuario_id = @usuario_id AND publicacion_id = @publicacion_id');
      } else {
        // Cambiar tipo de reacción
        await pool.request()
          .input('usuario_id', sql.Int, usuarioId)
          .input('publicacion_id', sql.Int, publicacionId)
          .input('tipo', sql.VarChar, tipo)
          .query('UPDATE reacciones SET tipo = @tipo WHERE usuario_id = @usuario_id AND publicacion_id = @publicacion_id');
      }
    } else {
      // Insertar nueva reacción
      await pool.request()
        .input('usuario_id', sql.Int, usuarioId)
        .input('publicacion_id', sql.Int, publicacionId)
        .input('tipo', sql.VarChar, tipo)
        .query('INSERT INTO reacciones (usuario_id, publicacion_id, tipo) VALUES (@usuario_id, @publicacion_id, @tipo)');
    }

    res.redirect('/foro');
  } catch (err) {
    console.error('Error al registrar reacción:', err);
    res.status(500).send('Error al registrar reacción');
  }
});

// Filtrar publicaciones por etiqueta
router.get('/etiqueta/:tag', async (req, res) => {
  const etiquetaBuscada = `#${req.params.tag}`;

  try {
    await poolConnect;

    // Buscar publicaciones por etiqueta
    const publicaciones = await pool.request()
      .input('etiqueta', sql.NVarChar, `%${etiquetaBuscada}%`)
      .query(`
        SELECT p.*, u.nombre_usuario
        FROM publicaciones p
        JOIN usuarios u ON p.usuario_id = u.id
        WHERE p.etiquetas LIKE @etiqueta
        ORDER BY p.fecha_publicacion DESC
      `);

    // Cargar comentarios asociados
    for (let pub of publicaciones.recordset) {
      const comentarios = await pool.request()
        .input('pubId', sql.Int, pub.id)
        .query(`
          SELECT c.*, u.nombre_usuario
          FROM comentarios c
          JOIN usuarios u ON c.usuario_id = u.id
          WHERE c.publicacion_id = @pubId
          ORDER BY c.fecha_comentario ASC
        `);

      for (let com of comentarios.recordset) {
        const respuestas = await pool.request()
          .input('comentarioId', sql.Int, com.id)
          .query(`
            SELECT r.*, u.nombre_usuario
            FROM respuestas_comentarios r
            JOIN usuarios u ON r.usuario_id = u.id
            WHERE r.comentario_id = @comentarioId
            ORDER BY r.fecha_respuesta ASC
          `);
        com.respuestas = respuestas.recordset;
      }

      pub.comentarios = comentarios.recordset;
    }

    res.render('foro', {
      publicaciones: publicaciones.recordset,
      session: req.session,
      etiquetaActiva: etiquetaBuscada
    });
  } catch (err) {
    console.error('Error al filtrar publicaciones por etiqueta:', err);
    res.status(500).send('Error al buscar por etiqueta');
  }
});

module.exports = router;
