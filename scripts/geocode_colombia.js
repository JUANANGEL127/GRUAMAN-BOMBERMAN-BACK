import fetch from 'node-fetch';

/**
 * Convierte una dirección en Colombia a latitud y longitud usando Nominatim (OpenStreetMap)
 * @param {string} direccion - Dirección completa (incluye ciudad y municipio)
 * @returns {Promise<{latitud: number, longitud: number}>}
 */
export async function geocodeColombia(direccion) {
  const apiKey = 'pk.647f45aa096141deca59e4a30e07c696';
  const url = `https://us1.locationiq.com/v1/search?key=${apiKey}&q=${encodeURIComponent(direccion + ', Colombia')}&format=json&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  console.log('[geocodeColombia] Respuesta de LocationIQ:', JSON.stringify(data, null, 2));
  if (!data.length) throw new Error('No se encontró lat/lon para la dirección');
  return {
    latitud: parseFloat(data[0].lat),
    longitud: parseFloat(data[0].lon)
  };
}
