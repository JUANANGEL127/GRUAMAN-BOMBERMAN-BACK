import { Router } from "express";
const router = Router();

// IMPORTANTE: Si usas consultas SQL que referencian la tabla obras como "o", usa "o.nombreObra" en vez de "o.nombre"

// Ejemplo de corrección en un query:
// SELECT ... o.nombreObra ... FROM obras o ...

// GET /horas-usuario
router.get('/horas-usuario', (req, res) => {
    // ...lógica original de index.js para /horas-usuario...
    // Asegúrate de usar o.nombreObra en tus queries si usas la tabla obras
});

// GET /horas-sistema
router.get('/horas-sistema', (req, res) => {
    // ...lógica original de index.js para /horas-sistema...
    // Asegúrate de usar o.nombreObra en tus queries si usas la tabla obras
});

// GET /horas
router.get('/horas', (req, res) => {
    // ...lógica original de index.js para /horas...
    // Asegúrate de usar o.nombreObra en tus queries si usas la tabla obras
});

// GET /horas-extras
router.get('/horas-extras', (req, res) => {
    // ...lógica original de index.js para /horas-extras...
    // Asegúrate de usar o.nombreObra en tus queries si usas la tabla obras
});

// GET /formulario1/registros-todos-resumen
router.get('/formulario1/registros-todos-resumen', (req, res) => {
    // ...lógica original de index.js para /formulario1/registros-todos-resumen...
    // Asegúrate de usar o.nombreObra en tus queries si usas la tabla obras
});

export default router;
