import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : 'Erro interno';
  console.error('[followup-flow]', message);
  if (!res.headersSent) {
    res.status(500).json({ status: 'error', message });
  }
}
