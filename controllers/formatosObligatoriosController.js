export function createFormatosObligatoriosController({ service }) {
  return {
    getEstado: async (req, res) => {
      try {
        const estado = await service.getEstado(req.query);
        return res.json(estado);
      } catch (error) {
        const status = Number(error?.status) || 500;

        if (status === 400) {
          return res.status(400).json({ error: error.message });
        }

        if (status === 404) {
          return res.status(404).json({ error: error.message });
        }

        console.error("Error en GET /formatos_obligatorios/estado:", error);
        return res.status(500).json({ error: "Error interno consultando estado de formatos obligatorios" });
      }
    }
  };
}
