import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import { ENV } from '../utils/env';
import { createRequestLogger } from '../utils/logger';

/**
 * Verify Twilio request signature
 * This ensures the request actually came from Twilio
 */
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const logger = createRequestLogger(req);
  
  try {
    const signature = req.get('X-Twilio-Signature');
    if (!signature) {
      logger.warn('Missing Twilio signature header');
      res.status(403).json({
        error: 'Missing signature',
        message: 'X-Twilio-Signature header required',
      });
      return;
    }

    // Construct the full URL that Twilio used to make the request
    const protocol = req.get('X-Forwarded-Proto') || req.protocol;
    const host = req.get('Host');
    const url = `${protocol}://${host}${req.originalUrl}`;

    // Get the request body (for POST requests)
    const body = req.body || {};
    
    // Verify the signature
    const isValid = twilio.validateRequest(
      ENV.TWILIO_AUTH_TOKEN,
      signature,
      url,
      body
    );

    if (!isValid) {
      logger.warn('Twilio signature verification failed', {
        url,
        hasBody: Object.keys(body).length > 0,
      });
      
      res.status(403).json({
        error: 'Invalid signature',
        message: 'Twilio signature verification failed',
      });
      return;
    }

    logger.debug('Twilio signature verification successful', { url });
    next();
  } catch (error) {
    logger.error('Error during Twilio signature verification', { error });
    res.status(500).json({
      error: 'Verification error',
      message: 'Internal server error during signature verification',
    });
  }
}

/**
 * Optional: More lenient verification for development
 * Only use this in development environments with ngrok
 */
export function verifyTwilioSignatureDev(req: Request, res: Response, next: NextFunction): void {
  if (ENV.isProduction) {
    // In production, always use strict verification
    return verifyTwilioSignature(req, res, next);
  }

  const logger = createRequestLogger(req);
  logger.warn('Using development Twilio signature verification (less strict)');
  
  // In development, we might skip verification or be more lenient
  // This is useful when testing with ngrok where URLs might change
  const signature = req.get('X-Twilio-Signature');
  
  if (!signature) {
    logger.warn('Missing Twilio signature in development mode - allowing request');
  } else {
    logger.debug('Twilio signature present in development mode');
  }
  
  next();
}

/**
 * Middleware factory that chooses verification method based on environment
 */
export function createTwilioVerificationMiddleware() {
  return ENV.isDevelopment ? verifyTwilioSignatureDev : verifyTwilioSignature;
}

