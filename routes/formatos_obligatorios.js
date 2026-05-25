import { Router } from "express";
import { createFormatosObligatoriosEstadoRepository } from "../repositories/formatosObligatoriosEstadoRepository.js";
import { createFormatosObligatoriosEstadoService } from "../services/formatosObligatoriosEstadoService.js";
import { createFormatosObligatoriosController } from "../controllers/formatosObligatoriosController.js";

const router = Router();

const repository = createFormatosObligatoriosEstadoRepository({ db: () => global.db });
const service = createFormatosObligatoriosEstadoService({ repository });
const controller = createFormatosObligatoriosController({ service });

router.get("/estado", controller.getEstado);

export default router;
