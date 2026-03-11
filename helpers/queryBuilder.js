/**
 * Construye una cláusula WHERE dinámica con parámetros posicionales para PostgreSQL.
 *
 * Campos especiales reconocidos:
 *   - fecha_from  → CAST(fecha_servicio AS date) >= $n
 *   - fecha_to    → CAST(fecha_servicio AS date) <= $n
 *   - fecha       → CAST(fecha_servicio AS date) = $n
 *   - empresa_id  → empresa_id = $n  (comparación numérica exacta)
 *   - resto       → campo ILIKE $n   (búsqueda parcial insensible a mayúsculas)
 *
 * @param {object} params        - Objeto con los parámetros de búsqueda (p.ej. req.query)
 * @param {string[]} allowedFields - Lista de claves permitidas; cualquier otra se ignora
 * @returns {{ where: string, values: any[] }}
 */
export function buildWhere(params, allowedFields = []) {
  const clauses = [];
  const values = [];
  let idx = 1;

  for (const key of Object.keys(params || {})) {
    const val = params[key];
    if (val === undefined || val === "") continue;
    if (!allowedFields.includes(key)) continue;

    if (key === "fecha_from") {
      clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`);
      values.push(val);
    } else if (key === "fecha_to") {
      clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`);
      values.push(val);
    } else if (key === "fecha") {
      clauses.push(`CAST(fecha_servicio AS date) = $${idx++}`);
      values.push(val);
    } else if (key === "empresa_id") {
      clauses.push(`empresa_id = $${idx++}`);
      values.push(Number(val));
    } else {
      clauses.push(`${key} ILIKE $${idx++}`);
      values.push(`%${val}%`);
    }
  }

  return {
    where: clauses.length ? "WHERE " + clauses.join(" AND ") : "",
    values,
  };
}
