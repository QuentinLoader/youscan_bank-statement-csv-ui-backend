import jwt from "jsonwebtoken";
import pool from '../config/db.js';
import { createSupabaseAuthenticator, IdentityError } from '../services/supabaseIdentity.service.js';

const authenticateSupabase = createSupabaseAuthenticator({ dbPool: pool });

export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    if (process.env.AUTH_PROVIDER && !['legacy', 'supabase'].includes(process.env.AUTH_PROVIDER)) {
      return res.status(503).json({ code: 'IDENTITY_CONFIG_INVALID', message: 'Sign-in configuration is unavailable.' });
    }

    if (process.env.AUTH_PROVIDER === 'supabase') {
      req.user = await authenticateSupabase(token);
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded; // contains userId
    next();

  } catch (err) {
    if (err instanceof IdentityError) return res.status(err.status).json({ code: err.code, message: err.message });
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
