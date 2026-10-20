const express = require('express');
const path = require('node:path');
const app = express();
app.use(express.static(path.resolve(__dirname, '../../web')));
app.listen(4173, '127.0.0.1', () => console.log('Catalog preview: http://127.0.0.1:4173'));
