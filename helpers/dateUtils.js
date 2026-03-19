/**
 * Normaliza cualquier entrada de fecha a una cadena "YYYY-MM-DD" sin desplazamiento de zona horaria.
 * Acepta objetos Date, cadenas ISO y cadenas ISO parciales ("YYYY-M-D").
 * @param {Date|string|null} input - El valor de fecha a formatear.
 * @returns {string|null} Cadena de fecha formateada o null si la entrada es falsy o inválida.
 */
export function formatDateOnly(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const d = input;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Retorna la fecha de hoy como cadena "YYYY-MM-DD" en hora local.
 * @returns {string}
 */
export function todayDateString() { return formatDateOnly(new Date()); }

/**
 * Convierte una entrada de fecha en un objeto Date a medianoche en hora local, evitando problemas de desplazamiento UTC.
 * @param {Date|string|null} input - El valor de fecha a parsear.
 * @returns {Date|null} Date a medianoche en hora local o null si la entrada es falsy o inválida.
 */
export function parseDateLocal(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const d = input;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
