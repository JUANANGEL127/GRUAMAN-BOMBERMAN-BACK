import { DateTime } from 'luxon';

/**
 * Fixed Colombian holidays expressed as MM-DD values.
 * @type {string[]}
 */
const FESTIVOS_FIJOS = [
  '01-01',
  '05-01',
  '07-20',
  '08-07',
  '12-08',
  '12-25',
];

/**
 * Colombian movable holidays by year.
 * @type {Record<string, string[]>}
 */
const FESTIVOS_MOVILES_POR_ANIO = {
  '2024': ['01-08', '03-25', '03-28', '03-29', '04-01', '05-13', '06-03', '06-10', '07-01', '08-19', '10-14', '11-04', '11-11'],
  '2025': ['01-06', '03-24', '04-17', '04-18', '05-01', '06-02', '06-23', '06-30', '08-18', '10-13', '11-03', '11-17', '12-08'],
  '2026': ['01-12', '04-02', '04-03', '04-06', '05-25', '06-15', '06-29', '07-20', '08-17', '10-12', '11-02', '11-16', '12-08'],
  '2027': ['01-11', '03-22', '04-01', '04-02', '05-17', '06-07', '06-14', '07-05', '08-16', '10-18', '11-01', '11-15', '12-08'],
};

export function isColombianHoliday(fechaISO) {
  const dt = DateTime.fromISO(String(fechaISO || ''), { zone: 'America/Bogota' });
  if (!dt.isValid) return false;
  const mesDia = dt.toFormat('MM-dd');
  const anio = dt.toFormat('yyyy');
  if (FESTIVOS_FIJOS.includes(mesDia)) return true;
  const moviles = FESTIVOS_MOVILES_POR_ANIO[anio] || [];
  return moviles.includes(mesDia);
}

