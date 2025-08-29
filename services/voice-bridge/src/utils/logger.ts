import pino from 'pino';
import { ENV } from './env';

// Create logger configuration
const loggerConfig: pino.LoggerOptions = {
  level: ENV.isDevelopment ? 'debug' : 'info',
  
  // Pretty print in development
  ...(ENV.isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  }),

  // Structured logging in production
  ...(!ENV.isDevelopment && {
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }),

  // Base fields for all logs
  base: {
    service: 'aigents-voice-bridge',
    version: process.env.npm_package_version || '1.0.0',
    environment: ENV.NODE_ENV,
  },

  // Redact sensitive information
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-aigents-signature"]',
      'req.headers["x-twilio-signature"]',
      'password',
      'token',
      'secret',
      'key',
      'apiKey',
      'api_key',
    ],
    censor: '[REDACTED]',
  },
};

// Create the logger instance
export const logger = pino(loggerConfig);

// Helper function to create child loggers with context
export function createChildLogger(context: Record<string, any>) {
  return logger.child(context);
}

// Helper function for request logging
export function createRequestLogger(req: any) {
  return logger.child({
    requestId: req.id || generateRequestId(),
    method: req.method,
    url: req.url,
    userAgent: req.get('user-agent'),
    ip: req.ip,
  });
}

// Helper function for call logging
export function createCallLogger(callSid: string, chainRunId?: string) {
  return logger.child({
    callSid,
    chainRunId,
    component: 'call-handler',
  });
}

// Helper function for WebSocket logging
export function createWebSocketLogger(type: 'twilio' | 'openai' | 'biomarker', sessionId?: string) {
  return logger.child({
    component: 'websocket',
    wsType: type,
    sessionId,
  });
}

// Generate a simple request ID
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Export logger types for TypeScript
export type Logger = typeof logger;
export type ChildLogger = ReturnType<typeof createChildLogger>;

