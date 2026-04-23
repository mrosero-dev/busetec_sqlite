-- ============================================================
--  SOTRACAUCA — Sistema de Gestión de Rutas
--  Script de Creación de Base de Datos — Sprint 1
--  Motor: SQLite
-- ============================================================

-- ── TABLA: usuarios ──────────────────────────────────────────
-- Almacena los usuarios del sistema con su rol de acceso
CREATE TABLE IF NOT EXISTS usuarios (
    id         INTEGER      PRIMARY KEY AUTOINCREMENT,
    username   VARCHAR(50)  NOT NULL UNIQUE,
    password   VARCHAR(100) NOT NULL,
    nombre     VARCHAR(100) NOT NULL,
    rol        VARCHAR(50)  NOT NULL DEFAULT 'operador_rutas',
    creado_en  DATE         DEFAULT (DATE('now'))
);

-- ── TABLA: rutas ─────────────────────────────────────────────
-- Almacena las rutas de transporte con sus datos principales
CREATE TABLE IF NOT EXISTS rutas (
    id           INTEGER      PRIMARY KEY AUTOINCREMENT,
    codigo       VARCHAR(20)  NOT NULL UNIQUE,
    descripcion  TEXT         NOT NULL,
    tiempo_min   INTEGER      NOT NULL CHECK (tiempo_min > 0),
    estado       VARCHAR(10)  NOT NULL DEFAULT 'activo'
                              CHECK (estado IN ('activo','inactivo')),
    creado_en    DATE         DEFAULT (DATE('now')),
    modificado   DATE         DEFAULT (DATE('now'))
);

-- ── TABLA: paradas ───────────────────────────────────────────
-- Almacena las paradas de cada ruta (relación N:1 con rutas)
CREATE TABLE IF NOT EXISTS paradas (
    id        INTEGER      PRIMARY KEY AUTOINCREMENT,
    ruta_id   INTEGER      NOT NULL,
    nombre    VARCHAR(100) NOT NULL,
    orden     INTEGER      NOT NULL DEFAULT 1,
    -- Clave foránea: una parada pertenece a una ruta
    FOREIGN KEY (ruta_id) REFERENCES rutas(id) ON DELETE CASCADE
);

-- ── TABLA: autobuses ─────────────────────────────────────────
-- Almacena los vehículos de la flota de Sotracauca
CREATE TABLE IF NOT EXISTS autobuses (
    id           INTEGER      PRIMARY KEY AUTOINCREMENT,
    placa        VARCHAR(10)  NOT NULL UNIQUE,
    codigo       VARCHAR(20)  NOT NULL UNIQUE,
    marca        VARCHAR(50)  NOT NULL,
    modelo       VARCHAR(50)  NOT NULL,
    anio         INTEGER      NOT NULL CHECK (anio >= 1990 AND anio <= 2100),
    capacidad    INTEGER      NOT NULL CHECK (capacidad > 0),
    estado       VARCHAR(20)  NOT NULL DEFAULT 'activo'
                              CHECK (estado IN ('activo','inactivo','en_mantenimiento')),
    creado_en    DATE         DEFAULT (DATE('now')),
    modificado   DATE         DEFAULT (DATE('now'))
);
 
-- ── TABLA: conductores ───────────────────────────────────────
-- Almacena los conductores con rol asignado para acceso al sistema
CREATE TABLE IF NOT EXISTS conductores (
    id           INTEGER      PRIMARY KEY AUTOINCREMENT,
    nombre       VARCHAR(100) NOT NULL,
    cedula       VARCHAR(20)  NOT NULL UNIQUE,
    username     VARCHAR(50)  NOT NULL UNIQUE,
    password     VARCHAR(100) NOT NULL,
    rol          VARCHAR(50)  NOT NULL DEFAULT 'conductor',
    creado_en    DATE         DEFAULT (DATE('now'))
);








-- ============================================================
--  DATOS INICIALES (SEED)
-- ============================================================

INSERT OR IGNORE INTO usuarios (username, password, nombre, rol) VALUES
    ('admin',    '1234', 'Administrador',     'gestor_operativo'),
    ('operador', '1234', 'Operador de Rutas', 'operador_rutas');

INSERT OR IGNORE INTO rutas (codigo, descripcion, tiempo_min, estado) VALUES
    ('RT-001', 'Ruta Norte — Terminal El Turín hacia Centro Comercial Campanario', 45, 'activo'),
    ('RT-002', 'Ruta Sur — SENA hacia Hospital Susana López',                      60, 'activo'),
    ('RT-003', 'Ruta Universitaria — UniCauca hacia Los Jardines',                 35, 'inactivo');

INSERT OR IGNORE INTO paradas (ruta_id, nombre, orden) VALUES
    (1, 'Terminal El Turín',     1),
    (1, 'Cra. 6 con Cll. 5',    2),
    (1, 'Parque Caldas',         3),
    (1, 'Campanario',            4),
    (2, 'SENA',                  1),
    (2, 'Av. Panamericana',      2),
    (2, 'Los Arcos',             3),
    (2, 'Hospital Susana López', 4),
    (3, 'UniCauca',              1),
    (3, 'La Esmeralda',          2),
    (3, 'Los Jardines',          3);

INSERT OR IGNORE INTO autobuses (placa, codigo, marca, modelo, anio, capacidad, estado) VALUES
    ('ABC-123', 'BUS-001', 'Mercedes-Benz', 'OF-1722', 2018, 45, 'activo'),
    ('DEF-456', 'BUS-002', 'Chevrolet',     'NQR',     2020, 40, 'activo'),
    ('GHI-789', 'BUS-003', 'Hino',          'FC4J',    2016, 38, 'en_mantenimiento');
 

-- ============================================================
--  DIAGRAMA DE RELACIONES
--
--  usuarios          rutas              paradas
--  ─────────         ──────────         ─────────────
--  PK id             PK id         ┌──► PK id
--     username          codigo     │      ruta_id (FK)──►rutas.id
--     password          descripcion│      nombre
--     nombre            tiempo_min │      orden
--     rol               estado     │
--     creado_en         creado_en  │
--                       modificado─┘
--
--  Relación: rutas (1) ──────< paradas (N)
--  Una ruta tiene muchas paradas
--  Una parada pertenece a una sola ruta

-- ============================================================
--  autobuses         conductores
--  ─────────────     ───────────
--  PK id             PK id
--     placa (UNIQUE)    nombre
--     codigo (UNIQUE)   cedula (UNIQUE)
--     marca             username (UNIQUE)
--     modelo            password
--     anio              rol
--     capacidad         creado_en
--     estado
--     creado_en
--     modificado
--
--  Relación: rutas (1) ──────< paradas (N)
-- ============================================================