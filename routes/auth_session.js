import express from "express";

export function createAuthSessionRouter({ authSessionController, csrfProtection }) {
  const router = express.Router();

  router.get("/session", authSessionController.getSession);
  router.get("/csrf", authSessionController.getCsrf);
  router.post("/refresh", csrfProtection, authSessionController.refresh);
  router.post("/logout", csrfProtection, authSessionController.logout);

  return router;
}
