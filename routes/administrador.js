import { Router } from "express";
const router = Router();

// Ruta para obtener las horas ingresadas por el usuario
router.get('/horas-usuario', (req, res) => {
    // ...existing code...
});

// Ruta para obtener las horas registradas por el sistema
router.get('/horas-sistema', (req, res) => {
    // ...existing code...
});

// Ruta para obtener las horas trabajadas
router.get('/horas', (req, res) => {
    // ...existing code...
});

// Ruta para obtener las horas extras trabajadas
router.get('/horas-extras', (req, res) => {
    // ...existing code...
});

// Ruta para obtener un resumen de todos los registros
router.get('/formulario1/registros-todos-resumen', (req, res) => {
    // ...existing code...
});

export default router;
