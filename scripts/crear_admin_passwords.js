import dotenv from "dotenv";
dotenv.config(); // Carga .env o .env.local automáticamente

import bcrypt from "bcrypt";
import pkg from "pg";
const { Pool } = pkg;

// Usa DATABASE_URL si está definida, si no usa las variables locales
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "postgres",
      port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    });

async function crearPassword(password, rol) {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    "INSERT INTO admin_passwords (password_hash, rol) VALUES ($1, $2)",
    [hash, rol]
  );
  console.log("Contraseña creada para rol:", rol);
}

await crearPassword("", "gruaman");
await crearPassword("", "bomberman");
await pool.end();
