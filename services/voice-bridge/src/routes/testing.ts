import { Router, Request, Response } from 'express';
import { repo } from '../db/repo';
import { startTwilioCall } from '../twilio/client';
import { createRequestLogger } from '../utils/logger';
import { ENV } from '../utils/env';
import { z } from 'zod';

export const router = Router();

// Call queue to manage multiple test calls
const callQueue: any[] = [];
let isProcessingQueue = false;

// Test call trigger schema (no auth required for testing)
const TestCallTriggerSchema = z.object({
  // Patient information
  name: z.string().min(1),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
  dob: z.string().optional(),
  mrn: z.string().optional(),
  
  // Medical history
  medicalHistory: z.object({
    bnp: z.number().optional(),
    ejectionFraction: z.number().optional(),
    medications: z.array(z.string()).optional(),
    carePlan: z.string().optional(),
    recentHospitalization: z.boolean().optional(),
    lastTestDate: z.string().optional(),
  }).optional(),
  
  // Custom prompt
  customPrompt: z.string().optional(),
  callObjective: z.string().optional(),
  clinicalContext: z.string().optional(),
  
  // Queue options
  priority: z.enum(['normal', 'high']).default('normal'),
  scheduledTime: z.string().optional(),
});

/**
 * POST /test/trigger-call
 * Trigger a test call without authentication
 */
router.post('/trigger-call', async (req: Request, res: Response) => {
  const logger = createRequestLogger(req);
  
  // Check if test UI is enabled
  if (ENV.NODE_ENV === 'production') {
    return res.status(403).json({ 
      error: 'Test interface is disabled in production' 
    });
  }
  
  try {
    const validation = TestCallTriggerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors,
      });
    }
    
    const data = validation.data;
    const callId = `TEST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create patient object for the call
    const patient = {
      id: `test-${Date.now()}`,
      name: data.name,
      phone: data.phone,
      dob: data.dob || '1960-01-01',
      mrn: data.mrn || `TEST-${Date.now()}`,
      demographics: { sex: 'U', lang: 'en-US' },
      lastTests: data.medicalHistory ? {
        BNP: data.medicalHistory.bnp,
        Echo_EF: data.medicalHistory.ejectionFraction,
        date: data.medicalHistory.lastTestDate || new Date().toISOString().split('T')[0],
      } : undefined,
      medications: data.medicalHistory?.medications,
      carePlan: data.medicalHistory?.carePlan,
    };
    
    // Add to queue
    const queueItem = {
      id: callId,
      patient,
      customPrompt: data.customPrompt,
      callObjective: data.callObjective || 'Test CHF assessment call',
      clinicalContext: data.clinicalContext || 'Testing voice assessment system',
      priority: data.priority,
      scheduledTime: data.scheduledTime,
      status: 'queued',
      queuedAt: new Date().toISOString(),
      callbackUrl: `${ENV.PUBLIC_ORIGIN}/test/callback/${callId}`,
    };
    
    // Add to queue based on priority
    if (data.priority === 'high') {
      callQueue.unshift(queueItem);
    } else {
      callQueue.push(queueItem);
    }
    
    logger.info('Test call queued', { 
      callId, 
      queuePosition: callQueue.length,
      phone: data.phone 
    });
    
    // Process queue if not already processing
    if (!isProcessingQueue) {
      processCallQueue();
    }
    
    return res.json({
      success: true,
      callId,
      queuePosition: callQueue.length,
      estimatedWait: `${callQueue.length * 30} seconds`,
    });
    
  } catch (error) {
    logger.error('Error queuing test call', { error });
    return res.status(500).json({ 
      error: 'Failed to queue call' 
    });
  }
});

/**
 * GET /test/queue
 * Get current call queue status
 */
router.get('/queue', async (_req: Request, res: Response) => {
  return res.json({
    queueLength: callQueue.length,
    isProcessing: isProcessingQueue,
    queue: callQueue.map((item, index) => ({
      position: index + 1,
      id: item.id,
      phone: item.patient.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'),
      status: item.status,
      priority: item.priority,
      queuedAt: item.queuedAt,
    })),
  });
});

/**
 * GET /test/calls
 * Get recent test calls and their results
 */
router.get('/calls', async (_req: Request, res: Response) => {
  try {
    // Get recent test calls from database
    const testCalls = await repo.getCallsByStatus('completed', 20);
    
    return res.json({
      calls: testCalls
        .filter((call: any) => call.chainRunId.startsWith('TEST-'))
        .map((call: any) => ({
          id: call.chainRunId,
          callSid: call.callSid,
          phone: call.phone,
          status: call.status,
          riskScore: call.riskLast ? parseFloat(call.riskLast) : null,
          summary: call.summary,
          createdAt: call.createdAt,
          duration: call.updatedAt && call.createdAt ? 
            Math.floor((new Date(call.updatedAt).getTime() - new Date(call.createdAt).getTime()) / 1000) : null,
        })),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch calls' });
  }
});

/**
 * GET /test/call/:id
 * Get specific call details including transcripts
 */
router.get('/call/:id', async (req: Request, res: Response) => {
  try {
    const callId = req.params.id;
    if (!callId) {
      return res.status(400).json({ error: 'Call ID required' });
    }
    
    const call = await repo.getCallByChainRunId(callId);
    
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Get call events for transcript
    const events = await repo.getCallEvents(call.id);
    
    return res.json({
      call: {
        id: call.chainRunId,
        callSid: call.callSid,
        phone: call.phone,
        status: call.status,
        context: call.context,
        summary: call.summary,
        riskScore: call.riskLast ? parseFloat(call.riskLast) : null,
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
      },
      events: events.map((e: any) => ({
        type: e.eventType,
        data: e.eventData,
        timestamp: e.timestamp,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch call details' });
  }
});

/**
 * DELETE /test/call/:id
 * Cancel a queued call
 */
router.delete('/call/:id', async (req: Request, res: Response) => {
  const index = callQueue.findIndex(item => item.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Call not found in queue' });
  }
  
  callQueue.splice(index, 1);
  
  return res.json({ 
    success: true, 
    message: 'Call removed from queue' 
  });
});

/**
 * Process call queue
 */
async function processCallQueue() {
  if (isProcessingQueue || callQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  while (callQueue.length > 0) {
    const item = callQueue.shift();
    if (!item) break;
    
    try {
      console.log(`Processing call ${item.id} to ${item.patient.phone}`);
      item.status = 'dialing';
      
      // Create database records
      await repo.createAutomationLog({
        chainName: 'Test_CHF_Assessment',
        email: item.patient.id,
        status: 'calling',
        requestData: item,
        uniqueId: item.id,
        chainType: 'test_voice_outreach',
        isCompleted: false,
        ts: new Date(),
      });
      
      const callRecord = await repo.createCall({
        chainRunId: item.id,
        patientId: item.patient.id,
        phone: item.patient.phone,
        status: 'dialing',
        callbackUrl: item.callbackUrl,
        context: {
          patient: item.patient,
          callObjective: item.callObjective,
          clinicalContext: item.clinicalContext,
          customPrompt: item.customPrompt,
          isTest: true,
        },
      });
      
      if (!callRecord) {
        throw new Error('Failed to create call record');
      }
      
      // Initiate Twilio call
      const twimlUrl = `${ENV.PUBLIC_ORIGIN}/twiml`;
      const passThrough = {
        chainRunId: item.id,
        callRecordId: callRecord.id,
      };
      
      const { callSid } = await startTwilioCall({
        to: item.patient.phone,
        twimlWebhookUrl: twimlUrl,
        passThrough,
      });
      
      // Update call record with Twilio SID
      await repo.updateCallSid(callRecord.id, callSid);
      
      item.status = 'connected';
      item.callSid = callSid;
      
      console.log(`Call ${item.id} connected with SID ${callSid}`);
      
      // Wait 30 seconds before next call to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 30000));
      
    } catch (error) {
      console.error(`Failed to process call ${item.id}:`, error);
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }
  
  isProcessingQueue = false;
}

// WebSocket support for real-time updates
export function broadcastQueueUpdate() {
  // This will be called by WebSocket server
  const io = (global as any).io;
  if (io) {
    io.emit('queue:update', {
      queueLength: callQueue.length,
      isProcessing: isProcessingQueue,
      queue: callQueue.slice(0, 10), // Send first 10 items
    });
  }
}

// Export for testing
export const testingRouter = router;
export { callQueue, isProcessingQueue };