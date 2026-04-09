// database.js — SQLite con sql.js (sin compilación nativa)
const path = require('path');
const fs   = require('fs');
const initSqlJs = require('sql.js');

const DB_FILE = path.join(__dirname, 'sotracauca.db');
let _db = null;

// Lee el schema SQL
const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

async function getDb() {
  if (_db) return _db;

  const SQL = await initSqlJs();

  // Cargar BD existente o crear nueva
  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
    _db.run(SCHEMA);
    persistir();
    console.log('✅ Base de datos SQLite creada con tablas y datos de ejemplo');
  }

  return _db;
}

// Guardar cambios al archivo .db
function persistir() {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// Ejecutar SELECT → devuelve array de objetos
function query(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Ejecutar INSERT/UPDATE/DELETE
function run(db, sql, params = []) {
  db.run(sql, params);
  persistir();
}

module.exports = { getDb, query, run, persistir };
