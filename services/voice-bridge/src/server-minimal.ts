import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import { ENV } from './utils/env';
import { logger } from './utils/logger';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server,
  path: '/twilio-stream',
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: ENV.NODE_ENV,
  });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    service: 'AIGENTS Voice Bridge',
    version: '1.0.0',
    environment: ENV.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// TwiML endpoint for Twilio
app.post('/twiml', (req, res) => {
  logger.info('TwiML request received', { body: req.body });
  
  // Return basic TwiML response to start media stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://${req.hostname}/twilio-stream" />
  </Start>
  <Say>Connecting you to the assistant.</Say>
  <Pause length="60" />
</Response>`;
  
  res.type('text/xml').send(twiml);
});

// Basic AIGENTS trigger endpoint
app.post('/aigents/call.trigger', async (req, res) => {
  logger.info('AIGENTS call trigger received', { 
    chainRunId: req.body.chainRunId,
    agentName: req.body.agentName 
  });
  
  try {
    // For now, just acknowledge the request
    res.json({
      ok: true,
      message: 'Call trigger received',
      chainRunId: req.body.chainRunId,
    });
  } catch (error) {
    logger.error('Error handling call trigger', { error });
    res.status(500).json({ error: 'Failed to process call trigger' });
  }
});

// WebSocket handling
wss.on('connection', async (ws, request) => {
  logger.info('WebSocket connection established', { url: request.url });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      logger.debug('Received WebSocket message', { type: message.event });
      
      // Handle Twilio Media Stream events
      if (message.event === 'connected') {
        logger.info('Twilio Media Stream connected', { streamSid: message.streamSid });
      } else if (message.event === 'media') {
        // Audio data received - would forward to OpenAI here
        logger.debug('Audio frame received');
      } else if (message.event === 'stop') {
        logger.info('Twilio Media Stream stopped');
        ws.close();
      }
    } catch (error) {
      logger.error('Error processing WebSocket message', { error });
    }
  });
  
  ws.on('close', () => {
    logger.info('WebSocket connection closed');
  });
  
  ws.on('error', (error) => {
    logger.error('WebSocket error', { error });
  });
});

// Error handling
app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: error.message, url: req.url });
  res.status(500).json({ error: 'Internal Server Error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Start server
const PORT = ENV.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`Voice Bridge server started on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/healthz`);
  logger.info(`ngrok URL: ${ENV.PUBLIC_ORIGIN}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => {
    wss.close(() => {
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  server.close(() => {
    wss.close(() => {
      process.exit(0);
    });
  });
});