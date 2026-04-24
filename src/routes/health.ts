import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'followup-flow',
    status: 'ok',
    message: 'Follow-up Flow está no ar',
  });
});

export default router;
