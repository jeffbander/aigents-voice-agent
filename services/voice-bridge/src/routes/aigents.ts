import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { repo } from '../db/repo';
import { startTwilioCall } from '../twilio/client';
import { createSessionContext } from '../realtime/session';
import { verifyAigentsHMAC } from '../security/auth';
import { createAigentsRateLimit } from '../security/rate-limit';
import { createRequestLogger } from '../utils/logger';
import { ENV } from '../utils/env';
import {
  AigentsCallTriggerSchema,
  validateRequest,
  safeValidateRequest,
  type AigentsCallTrigger,
  type AigentsCallTriggerResponse,
} from '../types/contracts';

export const router = Router();

// Apply rate limiting and authentication to all AIGENTS routes
router.use(createAigentsRateLimit());
router.use(verifyAigentsHMAC);

/**
 * POST /aigents/call.trigger
 * Trigger an outbound call for heart failure patient outreach
 */
router.post('/call.trigger', async (req: Request, res: Response) => {
  const logger = createRequestLogger(req);
  
  try {
    logger.info('Received AIGENTS call trigger request');

    // Validate request payload
    const validation = safeValidateRequest(AigentsCallTriggerSchema, req.body);
    if (!validation.success) {
      logger.warn('Invalid request payload', { 
        errors: validation.error.errors 
      });
      
      return res.status(400).json({
        ok: false,
        error: 'Invalid request payload',
        message: 'Request validation failed',
        details: validation.error.errors,
      });
    }

    const callData = validation.data;
    
    logger.info('Processing call trigger', {
      chainRunId: callData.chainRunId,
      patientId: callData.patient.id,
      phone: callData.patient.phone,
      agentName: callData.agentName,
    });

    // Create automation log entry
    const automationLog = await repo.createAutomationLog({
      chainName: callData.agentName,
      email: callData.patient.id, // Using patient ID as identifier
      status: 'queued',
      requestData: callData,
      uniqueId: callData.chainRunId,
      chainType: 'voice_outreach',
      isCompleted: false,
      ts: new Date(),
    });

    logger.debug('Created automation log entry', { 
      logId: automationLog.id,
      chainRunId: callData.chainRunId 
    });

    // Create call record
    const callRecord = await repo.createCall({
      chainRunId: callData.chainRunId,
      patientId: callData.patient.id,
      phone: callData.patient.phone,
      status: 'created',
      callbackUrl: callData.callbackUrl,
      context: {
        patient: callData.patient,
        callObjective: callData.callObjective,
        clinicalContext: callData.clinicalContext,
        agentName: callData.agentName,
      },
    });

    logger.debug('Created call record', { 
      callId: callRecord.id,
      chainRunId: callData.chainRunId 
    });

    // Start Twilio call
    try {
      const twilioResult = await startTwilioCall({
        to: callData.patient.phone,
        twimlWebhookUrl: ENV.TWIML_URL,
        statusCallback: `${ENV.PUBLIC_ORIGIN}/twilio-status`,
        passThrough: {
          chainRunId: callData.chainRunId,
          callId: callRecord.id,
          patientId: callData.patient.id,
        },
        timeout: 30,
        machineDetection: true,
      });

      logger.info('Twilio call initiated successfully', {
        callSid: twilioResult.callSid,
        status: twilioResult.status,
        chainRunId: callData.chainRunId,
      });

      // Update call record with Twilio call SID
      await repo.updateCallStatus(twilioResult.callSid, 'dialing');
      
      // Update the call record to include the call SID
      await repo.updateCallStatus(twilioResult.callSid, twilioResult.status);

      // Update automation log
      await repo.updateAutomationLogStatus(
        callData.chainRunId,
        'calling',
        `Call initiated with SID: ${twilioResult.callSid}`
      );

      // Log call event
      await repo.logCallEvent(callRecord.id, 'call_initiated', {
        callSid: twilioResult.callSid,
        twilioStatus: twilioResult.status,
        to: twilioResult.to,
        from: twilioResult.from,
      });

      const response: AigentsCallTriggerResponse = {
        ok: true,
        callSid: twilioResult.callSid,
        message: 'Call initiated successfully',
      };

      logger.info('Call trigger completed successfully', {
        chainRunId: callData.chainRunId,
        callSid: twilioResult.callSid,
      });

      res.status(200).json(response);

    } catch (twilioError) {
      logger.error('Failed to initiate Twilio call', { 
        error: twilioError,
        chainRunId: callData.chainRunId,
      });

      // Update records with failure
      await repo.updateCallStatus('', 'failed');
      await repo.updateAutomationLogStatus(
        callData.chainRunId,
        'failed',
        `Call initiation failed: ${twilioError instanceof Error ? twilioError.message : 'Unknown error'}`
      );

      const response: AigentsCallTriggerResponse = {
        ok: false,
        error: 'Call initiation failed',
        message: twilioError instanceof Error ? twilioError.message : 'Unknown error',
      };

      res.status(500).json(response);
    }

  } catch (error) {
    logger.error('Error processing call trigger', { error });

    const response: AigentsCallTriggerResponse = {
      ok: false,
      error: 'Internal server error',
      message: 'Failed to process call trigger request',
    };

    res.status(500).json(response);
  }
});

/**
 * GET /aigents/status/:chainRunId
 * Get the status of a call by chain run ID
 */
router.get('/status/:chainRunId', async (req: Request, res: Response) => {
  const logger = createRequestLogger(req);
  const { chainRunId } = req.params;

  try {
    logger.info('Fetching call status', { chainRunId });

    // Get automation log
    const automationLog = await repo.getAutomationLogByChainRunId(chainRunId);
    if (!automationLog) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Chain run ID not found',
        chainRunId,
      });
    }

    // Get call record
    const call = await repo.getCallByChainRunId(chainRunId);

    // Get call events if call exists
    let events = [];
    if (call) {
      events = await repo.getCallEvents(call.id);
    }

    const response = {
      chainRunId,
      status: automationLog.status,
      isCompleted: automationLog.isCompleted,
      createdAt: automationLog.createdAt,
      updatedAt: automationLog.agentReceivedAt || automationLog.createdAt,
      call: call ? {
        callSid: call.callSid,
        status: call.status,
        phone: call.phone,
        riskLast: call.riskLast,
        summary: call.summary,
      } : null,
      events: events.map(event => ({
        type: event.eventType,
        data: event.eventData,
        timestamp: event.timestamp,
      })),
    };

    logger.debug('Call status retrieved', { 
      chainRunId,
      status: automationLog.status,
      hasCall: !!call,
      eventCount: events.length,
    });

    res.status(200).json(response);

  } catch (error) {
    logger.error('Error fetching call status', { error, chainRunId });
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch call status',
      chainRunId,
    });
  }
});

/**
 * GET /aigents/health
 * Health check endpoint for AIGENTS integration
 */
router.get('/health', async (req: Request, res: Response) => {
  const logger = createRequestLogger(req);

  try {
    // Check database connectivity
    const dbHealth = await repo.healthCheck();
    
    // Basic service health
    const health = {
      status: dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      database: dbHealth,
      services: {
        twilio: 'unknown', // Could implement Twilio health check
        openai: 'unknown', // Could implement OpenAI health check
        biomarker: 'unknown', // Could implement biomarker service health check
      },
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    
    logger.debug('Health check completed', { 
      status: health.status,
      dbStatus: dbHealth.status,
    });

    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Health check failed', { error });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

