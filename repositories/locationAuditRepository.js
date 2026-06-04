import { getDistanceFromLatLonInMeters } from "../helpers/locationValidation.js";

function normalizeNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapObra(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    nombre: row.nombre_obra,
    empresaId: row.empresa_id == null ? null : Number(row.empresa_id),
    latitud: Number(row.latitud),
    longitud: Number(row.longitud)
  };
}

function mapSessionContext(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    workerId: row.worker_id == null ? null : Number(row.worker_id),
    obraId: row.obra_id == null ? null : Number(row.obra_id),
    obraNombre: row.obra_nombre,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    accuracyMeters: row.accuracy_meters == null ? null : Number(row.accuracy_meters),
    distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters),
    withinRange: row.within_range,
    validationSource: row.validation_source,
    validatedAt: row.validated_at,
    createdIp: row.created_ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function initializeLocationAuditSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_session_location_contexts (
      session_id VARCHAR(100) PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE,
      actor_id VARCHAR(100) NOT NULL,
      actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('admin', 'worker')),
      worker_id INT REFERENCES trabajadores(id),
      obra_id INT REFERENCES obras(id),
      obra_nombre VARCHAR(150),
      latitude DECIMAL(10,6) NOT NULL,
      longitude DECIMAL(10,6) NOT NULL,
      accuracy_meters NUMERIC(8,2),
      distance_meters INT,
      within_range BOOLEAN NOT NULL,
      validation_source VARCHAR(60) NOT NULL DEFAULT 'validar_ubicacion',
      validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_ip INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS attendance_location_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      session_id VARCHAR(100) REFERENCES auth_sessions(id) ON DELETE SET NULL,
      actor_id VARCHAR(100),
      actor_type VARCHAR(20),
      worker_id INT REFERENCES trabajadores(id),
      horas_jornada_id INT REFERENCES horas_jornada(id) ON DELETE SET NULL,
      event_type VARCHAR(60) NOT NULL,
      action VARCHAR(20) NOT NULL,
      message TEXT,
      obra_id INT REFERENCES obras(id),
      obra_nombre VARCHAR(150),
      latitude DECIMAL(10,6),
      longitude DECIMAL(10,6),
      accuracy_meters NUMERIC(8,2),
      distance_meters INT,
      within_range BOOLEAN,
      ip INET,
      user_agent TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_session_location_context_worker
    ON auth_session_location_contexts (worker_id, validated_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_attendance_location_audit_worker_date
    ON attendance_location_audit_logs (worker_id, created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_attendance_location_audit_event_action
    ON attendance_location_audit_logs (event_type, action, created_at DESC)
  `);
}

export function createLocationAuditRepository({ db, maxDistanceMeters = 500, bypassObraName = "LA CENTRAL" }) {
  function getRequestIp(request) {
    return request?.ip || request?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || null;
  }

  function getRequestUserAgent(request) {
    return request?.headers?.["user-agent"] || null;
  }

  async function resolveObraById(obraId) {
    const numericObraId = Number(obraId);
    if (!Number.isFinite(numericObraId) || numericObraId <= 0) return null;
    const result = await db.query(
      `SELECT id, nombre_obra, empresa_id, latitud, longitud
       FROM obras
       WHERE id = $1`,
      [numericObraId]
    );
    return mapObra(result.rows[0]);
  }

  async function resolveObraByProyecto({ nombreProyecto, empresaId = null }) {
    if (!nombreProyecto || typeof nombreProyecto !== "string") return null;
    const params = [nombreProyecto.trim()];
    let sql = `
      SELECT id, nombre_obra, empresa_id, latitud, longitud
      FROM obras
      WHERE LOWER(nombre_obra) = LOWER($1)
    `;

    if (empresaId != null) {
      params.push(Number(empresaId));
      sql += ` AND empresa_id = $2`;
    }

    sql += ` ORDER BY id DESC LIMIT 1`;

    const result = await db.query(sql, params);
    return mapObra(result.rows[0]);
  }

  async function validateCoordinatesAgainstObra({ obraId, latitude, longitude }) {
    const obra = await resolveObraById(obraId);
    if (!obra) {
      return {
        ok: false,
        obra: null,
        distanceMeters: null,
        bypass: false,
        reason: "OBRA_NOT_FOUND",
        message: "Obra no encontrada o sin coordenadas"
      };
    }

    if (obra.nombre === bypassObraName) {
      return {
        ok: true,
        obra,
        distanceMeters: 0,
        bypass: true,
        reason: "OBRA_BYPASS",
        message: "Obra configurada en bypass"
      };
    }

    if (obra.latitud == null || obra.longitud == null) {
      return {
        ok: false,
        obra,
        distanceMeters: null,
        bypass: false,
        reason: "OBRA_WITHOUT_COORDINATES",
        message: "La obra no tiene coordenadas configuradas"
      };
    }

    const distanceMeters = Math.round(
      getDistanceFromLatLonInMeters(latitude, longitude, obra.latitud, obra.longitud)
    );

    if (distanceMeters <= maxDistanceMeters) {
      return {
        ok: true,
        obra,
        distanceMeters,
        bypass: false,
        reason: "WITHIN_RANGE",
        message: "Ubicación validada"
      };
    }

    return {
      ok: false,
      obra,
      distanceMeters,
      bypass: false,
      reason: "OUTSIDE_RANGE",
      message: "No estás en la ubicación de la obra seleccionada"
    };
  }

  async function upsertSessionContext({
    sessionId,
    actorId,
    actorType,
    workerId = null,
    obraId,
    obraNombre,
    latitude,
    longitude,
    accuracyMeters = null,
    distanceMeters = null,
    withinRange,
    validationSource = "validar_ubicacion",
    request = null
  }) {
    const numericLatitude = normalizeNumber(latitude);
    const numericLongitude = normalizeNumber(longitude);
    if (numericLatitude == null || numericLongitude == null) {
      throw new Error("Latitude and longitude are required to persist session context");
    }

    const numericAccuracy = normalizeNumber(accuracyMeters);

    const result = await db.query(
      `INSERT INTO auth_session_location_contexts (
         session_id,
         actor_id,
         actor_type,
         worker_id,
         obra_id,
         obra_nombre,
         latitude,
         longitude,
         accuracy_meters,
         distance_meters,
         within_range,
         validation_source,
         validated_at,
         created_ip,
         user_agent,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13::inet, $14, NOW(), NOW())
       ON CONFLICT (session_id) DO UPDATE SET
         actor_id = EXCLUDED.actor_id,
         actor_type = EXCLUDED.actor_type,
         worker_id = EXCLUDED.worker_id,
         obra_id = EXCLUDED.obra_id,
         obra_nombre = EXCLUDED.obra_nombre,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         accuracy_meters = EXCLUDED.accuracy_meters,
         distance_meters = EXCLUDED.distance_meters,
         within_range = EXCLUDED.within_range,
         validation_source = EXCLUDED.validation_source,
         validated_at = EXCLUDED.validated_at,
         created_ip = EXCLUDED.created_ip,
         user_agent = EXCLUDED.user_agent,
         updated_at = NOW()
       RETURNING *`,
      [
        sessionId,
        String(actorId),
        actorType,
        workerId == null ? null : Number(workerId),
        obraId == null ? null : Number(obraId),
        obraNombre || null,
        numericLatitude,
        numericLongitude,
        numericAccuracy,
        distanceMeters == null ? null : Number(distanceMeters),
        Boolean(withinRange),
        validationSource,
        getRequestIp(request),
        getRequestUserAgent(request)
      ]
    );

    return mapSessionContext(result.rows[0]);
  }

  async function findSessionContext(sessionId) {
    const result = await db.query(
      `SELECT *
       FROM auth_session_location_contexts
       WHERE session_id = $1`,
      [sessionId]
    );
    return mapSessionContext(result.rows[0]);
  }

  async function appendAuditLog({
    sessionId = null,
    actorId = null,
    actorType = null,
    workerId = null,
    horasJornadaId = null,
    eventType,
    action,
    message = null,
    obraId = null,
    obraNombre = null,
    latitude = null,
    longitude = null,
    accuracyMeters = null,
    distanceMeters = null,
    withinRange = null,
    payload = null,
    request = null
  }) {
    const result = await db.query(
      `INSERT INTO attendance_location_audit_logs (
         session_id,
         actor_id,
         actor_type,
         worker_id,
         horas_jornada_id,
         event_type,
         action,
         message,
         obra_id,
         obra_nombre,
         latitude,
         longitude,
         accuracy_meters,
         distance_meters,
         within_range,
         ip,
         user_agent,
         payload,
         created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16::inet, $17, $18::jsonb, NOW()
       )
       RETURNING id`,
      [
        sessionId || null,
        actorId == null ? null : String(actorId),
        actorType || null,
        workerId == null ? null : Number(workerId),
        horasJornadaId == null ? null : Number(horasJornadaId),
        eventType,
        action,
        message,
        obraId == null ? null : Number(obraId),
        obraNombre || null,
        normalizeNumber(latitude),
        normalizeNumber(longitude),
        normalizeNumber(accuracyMeters),
        distanceMeters == null ? null : Number(distanceMeters),
        typeof withinRange === "boolean" ? withinRange : null,
        getRequestIp(request),
        getRequestUserAgent(request),
        payload == null ? null : JSON.stringify(payload)
      ]
    );

    return Number(result.rows[0].id);
  }

  return {
    resolveObraById,
    resolveObraByProyecto,
    validateCoordinatesAgainstObra,
    upsertSessionContext,
    findSessionContext,
    appendAuditLog
  };
}
