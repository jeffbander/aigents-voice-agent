import { Router, Request, Response } from 'express';
import { repo } from '../db/repo';
import { createWebhookRateLimit } from '../security/rate-limit';
import { createRequestLogger } from '../utils/logger';
import {
  AigentsWebhookRequestSchema,
  safeValidateRequest,
  type AigentsWebhookRequest,
  type AigentsWebhookResponse,
} from '../types/contracts';

export const router = Router();

// Apply rate limiting to webhook routes
router.use(createWebhookRateLimit());

/**
 * POST /webhook/agents
 * Receive structured results from the voice agent
 */
router.post('/agents', async (req: Request, res: Response) => {
  const logger = createRequestLogger(req);
  
  try {
    logger.info('Received agent webhook callback');

    // Validate request payload
    const validation = safeValidateRequest(AigentsWebhookRequestSchema, req.body);
    if (!validation.success) {
      logger.warn('Invalid webhook payload', { 
        errors: validation.error.errors 
      });
      
      return res.status(400).json({
        message: 'Invalid webhook payload',
        chainRunId: req.body?.chainRunId || 'unknown',
        status: 'error',
        error: 'Request validation failed',
        details: validation.error.errors,
      });
    }

    const webhookData = validation.data;
    
    logger.info('Processing agent webhook', {
      chainRunId: webhookData.chainRunId,
      agentName: webhookData.agentName,
      hasResponse: !!webhookData.agentResponse,
    });

    // Update automation log with agent response
    try {
      await repo.updateAutomationLogStatus(
        webhookData.chainRunId,
        'completed',
        JSON.stringify(webhookData.agentResponse)
      );

      logger.debug('Updated automation log', { 
        chainRunId: webhookData.chainRunId 
      });
    } catch (dbError) {
      logger.error('Failed to update automation log', { 
        error: dbError,
        chainRunId: webhookData.chainRunId 
      });
    }

    // Update call record with summary
    try {
      const call = await repo.getCallByChainRunId(webhookData.chainRunId);
      if (call && call.callSid) {
        await repo.updateCallStatus(call.callSid, 'completed', webhookData.agentResponse);
        
        // Log completion event
        await repo.logCallEvent(call.id, 'agent_response_received', {
          agentName: webhookData.agentName,
          summary: webhookData.agentResponse.summary,
          redFlags: webhookData.agentResponse.red_flags,
          recommendation: webhookData.agentResponse.recommendation,
          biomarker: webhookData.agentResponse.biomarker,
        });

        logger.debug('Updated call record with agent response', { 
          callId: call.id,
          callSid: call.callSid,
        });
      } else {
        logger.warn('Call record not found for chain run ID', { 
          chainRunId: webhookData.chainRunId 
        });
      }
    } catch (dbError) {
      logger.error('Failed to update call record', { 
        error: dbError,
        chainRunId: webhookData.chainRunId 
      });
    }

    // Log key metrics from the response
    const agentResponse = webhookData.agentResponse;
    logger.info('Agent response processed', {
      chainRunId: webhookData.chainRunId,
      redFlags: agentResponse.red_flags,
      biomarkerRisk: agentResponse.biomarker?.risk,
      biomarkerStatus: agentResponse.biomarker?.status,
      summaryPoints: agentResponse.summary?.length || 0,
      hasEscalation: !!agentResponse.escalation,
      escalationLevel: agentResponse.escalation?.level,
    });

    // Check for escalations and log appropriately
    if (agentResponse.red_flags || agentResponse.escalation?.level !== 'none') {
      logger.warn('Agent identified concerns requiring attention', {
        chainRunId: webhookData.chainRunId,
        redFlags: agentResponse.red_flags,
        escalationLevel: agentResponse.escalation?.level,
        escalationReason: agentResponse.escalation?.reason,
        symptoms: agentResponse.symptoms,
      });
    }

    // Prepare response
    const response: AigentsWebhookResponse = {
      message: 'Agent response processed successfully',
      chainRunId: webhookData.chainRunId,
      status: 'success',
    };

    logger.info('Webhook processing completed successfully', {
      chainRunId: webhookData.chainRunId,
    });

    res.status(200).json(response);

  } catch (error) {
    logger.error('Error processing agent webhook', { error });

    const response: AigentsWebhookResponse = {
      message: 'Failed to process agent response',
      chainRunId: req.body?.chainRunId || 'unknown',
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    res.status(500).json(response);
  }
});

/**
 * POST /webhook/test
 * Test endpoint for webhook functionality
 */
router.post('/test', async (req: Request, res: Response) => {
  const logger = createRequestLogger(req);
  
  try {
    logger.info('Webhook test endpoint called', { 
      body: req.body,
      headers: Object.keys(req.headers),
    });

    res.status(200).json({
      message: 'Webhook test successful',
      timestamp: new Date().toISOString(),
      received: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
      },
    });

  } catch (error) {
    logger.error('Webhook test failed', { error });
    res.status(500).json({
      message: 'Webhook test failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /webhook/health
 * Health check for webhook endpoints
 */
router.get('/health', async (req: Request, res: Response) => {
  const logger = createRequestLogger(req);

  try {
    // Basic health check
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      endpoints: {
        agents: 'available',
        test: 'available',
      },
    };

    logger.debug('Webhook health check completed');
    res.status(200).json(health);

  } catch (error) {
    logger.error('Webhook health check failed', { error });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Middleware to log all webhook requests for debugging
 */
router.use('*', (req: Request, res: Response, next) => {
  const logger = createRequestLogger(req);
  
  logger.debug('Webhook request received', {
    method: req.method,
    path: req.path,
    query: req.query,
    hasBody: Object.keys(req.body || {}).length > 0,
  });
  
  next();
});

export default router;

