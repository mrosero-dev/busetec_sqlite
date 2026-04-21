// server.js — Sotracauca · Gestión de Rutas (SQLite)
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { getDb, query, run } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── LOGIN ──────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const db = await getDb();
    const rows = query(db, 'SELECT * FROM usuarios WHERE username = ? AND password = ?', [username, password]);

    if (!rows.length)
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const u = rows[0];
    res.json({ ok: true, usuario: { id: u.id, nombre: u.nombre, rol: u.rol, username: u.username } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HU-3: LISTAR / BUSCAR RUTAS ───────────────────────────
app.get('/api/rutas', async (req, res) => {
  try {
    const db = await getDb();
    const q = `%${(req.query.q || '').trim()}%`;

    const rutas = query(db, `
      SELECT r.*, COUNT(p.id) as total_paradas
      FROM rutas r
      LEFT JOIN paradas p ON p.ruta_id = r.id
      WHERE r.codigo LIKE ? OR r.descripcion LIKE ?
      GROUP BY r.id
      ORDER BY r.id DESC
    `, [q, q]);

    res.json(rutas);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HU-3: VER DETALLE DE RUTA ─────────────────────────────
app.get('/api/rutas/:id', async (req, res) => {
  try {
    const db = await getDb();
    const rutas = query(db, 'SELECT * FROM rutas WHERE id = ?', [req.params.id]);

    if (!rutas.length)
      return res.status(404).json({ error: 'Ruta no encontrada en el sistema.' });

    const paradas = query(db,
      'SELECT * FROM paradas WHERE ruta_id = ? ORDER BY orden',
      [req.params.id]
    );

    res.json({ ...rutas[0], paradas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HU-1: CREAR RUTA ──────────────────────────────────────
app.post('/api/rutas', async (req, res) => {
  try {
    const { codigo, descripcion, tiempo_min, estado = 'activo', paradas = [] } = req.body;

    // HU-1 C3: validar campos obligatorios
    if (!codigo)       return res.status(400).json({ error: 'El código de la ruta es obligatorio.' });
    if (!descripcion)  return res.status(400).json({ error: 'La descripción es obligatoria.' });
    if (!tiempo_min || Number(tiempo_min) < 1)
      return res.status(400).json({ error: 'El tiempo estimado debe ser mayor a 0 minutos.' });

    const db = await getDb();
    const codigoUpper = codigo.trim().toUpperCase();

    // HU-1 C2: verificar duplicado exacto
    const existe = query(db, 'SELECT id FROM rutas WHERE codigo = ?', [codigoUpper]);
    if (existe.length)
      return res.status(409).json({ error: `Ya existe una ruta con el código ${codigoUpper}. Usa un identificador diferente.` });

    // HU-1 C2: verificar ruta similar (primeros 40 caracteres de descripción)
    const descNorm = descripcion.trim().toLowerCase().slice(0, 40);
    const todas = query(db, 'SELECT codigo, descripcion FROM rutas', []);
    const similar = todas.find(r => r.descripcion.toLowerCase().slice(0, 40) === descNorm);
    if (similar)
      return res.status(409).json({ error: `Existe una ruta similar (${similar.codigo}). Verifica que no sea duplicado o cambia el identificador.` });

    // Insertar ruta
    run(db, `INSERT INTO rutas (codigo, descripcion, tiempo_min, estado) VALUES (?, ?, ?, ?)`,
      [codigoUpper, descripcion.trim(), Number(tiempo_min), estado]);

    const nuevaRuta = query(db, 'SELECT * FROM rutas WHERE codigo = ?', [codigoUpper])[0];

    // Insertar paradas
    paradas.foreach((nombre, i) => {
      run(db, 'INSERT INTO paradas (ruta_id, nombre, orden) VALUES (?, ?, ?)',
        [nuevaRuta.id, nombre.trim(), i + 1]);
    });

    const paradasGuardadas = query(db,
      'SELECT * FROM paradas WHERE ruta_id = ? ORDER BY orden', [nuevaRuta.id]);

    res.status(201).json({
      ...nuevaRuta,
      paradas: paradasGuardadas,
      message: `✓ Ruta ${codigoUpper} creada exitosamente.`
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HU-2: ACTUALIZAR RUTA ─────────────────────────────────
app.put('/api/rutas/:id', async (req, res) => {
  try {
    const { descripcion, tiempo_min, estado, paradas = [] } = req.body;
    const id = parseInt(req.params.id);

    // HU-2 C2: validar antes de guardar
    if (!descripcion)
      return res.status(400).json({ error: 'La descripción es obligatoria. No se pueden guardar los cambios.' });
    if (!tiempo_min || Number(tiempo_min) < 1)
      return res.status(400).json({ error: 'El tiempo estimado no es válido. Debe ser mayor a 0.' });

    const db = await getDb();
    const existente = query(db, 'SELECT * FROM rutas WHERE id = ?', [id]);

    // HU-2 C4: ruta no encontrada
    if (!existente.length)
      return res.status(404).json({ error: 'La ruta no fue encontrada en el sistema.' });

    // HU-2 C1/C3: actualizar datos y tiempos
    run(db, `UPDATE rutas SET descripcion = ?, tiempo_min = ?, estado = ?, modificado = DATE('now') WHERE id = ?`,
      [descripcion.trim(), Number(tiempo_min), estado || existente[0].estado, id]);

    // Reemplazar paradas
    run(db, 'DELETE FROM paradas WHERE ruta_id = ?', [id]);
    paradas.forEach((nombre, i) => {
      run(db, 'INSERT INTO paradas (ruta_id, nombre, orden) VALUES (?, ?, ?)',
        [id, nombre.trim(), i + 1]);
    });

    const rutaActualizada = query(db, 'SELECT * FROM rutas WHERE id = ?', [id])[0];
    const paradasActuales = query(db,
      'SELECT * FROM paradas WHERE ruta_id = ? ORDER BY orden', [id]);

    res.json({
      ...rutaActualizada,
      paradas: paradasActuales,
      message: `✓ Ruta ${rutaActualizada.codigo} actualizada correctamente.`
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ELIMINAR RUTA ─────────────────────────────────────────
app.delete('/api/rutas/:id', async (req, res) => {
  try {
    const db = await getDb();
    const ruta = query(db, 'SELECT * FROM rutas WHERE id = ?', [req.params.id]);
    if (!ruta.length)
      return res.status(404).json({ error: 'Ruta no encontrada.' });

    run(db, 'DELETE FROM rutas WHERE id = ?', [req.params.id]);
    res.json({ ok: true, message: `Ruta ${ruta[0].codigo} eliminada del sistema.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FRONTEND ──────────────────────────────────────────────
app.get('/{*path}', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.listen(PORT, async () => {
  await getDb(); // inicializar BD al arrancar
  console.log(`
╔══════════════════════════════════════╗
║   🚌  Sotracauca — Gestión de Rutas  ║
║   Servidor: http://localhost:${PORT}   ║
║   Base de datos: sotracauca.db       ║
╚══════════════════════════════════════╝
  `);
});
