import express from 'express';
const router = express.Router();

// Inserta un registro de chequeo_elevador
router.post('/', async (req, res) => {
  try {
    const pool = global.db;
    const body = req.body;

    // campos requeridos mínimos
    const required = ['cliente_constructora','proyecto_constructora','fecha_servicio','nombre_operador','cargo_operador'];
    for (const f of required) {
      if (!body[f]) return res.status(400).json({ error: `Falta campo obligatorio: ${f}` });
    }

    const query = `
      INSERT INTO chequeo_elevador (
        cliente_constructora, proyecto_constructora, fecha_servicio, nombre_operador, cargo_operador,
        epp_completo_y_en_buen_estado, epcc_completo_y_en_buen_estado,
        estructura_equipo_buen_estado, equipo_sin_fugas_fluido, tablero_mando_buen_estado, puerta_acceso_buen_estado,
        gancho_seguridad_funciona_correctamente, plataforma_limpia_y_sin_sustancias_deslizantes, cabina_libre_de_escombros_y_aseada,
        cables_electricos_y_motor_buen_estado, anclajes_y_arriostramientos_bien_asegurados, secciones_equipo_bien_acopladas,
        rodillos_guia_buen_estado_y_lubricados, rieles_seguridad_techo_buen_estado, plataforma_trabajo_techo_buen_estado,
        escalera_acceso_techo_buen_estado, freno_electromagnetico_buen_estado, sistema_velocidad_calibrado_y_engranes_buen_estado,
        limitantes_superior_inferior_calibrados,
        area_equipo_senalizada_y_demarcada, equipo_con_parada_emergencia, placa_identificacion_con_carga_maxima, sistema_sobrecarga_funcional,
        cabina_desinfectada_previamente, observaciones_generales
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,
        $8,$9,$10,$11,
        $12,$13,$14,
        $15,$16,$17,
        $18,$19,$20,
        $21,$22,$23,
        $24,$25,$26,$27,
        $28,$29,$30
      ) RETURNING id
    `;

    const values = [
      body.cliente_constructora, body.proyecto_constructora, body.fecha_servicio, body.nombre_operador, body.cargo_operador,
      body.epp_completo_y_en_buen_estado || 'NA', body.epcc_completo_y_en_buen_estado || 'NA',
      body.estructura_equipo_buen_estado || 'NA', body.equipo_sin_fugas_fluido || 'NA', body.tablero_mando_buen_estado || 'NA', body.puerta_acceso_buen_estado || 'NA',
      body.gancho_seguridad_funciona_correctamente || 'NA', body.plataforma_limpia_y_sin_sustancias_deslizantes || 'NA', body.cabina_libre_de_escombros_y_aseada || 'NA',
      body.cables_electricos_y_motor_buen_estado || 'NA', body.anclajes_y_arriostramientos_bien_asegurados || 'NA', body.secciones_equipo_bien_acopladas || 'NA',
      body.rodillos_guia_buen_estado_y_lubricados || 'NA', body.rieles_seguridad_techo_buen_estado || 'NA', body.plataforma_trabajo_techo_buen_estado || 'NA',
      body.escalera_acceso_techo_buen_estado || 'NA', body.freno_electromagnetico_buen_estado || 'NA', body.sistema_velocidad_calibrado_y_engranes_buen_estado || 'NA',
      body.limitantes_superior_inferior_calibrados || 'NA',
      body.area_equipo_senalizada_y_demarcada || 'NA', body.equipo_con_parada_emergencia || 'NA', body.placa_identificacion_con_carga_maxima || 'NA', body.sistema_sobrecarga_funcional || 'NA',
      body.cabina_desinfectada_previamente || 'NA', body.observaciones_generales || null
    ];

    const result = await pool.query(query, values);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Error insert chequeo_elevador:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtiene registros (opcional ?limit=N)
router.get('/', async (req, res) => {
  try {
    const pool = global.db;
    const limit = Math.min(100, parseInt(req.query.limit) || 100);
    const q = await pool.query(`SELECT * FROM chequeo_elevador ORDER BY id DESC LIMIT $1`, [limit]);
    res.json({ success: true, rows: q.rows });
  } catch (err) {
    console.error('Error fetching chequeo_elevador:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
