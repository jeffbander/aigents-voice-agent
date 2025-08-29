import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ENV } from '../utils/env';
import { createRequestLogger } from '../utils/logger';

/**
 * Verify AIGENTS HMAC signature
 * Expected header format: X-Aigents-Signature: sha256=<hex>
 */
export function verifyAigentsSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) {
    return false;
  }

  const [algorithm, signature] = header.split('=');
  if (algorithm !== 'sha256' || !signature) {
    return false;
  }

  const expectedMac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expectedMac, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/**
 * Express middleware to verify AIGENTS HMAC signature
 */
export function verifyAigentsHMAC(req: Request, res: Response, next: NextFunction): void {
  const logger = createRequestLogger(req);
  
  try {
    const signature = req.get('X-Aigents-Signature');
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    
    if (!verifyAigentsSignature(rawBody, signature, ENV.AIGENTS_HMAC_SECRET)) {
      logger.warn('AIGENTS HMAC verification failed', {
        hasSignature: !!signature,
        bodyLength: rawBody.length,
      });
      
      res.status(403).json({
        error: 'Invalid signature',
        message: 'HMAC verification failed',
      });
      return;
    }

    logger.debug('AIGENTS HMAC verification successful');
    next();
  } catch (error) {
    logger.error('Error during HMAC verification', { error });
    res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during authentication',
    });
  }
}

/**
 * Generate HMAC signature for outgoing requests to AIGENTS
 */
export function generateAigentsSignature(body: string, secret: string): string {
  const mac = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${mac}`;
}

/**
 * Optional JWT verification middleware (if JWT tokens are used)
 */
export function verifyJWT(req: Request, res: Response, next: NextFunction): void {
  const logger = createRequestLogger(req);
  
  try {
    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Missing token',
        message: 'Authorization header with Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    
    // JWT verification would go here if needed
    // For now, just pass through
    logger.debug('JWT verification skipped (not implemented)');
    next();
  } catch (error) {
    logger.error('Error during JWT verification', { error });
    res.status(500).json({
      error: 'Authentication error',
      message: 'Internal server error during JWT verification',
    });
  }
}

/**
 * Create a signature for outgoing webhook calls
 */
export function createWebhookSignature(payload: any, secret: string): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return generateAigentsSignature(body, secret);
}

