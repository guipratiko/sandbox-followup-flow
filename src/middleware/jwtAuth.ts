import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface FollowupAuthRequest extends Request {
  jwtUserId?: string;
  tenantUserId?: string;
}

export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.jwtSecret) {
    res.status(503).json({ status: 'error', message: 'JWT_SECRET não configurado no microserviço.' });
    return;
  }
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) {
    res.status(401).json({ status: 'error', message: 'Token não fornecido.' });
    return;
  }
  const token = h.slice(7).trim();
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as { id: string };
    const r = req as FollowupAuthRequest;
    r.jwtUserId = decoded.id;
    const eff = (req.headers['x-effective-user-id'] as string | undefined)?.trim();
    r.tenantUserId = eff || decoded.id;
    next();
  } catch {
    res.status(401).json({ status: 'error', message: 'Token inválido ou expirado.' });
  }
}
