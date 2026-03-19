/**
 * Construye una cláusula WHERE parametrizada para PostgreSQL a partir de un objeto de parámetros plano.
 *
 * Claves especiales:
 *   - `fecha_from`  → `CAST(fecha_servicio AS date) >= $n`
 *   - `fecha_to`    → `CAST(fecha_servicio AS date) <= $n`
 *   - `fecha`       → `CAST(fecha_servicio AS date) = $n`
 *   - `empresa_id`  → `empresa_id = $n` (coincidencia numérica exacta)
 *   - todas las demás → `campo ILIKE $n` (parcial, sin distinción de mayúsculas)
 *
 * Las claves no presentes en `allowedFields` se ignoran silenciosamente.
 *
 * @param {object} params - Objeto de parámetros de consulta (ej. `req.query`).
 * @param {string[]} allowedFields - Lista blanca de claves de parámetros aceptadas.
 * @returns {{ where: string, values: any[] }} Fragmento SQL y array de valores enlazados.
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
