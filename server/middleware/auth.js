const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) {
    return res.status(403).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];
  if (!token) {
    return res.status(403).json({ error: 'Malformed token' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Failed to authenticate token' });
    }
    req.userId = decoded.id;
    req.username = decoded.username;
    next();
  });
}

module.exports = verifyToken;
