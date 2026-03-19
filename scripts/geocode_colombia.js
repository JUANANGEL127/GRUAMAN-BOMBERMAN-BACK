import fetch from 'node-fetch';

/**
 * Resuelve una dirección colombiana a coordenadas geográficas usando la API de geocodificación LocationIQ.
 * La cadena ", Colombia" se agrega automáticamente antes de enviar la solicitud.
 * @param {string} direccion - Dirección completa incluyendo ciudad y municipio.
 * @returns {Promise<{ latitud: number, longitud: number }>}
 * @throws {Error} Cuando no se retornan resultados para la dirección dada.
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
