const express = require('express');
const app = express();

app.use('/tunnel/:ip', (req, res, next) => {
    res.send({ ip: req.params.ip, url: req.url, originalUrl: req.originalUrl });
});

app.listen(3002, () => console.log('started'));
