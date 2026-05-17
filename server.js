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

        // Busca primero en usuarios (gestores, operadores)
        const usuariosRows = query(db,
            'SELECT * FROM usuarios WHERE username = ? AND password = ?',
            [username, password]
        );

        if (usuariosRows.length) {
            const u = usuariosRows[0];
            return res.json({
                ok: true,
                usuario: { id: u.id, nombre: u.nombre, rol: u.rol, username: u.username }
            });
        }

        // Si no, busca en conductores
        const condRows = query(db,
            'SELECT * FROM conductores WHERE username = ? AND password = ?',
            [username, password]
        );

        if (condRows.length) {
            const c = condRows[0];
            return res.json({
                ok: true,
                usuario: { id: c.id, nombre: c.nombre, rol: c.rol, username: c.username }
            });
        }

        return res.status(401).json({ error: 'Credenciales incorrectas' });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
        if (!anio || isNaN(Number(anio)) || Number(anio) < 1990 || Number(anio) > new Date().getFullYear() + 1) //ESTO no estaba especificado
            return res.status(400).json({ error: `El año debe estar entre 1990 y ${new Date().getFullYear() + 1}.`, campo: 'anio' });
        if (!capacidad || Number(capacidad) < 1)
            return res.status(400).json({ error: 'La capacidad debe ser mayor a 0.', campo: 'capacidad' });

        const placaUp = placa.trim().toUpperCase();
        const codigoUp = codigo.trim().toUpperCase();

        //CA4: validar formato de placa ABC-123
        const regexPlaca = /^[A-Z]{3}-[0-9]{3}$/;
        if (!regexPlaca.test(placaUp))
            return res.status(400).json({ error: 'Formato de placa inválido — se esperaba: ABC-123 (3 letras, guion, 3 números).', campo: 'placa' });

        const db = await getDb();

        // CA2: placa ya registrada
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

        const estadoAnterior = existente[0].estado;   //para el criterio aqui se guarda el estado anterior 
        const estadoFinal = estado || estadoAnterior;
        const estadosValidos = ['activo', 'inactivo', 'en_mantenimiento'];

        if (!estadosValidos.includes(estadoFinal))
            return res.status(400).json({ error: 'Estado operativo no válido.', campo: 'estado' });

        const estadoCambio = estadoFinal !== estadoAnterior; //aqui se verifica si cambio 

        run(db, `UPDATE autobuses SET marca = ?, modelo = ?, anio = ?, capacidad = ?, estado = ?, modificado = DATE('now') WHERE id = ?`,
            [marca.trim(), modelo.trim(), Number(anio), Number(capacidad), estadoFinal, id]);

        const actualizado = query(db, 'SELECT * FROM autobuses WHERE id = ?', [id])[0];
        res.json({ ...actualizado, message: `✓ Autobus ${actualizado.placa} actualizado correctamente.`, estadoCambio }); //nuevo campo en la respuesta 



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
        const q = `%${(req.query.q || '').trim()}%`;
        const conductores = query(db,
            `SELECT id, nombre, cedula, username, rol, creado_en
             FROM conductores
             WHERE nombre LIKE ? OR cedula LIKE ? OR username LIKE ?
             ORDER BY id DESC`,
            [q, q, q]
        );
        res.json(conductores);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VER DETALLE DE CONDUCTOR ─────────────────────────────
app.get('/api/conductores/:id', async (req, res) => {
    try {
        const db = await getDb();
        const rows = query(db,
            'SELECT id, nombre, cedula, username, rol, creado_en FROM conductores WHERE id = ?',
            [req.params.id]
        );
        if (!rows.length)
            return res.status(404).json({ error: 'Conductor no encontrado.' });
        res.json(rows[0]);
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
        // para que cumpla el mss E1
        res.status(201).json({ ...nuevo, message: `✓ Conductor ${nombre} registrado correctamente.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── ACTUALIZAR CONDUCTOR (E2) ─────────────────────────────
app.put('/api/conductores/:id', async (req, res) => {
    try {
        const { nombre, rol, password } = req.body;
        const id = parseInt(req.params.id);

        if (!nombre)
            return res.status(400).json({ error: 'El nombre es obligatorio.', campo: 'nombre' });

        const rolesValidos = ['conductor', 'conductor_senior', 'auxiliar'];
        if (!rol || !rolesValidos.includes(rol))
            return res.status(400).json({ error: 'Debe seleccionar un rol válido.', campo: 'rol' });

        const db = await getDb();
        // E7: conductor no encontrado
        const existente = query(db, 'SELECT * FROM conductores WHERE id = ?', [id]);
        if (!existente.length)
            return res.status(404).json({ error: 'Conductor no encontrado en el sistema.' });

        if (password) {
            run(db,
                `UPDATE conductores SET nombre = ?, rol = ?, password = ? WHERE id = ?`,
                [nombre.trim(), rol, password, id]
            );
        } else {
            run(db,
                `UPDATE conductores SET nombre = ?, rol = ? WHERE id = ?`,
                [nombre.trim(), rol, id]
            );
        }

        const actualizado = query(db,
            'SELECT id, nombre, cedula, username, rol, creado_en FROM conductores WHERE id = ?',
            [id]
        )[0];
        res.json({ ...actualizado, message: `✓ Datos del conductor ${actualizado.nombre} actualizados correctamente.` });
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

// ══════════════════════════════════════════════════════════
//  ASIGNACIONES
// ══════════════════════════════════════════════════════════

// ── LISTAR (con filtros) ──────────────────────────────────
app.get('/api/asignaciones', async (req, res) => {
    try {
        const db = await getDb();
        const { bus, cond, ruta, estado } = req.query;
        let sql = `
            SELECT a.*, 
                   b.placa, b.codigo as bus_codigo,
                   r.codigo as ruta_codigo, r.descripcion as ruta_desc,
                   c.nombre as conductor_nombre, c.cedula
            FROM asignaciones a
            JOIN autobuses  b ON b.id = a.autobus_id
            JOIN rutas      r ON r.id = a.ruta_id
            JOIN conductores c ON c.id = a.conductor_id
            WHERE 1=1`;
        const params = [];
        if (bus) { sql += ' AND a.autobus_id = ?'; params.push(bus); }
        if (cond) { sql += ' AND a.conductor_id = ?'; params.push(cond); }
        if (ruta) { sql += ' AND a.ruta_id = ?'; params.push(ruta); }
        if (estado) { sql += ' AND a.estado = ?'; params.push(estado); }
        else { sql += " AND a.estado = 'activa'"; }
        sql += ' ORDER BY a.id DESC';
        res.json(query(db, sql, params));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VER ───────────────────────────────────────────────────
app.get('/api/asignaciones/:id', async (req, res) => {
    try {
        const db = await getDb();
        const rows = query(db, `
            SELECT a.*,
                   b.placa, b.codigo as bus_codigo,
                   r.codigo as ruta_codigo, r.descripcion as ruta_desc,
                   c.nombre as conductor_nombre, c.cedula
            FROM asignaciones a
            JOIN autobuses  b ON b.id = a.autobus_id
            JOIN rutas      r ON r.id = a.ruta_id
            JOIN conductores c ON c.id = a.conductor_id
            WHERE a.id = ?`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada.' });
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CREAR (E1–E5) ─────────────────────────────────────────
app.post('/api/asignaciones', async (req, res) => {
    try {
        const { autobus_id, ruta_id, conductor_id, horario } = req.body;

        // E5: campos faltantes
        if (!autobus_id || !ruta_id || !conductor_id || !horario)
            return res.status(400).json({ error: 'Debe seleccionar autobus, ruta, conductor y horario.' });

        const db = await getDb();

        // E4: ruta inactiva
        const ruta = query(db, 'SELECT * FROM rutas WHERE id = ?', [ruta_id]);
        if (!ruta.length || ruta[0].estado !== 'activo')
            return res.status(409).json({ error: 'La ruta seleccionada no está disponible o está inactiva.', campo: 'ruta_id' });

        // E2: autobus no disponible en el mismo horario
        const busOcupado = query(db,
            "SELECT id FROM asignaciones WHERE autobus_id = ? AND horario = ? AND estado = 'activa'",
            [autobus_id, horario]);
        if (busOcupado.length)
            return res.status(409).json({ error: 'El autobus no está disponible en el horario seleccionado.', campo: 'autobus_id' });

        // E3: conductor no disponible en el mismo horario
        const condOcupado = query(db,
            "SELECT id FROM asignaciones WHERE conductor_id = ? AND horario = ? AND estado = 'activa'",
            [conductor_id, horario]);
        if (condOcupado.length)
            return res.status(409).json({ error: 'El conductor no está disponible en el horario seleccionado.', campo: 'conductor_id' });

        run(db,
            'INSERT INTO asignaciones (autobus_id, ruta_id, conductor_id, horario) VALUES (?, ?, ?, ?)',
            [autobus_id, ruta_id, conductor_id, horario]);

        const nueva = query(db, 'SELECT * FROM asignaciones WHERE rowid = last_insert_rowid()', [])[0];
        res.status(201).json({ ...nueva, message: '✓ Asignación creada correctamente.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MODIFICAR (gestión E1) ────────────────────────────────
app.put('/api/asignaciones/:id', async (req, res) => {
    try {
        const { autobus_id, ruta_id, conductor_id, horario } = req.body;
        const id = parseInt(req.params.id);
        if (!autobus_id || !ruta_id || !conductor_id || !horario)
            return res.status(400).json({ error: 'Todos los campos son obligatorios.' });

        const db = await getDb();
        const existente = query(db, 'SELECT * FROM asignaciones WHERE id = ?', [id]);
        if (!existente.length) return res.status(404).json({ error: 'Asignación no encontrada.' });

        // Mismas validaciones que crear, pero excluye la asignación actual
        const ruta = query(db, 'SELECT * FROM rutas WHERE id = ?', [ruta_id]);
        if (!ruta.length || ruta[0].estado !== 'activo')
            return res.status(409).json({ error: 'La ruta seleccionada no está disponible o está inactiva.' });

        const busOcupado = query(db,
            "SELECT id FROM asignaciones WHERE autobus_id = ? AND horario = ? AND estado = 'activa' AND id != ?",
            [autobus_id, horario, id]);
        if (busOcupado.length)
            return res.status(409).json({ error: 'El autobus no está disponible en ese horario.' });

        const condOcupado = query(db,
            "SELECT id FROM asignaciones WHERE conductor_id = ? AND horario = ? AND estado = 'activa' AND id != ?",
            [conductor_id, horario, id]);
        if (condOcupado.length)
            return res.status(409).json({ error: 'El conductor no está disponible en ese horario.' });

        run(db,
            'UPDATE asignaciones SET autobus_id=?, ruta_id=?, conductor_id=?, horario=? WHERE id=?',
            [autobus_id, ruta_id, conductor_id, horario, id]);

        const actualizada = query(db, 'SELECT * FROM asignaciones WHERE id = ?', [id])[0];
        res.json({ ...actualizada, message: '✓ Asignación modificada correctamente.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CANCELAR (gestión E2–E3) ──────────────────────────────
app.patch('/api/asignaciones/:id/cancelar', async (req, res) => {
    try {
        const db = await getDb();
        const asig = query(db, 'SELECT * FROM asignaciones WHERE id = ?', [req.params.id]);
        if (!asig.length) return res.status(404).json({ error: 'Asignación no encontrada.' });
        run(db, "UPDATE asignaciones SET estado = 'cancelada' WHERE id = ?", [req.params.id]);
        res.json({ ok: true, message: '✓ Asignación cancelada correctamente.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════
//  INCIDENCIAS (INC)
// ══════════════════════════════════════════════════════════

app.get('/api/incidencias', async (req, res) => {
    try {
        const db = await getDb();
        const { conductor_id } = req.query;
        let sql = `SELECT i.*, c.nombre as conductor_nombre
                   FROM incidencias i JOIN conductores c ON c.id = i.conductor_id WHERE 1=1`;
        const params = [];
        if (conductor_id) { sql += ' AND i.conductor_id = ?'; params.push(conductor_id); }
        sql += ' ORDER BY i.fecha DESC';
        res.json(query(db, sql, params));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/incidencias', async (req, res) => {
    try {
        const { conductor_id, fecha, tipo, cantidad = 1, descripcion = '' } = req.body;

        // E7: sin conductor
        if (!conductor_id)
            return res.status(400).json({ error: 'Debe seleccionar un conductor.', campo: 'conductor_id' });

        // E4: conductor no existe
        const db = await getDb();
        const cond = query(db, 'SELECT id FROM conductores WHERE id = ?', [conductor_id]);
        if (!cond.length)
            return res.status(404).json({ error: 'Conductor no encontrado, verifique el código.', campo: 'conductor_id' });

        // E5: fecha inválida (no puede ser futura)
        if (!fecha)
            return res.status(400).json({ error: 'La fecha es obligatoria.', campo: 'fecha' });
        if (new Date(fecha) > new Date())
            return res.status(400).json({ error: 'Fecha inválida, seleccione una fecha válida.', campo: 'fecha' });

        // E6: tipo no seleccionado
        const tiposValidos = ['dias_trabajados', 'falta', 'retardo', 'permiso_justificado', 'excusa_medica'];
        if (!tipo || !tiposValidos.includes(tipo))
            return res.status(400).json({ error: 'Debe seleccionar un tipo de incidencia.', campo: 'tipo' });

        run(db,
            'INSERT INTO incidencias (conductor_id, fecha, tipo, cantidad, descripcion) VALUES (?,?,?,?,?)',
            [conductor_id, fecha, tipo, Number(cantidad), descripcion.trim()]);

        const nueva = query(db, 'SELECT * FROM incidencias WHERE rowid = last_insert_rowid()', [])[0];
        res.status(201).json({ ...nueva, message: `✓ ${tipo === 'dias_trabajados' ? 'Días trabajados' : 'Incidencia'} registrada correctamente.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════
//  SALARIOS (SAL) — fórmula de negocio a definir
// ══════════════════════════════════════════════════════════

app.get('/api/salarios/calcular', async (req, res) => {
    try {
        const { conductor_id, periodo } = req.query;   // periodo: 'semana' | 'mes'
        const db = await getDb();

        // E5: conductor no existe
        if (conductor_id) {
            const c = query(db, 'SELECT * FROM conductores WHERE id = ?', [conductor_id]);
            if (!c.length) return res.status(404).json({ error: 'Conductor no encontrado.', codigo: 'SAL_m2' });
        }

        // Rango de fechas según período
        const hoy = new Date();
        let fechaDesde;
        if (periodo === 'semana') {
            fechaDesde = new Date(hoy); fechaDesde.setDate(hoy.getDate() - 7);
        } else {
            fechaDesde = new Date(hoy); fechaDesde.setMonth(hoy.getMonth() - 1);
        }
        const desde = fechaDesde.toISOString().split('T')[0];
        const hasta = hoy.toISOString().split('T')[0];

        let condWhere = conductor_id ? 'AND i.conductor_id = ?' : '';
        let params = conductor_id
            ? [desde, hasta, 'dias_trabajados', conductor_id]
            : [desde, hasta, 'dias_trabajados'];

        const datos = query(db, `
            SELECT c.id, c.nombre,
                   COALESCE(SUM(CASE WHEN i.tipo='dias_trabajados' THEN i.cantidad ELSE 0 END), 0) as dias_trabajados,
                   COALESCE(SUM(CASE WHEN i.tipo='falta'   THEN i.cantidad ELSE 0 END), 0) as faltas,
                   COALESCE(SUM(CASE WHEN i.tipo='retardo' THEN i.cantidad ELSE 0 END), 0) as retardos
            FROM conductores c
            LEFT JOIN incidencias i ON i.conductor_id = c.id
                AND i.fecha BETWEEN ? AND ? ${condWhere}
            ${conductor_id ? 'WHERE c.id = ?' : ''}
            GROUP BY c.id`, conductor_id ? [desde, hasta, conductor_id, conductor_id] : [desde, hasta]);

        // E4 / E6: sin datos
        const sinDatos = datos.filter(d => d.dias_trabajados === 0);
        if (datos.length === 1 && sinDatos.length === 1)
            return res.status(404).json({
                error: 'El conductor no tiene registro de días trabajados en el período seleccionado.',
                codigo: 'SAL_m1'
            });

        // ── Fórmula de negocio (placeholder) ──
        const SALARIO_DIA = 50000;  // ← ajusta según reglas reales
        const DESC_FALTA = 60000;
        const DESC_RETARDO = 10000;

        const resultado = datos.map(d => ({
            ...d,
            salario_bruto: d.dias_trabajados * SALARIO_DIA,
            descuentos: (d.faltas * DESC_FALTA) + (d.retardos * DESC_RETARDO),
            salario_neto: Math.max(0, (d.dias_trabajados * SALARIO_DIA) - (d.faltas * DESC_FALTA) - (d.retardos * DESC_RETARDO)),
            periodo, desde, hasta
        }));

        res.json(resultado);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/salarios/historico/:id', async (req, res) => {
    try {
        const db = await getDb();
        // E5: conductor no existe
        const cond = query(db, 'SELECT id, nombre FROM conductores WHERE id = ?', [req.params.id]);
        if (!cond.length) return res.status(404).json({ error: 'Conductor no encontrado.', codigo: 'SAL_m2' });

        // Agrupa por mes
        const historico = query(db, `
            SELECT strftime('%Y-%m', fecha) as mes,
                   SUM(CASE WHEN tipo='dias_trabajados' THEN cantidad ELSE 0 END) as dias,
                   SUM(CASE WHEN tipo='falta'           THEN cantidad ELSE 0 END) as faltas,
                   SUM(CASE WHEN tipo='retardo'         THEN cantidad ELSE 0 END) as retardos
            FROM incidencias WHERE conductor_id = ?
            GROUP BY mes ORDER BY mes DESC`, [req.params.id]);

        res.json({ conductor: cond[0], historico });
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
