import bcrypt from "bcrypt";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
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

await crearPassword("GyEgruaman2026", "gruaman");
await crearPassword("GyEbomberman2026", "bomberman");
await pool.end();
