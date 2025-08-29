import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import { ENV, validateEnvironment } from './utils/env';
import { logger } from './utils/logger';
import { twimlHandler, twilioStatusHandler, incomingCallHandler } from './twilio/twiml';
import { createTwilioVerificationMiddleware } from './security/twilio-verify';
import { createGeneralRateLimit } from './security/rate-limit';
import { handleTwilioStream } from './realtime/bridge';
import aigentsRouter from './routes/aigents';
import webhookRouter from './routes/webhook';

// Validate environment variables on startup
validateEnvironment();

// Create Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/twilio-stream',
});

// Middleware for parsing raw body (needed for signature verification)
app.use('/twilio-status', express.raw({ type: 'application/x-www-form-urlencoded' }));
app.use('/twiml', express.raw({ type: 'application/x-www-form-urlencoded' }));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API server
}));

app.use(cors({
  origin: true, // Allow all origins for API access
  credentials: true,
}));

// General rate limiting
app.use(createGeneralRateLimit());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('HTTP request completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
  });
  
  next();
});

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: ENV.NODE_ENV,
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'AIGENTS Voice Bridge',
    version: process.env.npm_package_version || '1.0.0',
    environment: ENV.NODE_ENV,
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/healthz',
      aigents: '/aigents/*',
      webhook: '/webhook/*',
      twiml: '/twiml',
      twilioStatus: '/twilio-status',
      twilioStream: 'ws://host/twilio-stream',
    },
  });
});

// Twilio endpoints (with signature verification)
const twilioVerify = createTwilioVerificationMiddleware();

app.post('/twiml', twilioVerify, (req, res) => {
  // Parse URL-encoded body for TwiML handler
  const body = new URLSearchParams(req.body.toString());
  req.body = Object.fromEntries(body.entries());
  twimlHandler(req, res);
});

app.post('/twilio-status', twilioVerify, (req, res) => {
  // Parse URL-encoded body for status handler
  const body = new URLSearchParams(req.body.toString());
  req.body = Object.fromEntries(body.entries());
  twilioStatusHandler(req, res);
});

// Handle incoming calls (optional)
app.post('/incoming', twilioVerify, (req, res) => {
  const body = new URLSearchParams(req.body.toString());
  req.body = Object.fromEntries(body.entries());
  incomingCallHandler(req, res);
});

// AIGENTS API routes
app.use('/aigents', aigentsRouter);

// Webhook routes
app.use('/webhook', webhookRouter);

// WebSocket connection handling
wss.on('connection', async (ws, request) => {
  const wsLogger = logger.child({
    component: 'websocket-server',
    url: request.url,
    origin: request.headers.origin,
  });

  wsLogger.info('WebSocket connection established');

  try {
    // Handle Twilio Media Streams
    if (request.url === '/twilio-stream') {
      await handleTwilioStream(ws, request);
    } else {
      wsLogger.warn('Unknown WebSocket path', { url: request.url });
      ws.close(1008, 'Unknown path');
    }
  } catch (error) {
    wsLogger.error('Error handling WebSocket connection', { error });
    ws.close(1011, 'Internal server error');
  }
});

// WebSocket server error handling
wss.on('error', (error) => {
  logger.error('WebSocket server error', { error });
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled application error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: ENV.isDevelopment ? error.message : 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, starting graceful shutdown');
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Close WebSocket server
    wss.close(() => {
      logger.info('WebSocket server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, starting graceful shutdown');
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    wss.close(() => {
      logger.info('WebSocket server closed');
      process.exit(0);
    });
  });
});

// Unhandled promise rejection handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Uncaught exception handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  
  // Exit gracefully
  process.exit(1);
});

// Start server
const PORT = ENV.PORT;
const HOST = '0.0.0.0'; // Listen on all interfaces for deployment

server.listen(PORT, HOST, () => {
  logger.info('AIGENTS Voice Bridge server started', {
    port: PORT,
    host: HOST,
    environment: ENV.NODE_ENV,
    publicOrigin: ENV.PUBLIC_ORIGIN,
    version: process.env.npm_package_version || '1.0.0',
  });
  
  logger.info('Server endpoints available', {
    health: `http://${HOST}:${PORT}/healthz`,
    aigents: `http://${HOST}:${PORT}/aigents/`,
    webhook: `http://${HOST}:${PORT}/webhook/`,
    twiml: `http://${HOST}:${PORT}/twiml`,
    websocket: `ws://${HOST}:${PORT}/twilio-stream`,
  });
});

export default app;

