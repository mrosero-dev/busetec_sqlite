// server.js — Sotracauca · Gestión de Buses (SQLite)
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, query, run } = require('./database');

const app = express();
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
        const paradas = query(db, 'SELECT * FROM paradas WHERE ruta_id = ? ORDER BY orden', [req.params.id]);
        res.json({ ...rutas[0], paradas });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HU-1: CREAR RUTA ──────────────────────────────────────
app.post('/api/rutas', async (req, res) => {
    try {
        const { codigo, descripcion, tiempo_min, estado = 'activo', paradas = [] } = req.body;
        if (!codigo) return res.status(400).json({ error: 'El código de la ruta es obligatorio.' });
        if (!descripcion) return res.status(400).json({ error: 'La descripción es obligatoria.' });
        if (!tiempo_min || Number(tiempo_min) < 1)
            return res.status(400).json({ error: 'El tiempo estimado debe ser mayor a 0 minutos.' });

        const db = await getDb();
        const codigoUpper = codigo.trim().toUpperCase();
        const existe = query(db, 'SELECT id FROM rutas WHERE codigo = ?', [codigoUpper]);
        if (existe.length)
            return res.status(409).json({ error: `Ya existe una ruta con el código ${codigoUpper}.` });

        const descNorm = descripcion.trim().toLowerCase().slice(0, 40);
        const todas = query(db, 'SELECT codigo, descripcion FROM rutas', []);
        const similar = todas.find(r => r.descripcion.toLowerCase().slice(0, 40) === descNorm);
        if (similar)
            return res.status(409).json({ error: `Existe una ruta similar (${similar.codigo}). Verifica que no sea duplicado.` });

        run(db, `INSERT INTO rutas (codigo, descripcion, tiempo_min, estado) VALUES (?, ?, ?, ?)`,
            [codigoUpper, descripcion.trim(), Number(tiempo_min), estado]);
        const nuevaRuta = query(db, 'SELECT * FROM rutas WHERE codigo = ?', [codigoUpper])[0];

        paradas.forEach((nombre, i) => {
            run(db, 'INSERT INTO paradas (ruta_id, nombre, orden) VALUES (?, ?, ?)',
                [nuevaRuta.id, nombre.trim(), i + 1]);
        });

        const paradasGuardadas = query(db, 'SELECT * FROM paradas WHERE ruta_id = ? ORDER BY orden', [nuevaRuta.id]);
        res.status(201).json({ ...nuevaRuta, paradas: paradasGuardadas, message: `✓ Ruta ${codigoUpper} creada exitosamente.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HU-2: ACTUALIZAR RUTA ─────────────────────────────────
app.put('/api/rutas/:id', async (req, res) => {
    try {
        const { descripcion, tiempo_min, estado, paradas = [] } = req.body;
        const id = parseInt(req.params.id);
        if (!descripcion)
            return res.status(400).json({ error: 'La descripción es obligatoria.' });
        if (!tiempo_min || Number(tiempo_min) < 1)
            return res.status(400).json({ error: 'El tiempo estimado debe ser mayor a 0.' });

        const db = await getDb();
        const existente = query(db, 'SELECT * FROM rutas WHERE id = ?', [id]);
        if (!existente.length)
            return res.status(404).json({ error: 'La ruta no fue encontrada en el sistema.' });

        run(db, `UPDATE rutas SET descripcion = ?, tiempo_min = ?, estado = ?, modificado = DATE('now') WHERE id = ?`,
            [descripcion.trim(), Number(tiempo_min), estado || existente[0].estado, id]);

        run(db, 'DELETE FROM paradas WHERE ruta_id = ?', [id]);
        paradas.forEach((nombre, i) => {
            run(db, 'INSERT INTO paradas (ruta_id, nombre, orden) VALUES (?, ?, ?)', [id, nombre.trim(), i + 1]);
        });

        const rutaActualizada = query(db, 'SELECT * FROM rutas WHERE id = ?', [id])[0];
        const paradasActuales = query(db, 'SELECT * FROM paradas WHERE ruta_id = ? ORDER BY orden', [id]);
        res.json({ ...rutaActualizada, paradas: paradasActuales, message: `✓ Ruta ${rutaActualizada.codigo} actualizada correctamente.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ELIMINAR RUTA ─────────────────────────────────────────
app.delete('/api/rutas/:id', async (req, res) => {
    try {
        const db = await getDb();
        const ruta = query(db, 'SELECT * FROM rutas WHERE id = ?', [req.params.id]);
        if (!ruta.length) return res.status(404).json({ error: 'Ruta no encontrada.' });
        run(db, 'DELETE FROM rutas WHERE id = ?', [req.params.id]);
        res.json({ ok: true, message: `Ruta ${ruta[0].codigo} eliminada del sistema.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  AUTOBUSES
// ══════════════════════════════════════════════════════════

// ── LISTAR / BUSCAR AUTOBUSES (HU consultar) ──────────────
app.get('/api/autobuses', async (req, res) => {
    try {
        const db = await getDb();
        const q = `%${(req.query.q || '').trim()}%`;
        const estado = req.query.estado || '';

        let sql = `SELECT * FROM autobuses WHERE (placa LIKE ? OR codigo LIKE ? OR marca LIKE ? OR modelo LIKE ?)`;
        const params = [q, q, q, q];

        if (estado) { sql += ` AND estado = ?`; params.push(estado); }
        sql += ` ORDER BY id DESC`;

        const buses = query(db, sql, params);
        res.json(buses);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VER DETALLE DE AUTOBUS ────────────────────────────────
app.get('/api/autobuses/:id', async (req, res) => {
    try {
        const db = await getDb();
        const buses = query(db, 'SELECT * FROM autobuses WHERE id = ?', [req.params.id]);
        if (!buses.length)
            return res.status(404).json({ error: 'Autobus no encontrado en el sistema.' });
        res.json(buses[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── REGISTRAR AUTOBUS (HU-A1) ─────────────────────────────
app.post('/api/autobuses', async (req, res) => {
    try {
        const { placa, codigo, marca, modelo, anio, capacidad, estado = 'activo' } = req.body;

        // E3: campos obligatorios
        if (!placa) return res.status(400).json({ error: 'La placa es obligatoria.', campo: 'placa' });
        if (!codigo) return res.status(400).json({ error: 'El código interno es obligatorio.', campo: 'codigo' });
        if (!marca) return res.status(400).json({ error: 'La marca es obligatoria.', campo: 'marca' });
        if (!modelo) return res.status(400).json({ error: 'El modelo es obligatorio.', campo: 'modelo' });
        if (!anio || isNaN(Number(anio)) || Number(anio) < 1990 || Number(anio) > new Date().getFullYear() + 1)
            return res.status(400).json({ error: `El año debe estar entre 1990 y ${new Date().getFullYear() + 1}.`, campo: 'anio' });
        if (!capacidad || Number(capacidad) < 1)
            return res.status(400).json({ error: 'La capacidad debe ser mayor a 0.', campo: 'capacidad' });

        const placaUp = placa.trim().toUpperCase();
        const codigoUp = codigo.trim().toUpperCase();

        const db = await getDb();

        // E2: placa ya registrada
        const existePlaca = query(db, 'SELECT id FROM autobuses WHERE placa = ?', [placaUp]);
        if (existePlaca.length)
            return res.status(409).json({ error: `La placa ${placaUp} ya se encuentra registrada.`, campo: 'placa' });

        const existeCodigo = query(db, 'SELECT id FROM autobuses WHERE codigo = ?', [codigoUp]);
        if (existeCodigo.length)
            return res.status(409).json({ error: `El código ${codigoUp} ya está en uso.`, campo: 'codigo' });

        run(db, `INSERT INTO autobuses (placa, codigo, marca, modelo, anio, capacidad, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [placaUp, codigoUp, marca.trim(), modelo.trim(), Number(anio), Number(capacidad), estado]);

        const nuevo = query(db, 'SELECT * FROM autobuses WHERE placa = ?', [placaUp])[0];
        res.status(201).json({ ...nuevo, message: `✓ Autobus ${placaUp} registrado correctamente.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ACTUALIZAR AUTOBUS (HU-A2) ────────────────────────────
app.put('/api/autobuses/:id', async (req, res) => {
    try {
        const { marca, modelo, anio, capacidad, estado } = req.body;
        const id = parseInt(req.params.id);

        // E3: campos obligatorios
        if (!marca) return res.status(400).json({ error: 'La marca es obligatoria.', campo: 'marca' });
        if (!modelo) return res.status(400).json({ error: 'El modelo es obligatorio.', campo: 'modelo' });
        if (!anio || isNaN(Number(anio)) || Number(anio) < 1990 || Number(anio) > new Date().getFullYear() + 1)
            return res.status(400).json({ error: `El año debe estar entre 1990 y ${new Date().getFullYear() + 1}.`, campo: 'anio' });
        if (!capacidad || Number(capacidad) < 1)
            return res.status(400).json({ error: 'La capacidad debe ser mayor a 0.', campo: 'capacidad' });

        const db = await getDb();
        const existente = query(db, 'SELECT * FROM autobuses WHERE id = ?', [id]);

        // E4: autobus no encontrado
        if (!existente.length)
            return res.status(404).json({ error: 'Autobus no encontrado en el sistema.' });

        const estadoFinal = estado || existente[0].estado;
        const estadosValidos = ['activo', 'inactivo', 'en_mantenimiento'];
        if (!estadosValidos.includes(estadoFinal))
            return res.status(400).json({ error: 'Estado operativo no válido.', campo: 'estado' });

        run(db, `UPDATE autobuses SET marca = ?, modelo = ?, anio = ?, capacidad = ?, estado = ?, modificado = DATE('now') WHERE id = ?`,
            [marca.trim(), modelo.trim(), Number(anio), Number(capacidad), estadoFinal, id]);

        const actualizado = query(db, 'SELECT * FROM autobuses WHERE id = ?', [id])[0];
        res.json({ ...actualizado, message: `✓ Autobus ${actualizado.placa} actualizado correctamente.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ELIMINAR AUTOBUS ──────────────────────────────────────
app.delete('/api/autobuses/:id', async (req, res) => {
    try {
        const db = await getDb();
        const bus = query(db, 'SELECT * FROM autobuses WHERE id = ?', [req.params.id]);
        if (!bus.length) return res.status(404).json({ error: 'Autobus no encontrado.' });
        run(db, 'DELETE FROM autobuses WHERE id = ?', [req.params.id]);
        res.json({ ok: true, message: `Autobus ${bus[0].placa} eliminado del sistema.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  CONDUCTORES (HU-D1: Asignar Rol)
// ══════════════════════════════════════════════════════════

// ── LISTAR CONDUCTORES ────────────────────────────────────
app.get('/api/conductores', async (req, res) => {
    try {
        const db = await getDb();
        const conductores = query(db, 'SELECT id, nombre, cedula, username, rol, creado_en FROM conductores ORDER BY id DESC', []);
        res.json(conductores);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── REGISTRAR CONDUCTOR CON ROL (HU-D1) ───────────────────
app.post('/api/conductores', async (req, res) => {
    try {
        const { nombre, cedula, username, password, rol } = req.body;

        // E3: campos obligatorios
        if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.', campo: 'nombre' });
        if (!cedula) return res.status(400).json({ error: 'La cédula es obligatoria.', campo: 'cedula' });
        if (!username) return res.status(400).json({ error: 'El nombre de usuario es obligatorio.', campo: 'username' });
        if (!password) return res.status(400).json({ error: 'La contraseña es obligatoria.', campo: 'password' });

        // E4: rol no seleccionado
        const rolesValidos = ['conductor', 'conductor_senior', 'auxiliar'];
        if (!rol || !rolesValidos.includes(rol))
            return res.status(400).json({ error: 'Debe seleccionar un rol para el conductor.', campo: 'rol' });

        const db = await getDb();

        // E2: username ya registrado
        const existeUser = query(db, 'SELECT id FROM conductores WHERE username = ?', [username.trim()]);
        if (existeUser.length)
            return res.status(409).json({ error: `El nombre de usuario "${username}" ya está en uso.`, campo: 'username' });

        const existeCedula = query(db, 'SELECT id FROM conductores WHERE cedula = ?', [cedula.trim()]);
        if (existeCedula.length)
            return res.status(409).json({ error: `La cédula ${cedula} ya se encuentra registrada.`, campo: 'cedula' });

        run(db, `INSERT INTO conductores (nombre, cedula, username, password, rol) VALUES (?, ?, ?, ?, ?)`,
            [nombre.trim(), cedula.trim(), username.trim(), password, rol]);

        const nuevo = query(db, 'SELECT id, nombre, cedula, username, rol, creado_en FROM conductores WHERE username = ?', [username.trim()])[0];
        res.status(201).json({ ...nuevo, message: `✓ Rol asignado correctamente al conductor ${nombre}.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ELIMINAR CONDUCTOR ────────────────────────────────────
app.delete('/api/conductores/:id', async (req, res) => {
    try {
        const db = await getDb();
        const c = query(db, 'SELECT * FROM conductores WHERE id = ?', [req.params.id]);
        if (!c.length) return res.status(404).json({ error: 'Conductor no encontrado.' });
        run(db, 'DELETE FROM conductores WHERE id = ?', [req.params.id]);
        res.json({ ok: true, message: `Conductor ${c[0].nombre} eliminado del sistema.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FRONTEND ──────────────────────────────────────────────
app.get('/{*path}', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.listen(PORT, async () => {
    await getDb();
    console.log(`
╔══════════════════════════════════════╗
║   🚌  Sotracauca — Gestión de Buses  ║
║   Servidor: http://localhost:${PORT}   ║
║   Base de datos: sotracauca.db       ║
╚══════════════════════════════════════╝
  `);
});
