function createAuthMiddleware({ getSessionUser }) {
  async function requireAuth(req, res, next) {
    try {
      const session = await getSessionUser(req);
      if (!session?.user) return res.status(401).json({ ok:false, message:'Debes iniciar sesión.' });
      if (String(session.user.status || 'active').toLowerCase() !== 'active' && session.user.role !== 'restaurant') {
        return res.status(403).json({ ok:false, message:'La cuenta no está activa.' });
      }
      req.auth = { type: session.type, user: session.user, role: String(session.user.role || '').toLowerCase() };
      next();
    } catch (error) { next(error); }
  }
  const requireRole = (...roles) => [requireAuth, (req,res,next) => roles.includes(req.auth.role) ? next() : res.status(403).json({ok:false,message:'No tienes permiso para realizar esta acción.'})];
  function requireOwnerEmail(paramName='email') {
    return (req,res,next) => String(req.params[paramName]||'').trim().toLowerCase() === String(req.auth?.user?.email||'').trim().toLowerCase() ? next() : res.status(403).json({ok:false,message:'No puedes acceder a información de otra cuenta.'});
  }
  return { requireAuth, requireRole, requireOwnerEmail };
}
module.exports={createAuthMiddleware};
