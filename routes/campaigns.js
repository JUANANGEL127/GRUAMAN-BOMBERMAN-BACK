import { Router } from "express";

export function createCampaignsRouter({ campaignsController }) {
  const router = Router();
  router.get("/active", campaignsController.getActiveCampaign);
  return router;
}

export default createCampaignsRouter;

