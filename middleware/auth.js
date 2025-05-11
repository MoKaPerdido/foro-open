// middleware/auth.js

function requireLogin(req, res, next) {
    if (req.session && req.session.usuario) {
      return next();
    }
    return res.redirect('/login');
  }
  
  module.exports = {
    requireLogin
  };
  