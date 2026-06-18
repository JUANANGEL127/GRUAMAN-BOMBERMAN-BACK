import { Router } from "express";
import multer from "multer";

function resolveUploadMiddleware(uploadMiddleware) {
  if (uploadMiddleware) return uploadMiddleware;
  return multer({ storage: multer.memoryStorage() });
}

export function createAdminCampaignsRouter({ campaignsController, uploadMiddleware }) {
  const router = Router();
  const upload = resolveUploadMiddleware(uploadMiddleware);

  router.get("/", campaignsController.listCampaigns);
  router.get("/:id", campaignsController.getCampaignById);
  router.post("/", upload.single("image"), campaignsController.createCampaign);
  router.put("/:id", upload.single("image"), campaignsController.updateCampaign);
  router.patch("/:id/status", campaignsController.patchCampaignStatus);
  router.post("/:id/archive", campaignsController.archiveCampaign);

  return router;
}

export default createAdminCampaignsRouter;

