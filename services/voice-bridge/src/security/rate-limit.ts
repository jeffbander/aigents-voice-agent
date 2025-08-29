import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { ENV } from '../utils/env';
import { createRequestLogger } from '../utils/logger';

// Create rate limiters for different endpoints
const aigentsRateLimiter = new RateLimiterMemory({
  keyGenerator: (req: Request) => {
    // Rate limit by IP address for AIGENTS endpoints
    return req.ip || 'unknown';
  },
  points: ENV.RATE_LIMIT_MAX_REQUESTS, // Number of requests
  duration: Math.floor(ENV.RATE_LIMIT_WINDOW_MS / 1000), // Per duration in seconds
  blockDuration: 60, // Block for 60 seconds if limit exceeded
});

const webhookRateLimiter = new RateLimiterMemory({
  keyGenerator: (req: Request) => {
    // Rate limit by IP address for webhook endpoints
    return req.ip || 'unknown';
  },
  points: ENV.RATE_LIMIT_MAX_REQUESTS * 2, // More lenient for webhooks
  duration: Math.floor(ENV.RATE_LIMIT_WINDOW_MS / 1000),
  blockDuration: 30, // Shorter block duration for webhooks
});

const twilioRateLimiter = new RateLimiterMemory({
  keyGenerator: (req: Request) => {
    // Rate limit by Twilio Account SID if available, otherwise IP
    const accountSid = req.body?.AccountSid || req.query?.AccountSid;
    return accountSid || req.ip || 'unknown';
  },
  points: 1000, // Very high limit for Twilio (they have their own rate limiting)
  duration: 60, // Per minute
  blockDuration: 10, // Short block duration
});

/**
 * Create rate limiting middleware for AIGENTS endpoints
 */
export function createAigentsRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const logger = createRequestLogger(req);
    
    try {
      await aigentsRateLimiter.consume(req.ip || 'unknown');
      logger.debug('Rate limit check passed for AIGENTS endpoint');
      next();
    } catch (rateLimiterRes) {
      const result = rateLimiterRes as RateLimiterRes;
      const remainingPoints = result.remainingPoints || 0;
      const msBeforeNext = result.msBeforeNext || 0;
      
      logger.warn('Rate limit exceeded for AIGENTS endpoint', {
        remainingPoints,
        msBeforeNext,
        ip: req.ip,
      });

      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded for AIGENTS endpoints',
        retryAfter: Math.ceil(msBeforeNext / 1000),
        remainingPoints,
      });
    }
  };
}

/**
 * Create rate limiting middleware for webhook endpoints
 */
export function createWebhookRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const logger = createRequestLogger(req);
    
    try {
      await webhookRateLimiter.consume(req.ip || 'unknown');
      logger.debug('Rate limit check passed for webhook endpoint');
      next();
    } catch (rateLimiterRes) {
      const result = rateLimiterRes as RateLimiterRes;
      const remainingPoints = result.remainingPoints || 0;
      const msBeforeNext = result.msBeforeNext || 0;
      
      logger.warn('Rate limit exceeded for webhook endpoint', {
        remainingPoints,
        msBeforeNext,
        ip: req.ip,
      });

      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded for webhook endpoints',
        retryAfter: Math.ceil(msBeforeNext / 1000),
        remainingPoints,
      });
    }
  };
}

/**
 * Create rate limiting middleware for Twilio endpoints
 */
export function createTwilioRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const logger = createRequestLogger(req);
    
    try {
      const key = req.body?.AccountSid || req.query?.AccountSid || req.ip || 'unknown';
      await twilioRateLimiter.consume(key);
      logger.debug('Rate limit check passed for Twilio endpoint');
      next();
    } catch (rateLimiterRes) {
      const result = rateLimiterRes as RateLimiterRes;
      const remainingPoints = result.remainingPoints || 0;
      const msBeforeNext = result.msBeforeNext || 0;
      
      logger.warn('Rate limit exceeded for Twilio endpoint', {
        remainingPoints,
        msBeforeNext,
        accountSid: req.body?.AccountSid,
        ip: req.ip,
      });

      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded for Twilio endpoints',
        retryAfter: Math.ceil(msBeforeNext / 1000),
        remainingPoints,
      });
    }
  };
}

/**
 * General purpose rate limiter
 */
export function createGeneralRateLimit(points: number = 100, durationSec: number = 900) {
  const limiter = new RateLimiterMemory({
    keyGenerator: (req: Request) => req.ip || 'unknown',
    points,
    duration: durationSec,
    blockDuration: 60,
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    const logger = createRequestLogger(req);
    
    try {
      await limiter.consume(req.ip || 'unknown');
      logger.debug('General rate limit check passed');
      next();
    } catch (rateLimiterRes) {
      const result = rateLimiterRes as RateLimiterRes;
      
      logger.warn('General rate limit exceeded', {
        remainingPoints: result.remainingPoints,
        msBeforeNext: result.msBeforeNext,
        ip: req.ip,
      });

      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        retryAfter: Math.ceil((result.msBeforeNext || 0) / 1000),
      });
    }
  };
}

