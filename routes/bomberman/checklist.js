import { Router } from "express";
const router = Router();

// Middleware: responde inmediatamente si la DB no está lista
router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de checjklist");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

// Helper para obtener los campos válidos de la tabla
async function obtenerCamposValidos(db, tabla) {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tabla]
  );
  return result.rows.map(row => row.column_name);
}

// Helper para obtener los campos válidos y requeridos de la tabla
async function obtenerCamposValidosYRequeridos(db, tabla) {
  const result = await db.query(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1`,
    [tabla]
  );
  return result.rows.map(row => ({
    nombre: row.column_name,
    requerido: row.is_nullable === "NO"
  }));
}

// POST /bomberman/checjklist
router.post("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }
  let data = req.body;

  // Campos requeridos según la estructura actual
  const camposRequeridos = [
    "nombre_cliente",
    "nombre_proyecto",
    "fecha_servicio",
    "bomba_numero",
    "nombre_operador"
  ];

  // Verifica que los campos requeridos estén presentes y no sean nulos/vacíos
  const faltantes = camposRequeridos.filter(
    campo => data[campo] === undefined || data[campo] === null || data[campo] === ""
  );

  if (faltantes.length > 0) {
    return res.status(400).json({
      error: "Faltan campos requeridos",
      campos_requeridos: faltantes,
      datos_recibidos: data
    });
  }

  try {
    const columnas = await obtenerCamposValidosYRequeridos(db, "lista_chequeo");
    const camposValidos = columnas.map(col => col.nombre);

    // Asigna false por defecto a los campos booleanos que no vienen en el body
    columnas.forEach(col => {
      if (
        col.nombre !== "id" &&
        col.nombre !== "fecha_registro" &&
        !(col.nombre in data) &&
        col.nombre !== "observaciones"
      ) {
        // Si el campo no está en el body, asigna false por defecto
        data[col.nombre] = false;
      }
    });

    // Filtra solo los campos válidos
    const campos = Object.keys(data).filter(key => camposValidos.includes(key));
    const valores = campos.map(key => data[key]);
    const placeholders = campos.map((_, i) => `$${i + 1}`).join(", ");

    if (campos.length === 0) {
      return res.status(400).json({ error: "No se enviaron campos válidos para la tabla lista_chequeo" });
    }

    await db.query(
      `INSERT INTO lista_chequeo (${campos.join(", ")}) VALUES (${placeholders})`,
      valores
    );
    res.json({ message: "Checklist guardado correctamente" });
  } catch (error) {
    console.error("Error al guardar checklist:", error);
    res.status(500).json({ error: "Error al guardar checklist", detalle: error.message });
  }
});

// GET /bomberman/checjklist
router.get("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }
  try {
    const result = await db.query(`SELECT * FROM lista_chequeo ORDER BY fecha_registro DESC`);
    res.json({ registros: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los registros", detalle: error.message });
  }
});

export default router;
