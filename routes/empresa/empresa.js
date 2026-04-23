import {Router} from "express"

const router = Router();

router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

router.get("/", async (req, res) => {
    const db = global.db;

    console.log("entra a mirar empresas");
    

    try {
        const result = await db.query(`SELECT * FROM empresas ORDER BY id asc`);

        return res.json({empresas: result.rows})
    } catch (error) {
        return res.status(500).json({ error: "Error consultando Empresas" });
    }
});

export default router;