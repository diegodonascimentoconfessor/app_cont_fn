// Servidor estático opcional. Os dados ficam no localStorage do navegador,
// então o app também funciona abrindo public/index.html direto.
const express = require('express');
const path = require('path');
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
