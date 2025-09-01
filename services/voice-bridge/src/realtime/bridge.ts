import WebSocket from 'ws';
import { ENV } from '../utils/env';
import { createWebSocketLogger } from '../utils/logger';
import { createSessionConfig, type SessionContext } from './session';
import { repo } from '../db/repo';
import type { 
  TwilioMediaEvent, 
  TwilioStartEvent, 
  TwilioStopEvent,
  BiomarkerInput 
} from '../types/contracts';

/**
 * Create OpenAI Realtime WebSocket connection
 */
export function createOpenAIRealtimeConnection(): WebSocket {
  const wsUrl = `wss://api.openai.com/v1/realtime?model=${ENV.OPENAI_REALTIME_MODEL}`;
  
  return new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${ENV.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create biomarker sidecar WebSocket connection
 */
export function createBiomarkerConnection(): WebSocket | null {
  try {
    return new WebSocket(ENV.BIOMARKER_WS);
  } catch (error) {
    console.warn('Failed to connect to biomarker service:', error);
    return null;
  }
}

/**
 * Initialize OpenAI Realtime session
 */
export function initializeRealtimeSession(socket: WebSocket, ctx: SessionContext): void {
  const logger = createWebSocketLogger('openai', ctx.chainRunId);
  
  socket.on('open', () => {
    logger.info('OpenAI Realtime connection opened');
    
    // Send session configuration
    const sessionConfig = createSessionConfig(ctx);
    socket.send(JSON.stringify({
      type: 'session.update',
      session: sessionConfig,
    }));
    
    logger.debug('Session configuration sent', { 
      hasTools: sessionConfig.tools.length > 0,
      voice: sessionConfig.voice,
    });
  });
  
  socket.on('error', (error) => {
    logger.error('OpenAI Realtime connection error', { error });
  });
  
  socket.on('close', (code, reason) => {
    logger.info('OpenAI Realtime connection closed', { 
      code, 
      reason: reason.toString() 
    });
  });
}

/**
 * Handle WebSocket bridge between Twilio and OpenAI Realtime
 */
export async function handleTwilioStream(
  twilioWS: WebSocket, 
  request: any
): Promise<void> {
  const logger = createWebSocketLogger('twilio', 'pending-sid');
  
  try {
    // We need to wait for the start message from Twilio to get the call SID
    let ctx: SessionContext | null = null;
    let callSidFromStart: string | null = null;

    logger.info('Waiting for Twilio stream to start');

    // We'll initialize these after we get the context
    let openaiWS: WebSocket | null = null;
    let biomarkerWS: WebSocket | null = null;
    
    // Track session state
    let sessionActive = true;
    let audioFrameCount = 0;
    let lastBiomarkerRisk = 0;

    // Handle Twilio WebSocket messages
    twilioWS.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.event) {
          case 'start':
            // Log the entire start message to debug
            logger.info('Received Twilio start message', { 
              start: message.start,
              customParameters: message.start?.customParameters,
              callSid: message.start?.callSid 
            });
            
            // Extract call SID from start message - Twilio sends it directly in the start object
            callSidFromStart = message.start?.callSid;
            
            if (!callSidFromStart) {
              // Try custom parameters as fallback
              const customParams = message.start?.customParameters;
              if (customParams) {
                // Custom parameters might be an object or array
                if (Array.isArray(customParams)) {
                  const callSidParam = customParams.find(p => p.name === 'callSid');
                  callSidFromStart = callSidParam?.value;
                } else if (customParams.callSid) {
                  callSidFromStart = customParams.callSid;
                }
              }
            }
            
            if (!callSidFromStart) {
              logger.error('No call SID found in start message', { 
                start: message.start,
                customParameters: message.start?.customParameters 
              });
              twilioWS.close(1008, 'No call SID provided');
              return;
            }
            
            // Now resolve the context using the call SID
            ctx = await resolveContextFromCallSid(callSidFromStart);
            if (!ctx) {
              logger.error('Failed to resolve context for call', { callSid: callSidFromStart });
              twilioWS.close(1008, 'Invalid session context');
              return;
            }
            
            logger.info('Context resolved, initializing OpenAI connection', {
              chainRunId: ctx.chainRunId,
              callSid: callSidFromStart,
              patientId: ctx.patient.id,
            });
            
            // Now create and initialize the OpenAI connection
            openaiWS = createOpenAIRealtimeConnection();
            biomarkerWS = createBiomarkerConnection();
            initializeRealtimeSession(openaiWS, ctx);
            
            // Handle OpenAI Realtime responses
            openaiWS.on('message', async (data) => {
              try {
                const message = JSON.parse(data.toString());
                
                switch (message.type) {
                  case 'response.audio.delta':
                    // Forward audio to Twilio
                    if (sessionActive && message.delta) {
                      twilioWS.send(JSON.stringify({
                        event: 'media',
                        media: {
                          payload: message.delta,
                        },
                      }));
                    }
                    break;
                    
                  case 'response.function_call':
                    await handleFunctionCall(message, ctx!, logger);
                    break;
                    
                  case 'error':
                    logger.error('OpenAI Realtime error', { error: message });
                    break;
                    
                  default:
                    logger.debug('OpenAI Realtime message', { type: message.type });
                }
              } catch (error) {
                logger.error('Error processing OpenAI message', { error });
              }
            });
            
            // Handle biomarker responses
            if (biomarkerWS) {
              biomarkerWS.on('message', async (data) => {
                try {
                  const message = JSON.parse(data.toString());
                  
                  if (message.type === 'risk' && message.chainRunId === ctx!.chainRunId) {
                    lastBiomarkerRisk = message.risk;
                    
                    // Update database with risk score
                    if (ctx!.callSid) {
                      await repo.updateCallRisk(ctx!.callSid, message.risk);
                    }
                    
                    // If risk is high, send advisory to OpenAI
                    if (message.risk >= 0.8 && openaiWS) {
                      logger.warn('High biomarker risk detected', { 
                        risk: message.risk,
                        status: message.status 
                      });
                      
                      openaiWS.send(JSON.stringify({
                        type: 'conversation.item.create',
                        item: {
                          type: 'message',
                          role: 'system',
                          content: [{
                            type: 'text',
                            text: `ALERT: Voice biomarker analysis indicates elevated risk (${(message.risk * 100).toFixed(1)}%). Please recheck for red flag symptoms and consider escalation if appropriate.`,
                          }],
                        },
                      }));
                    }
                    
                    logger.debug('Biomarker risk update', { 
                      risk: message.risk, 
                      status: message.status,
                      n: message.n 
                    });
                  }
                } catch (error) {
                  logger.error('Error processing biomarker message', { error });
                }
              });
            }
            
            await handleTwilioStart(message as TwilioStartEvent, ctx, logger);
            break;
            
          case 'media':
            if (openaiWS && ctx) {
              await handleTwilioMedia(
                message as TwilioMediaEvent, 
                openaiWS, 
                biomarkerWS, 
                ctx, 
                logger
              );
              audioFrameCount++;
            }
            break;
            
          case 'stop':
            if (ctx) {
              await handleTwilioStop(message as TwilioStopEvent, ctx, logger);
            }
            sessionActive = false;
            break;
            
          default:
            logger.debug('Unhandled Twilio event', { event: message.event });
        }
      } catch (error) {
        logger.error('Error processing Twilio message', { error });
      }
    });


    // Handle connection cleanup
    const cleanup = () => {
      sessionActive = false;
      
      if (openaiWS && openaiWS.readyState === WebSocket.OPEN) {
        openaiWS.close();
      }
      
      if (biomarkerWS && biomarkerWS.readyState === WebSocket.OPEN) {
        biomarkerWS.close();
      }
      
      logger.info('Session cleanup completed', {
        audioFrameCount,
        lastBiomarkerRisk,
      });
    };

    twilioWS.on('close', cleanup);
    twilioWS.on('error', (error) => {
      logger.error('Twilio WebSocket error', { error });
      cleanup();
    });

  } catch (error) {
    logger.error('Error in Twilio stream handler', { error });
    twilioWS.close(1011, 'Internal server error');
  }
}

/**
 * Handle Twilio stream start event
 */
async function handleTwilioStart(
  message: TwilioStartEvent, 
  _ctx: SessionContext, 
  logger: any
): Promise<void> {
  logger.info('Twilio stream started', {
    streamSid: message.start.streamSid,
    callSid: message.start.callSid,
    tracks: message.start.tracks,
  });

  // Update call status in database
  if (message.start.callSid) {
    try {
      await repo.updateCallStatus(message.start.callSid, 'streaming');
      
      // Log call event
      const call = await repo.getCallByCallSid(message.start.callSid);
      if (call) {
        await repo.logCallEvent(call.id, 'stream_started', {
          streamSid: message.start.streamSid,
          tracks: message.start.tracks,
          mediaFormat: message.start.mediaFormat,
        });
      }
    } catch (error) {
      logger.error('Failed to update call status on stream start', { error });
    }
  }
}

/**
 * Handle Twilio media event (audio data)
 */
async function handleTwilioMedia(
  message: TwilioMediaEvent,
  openaiWS: WebSocket,
  biomarkerWS: WebSocket | null,
  ctx: SessionContext,
  _logger: any
): Promise<void> {
  // Forward audio to OpenAI Realtime
  if (openaiWS.readyState === WebSocket.OPEN && message.media.track === 'inbound') {
    openaiWS.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: message.media.payload,
    }));
  }

  // Forward audio to biomarker service
  if (biomarkerWS && biomarkerWS.readyState === WebSocket.OPEN && message.media.track === 'inbound') {
    const biomarkerMessage: BiomarkerInput = {
      type: 'audio',
      audio: message.media.payload,
      chainRunId: ctx.chainRunId,
      timestamp: new Date().toISOString(),
    };
    
    biomarkerWS.send(JSON.stringify(biomarkerMessage));
  }
}

/**
 * Handle Twilio stream stop event
 */
async function handleTwilioStop(
  message: TwilioStopEvent,
  _ctx: SessionContext,
  logger: any
): Promise<void> {
  logger.info('Twilio stream stopped', {
    callSid: message.stop.callSid,
  });

  // Update call status in database
  if (message.stop.callSid) {
    try {
      await repo.updateCallStatus(message.stop.callSid, 'completed');
      
      // Log call event
      const call = await repo.getCallByCallSid(message.stop.callSid);
      if (call) {
        await repo.logCallEvent(call.id, 'stream_stopped', {
          reason: 'twilio_stop_event',
        });
      }
    } catch (error) {
      logger.error('Failed to update call status on stream stop', { error });
    }
  }
}

/**
 * Handle OpenAI function calls
 */
async function handleFunctionCall(
  message: any,
  ctx: SessionContext,
  logger: any
): Promise<void> {
  logger.info('Handling function call', { 
    name: message.name,
    callId: message.call_id 
  });

  try {
    switch (message.name) {
      case 'return_to_aigents':
        const payload = JSON.parse(message.arguments || '{}');
        await sendResultsToAigents(payload, ctx, logger);
        break;
        
      case 'escalate':
        const escalationData = JSON.parse(message.arguments || '{}');
        await handleEscalation(escalationData, ctx, logger);
        break;
        
      default:
        logger.debug('Function call logged', { 
          name: message.name,
          arguments: message.arguments 
        });
    }

    // Send function call result back to OpenAI
    if (message.call_id) {
      // This would be sent back to OpenAI - implementation depends on the exact API
      logger.debug('Function call completed', { callId: message.call_id });
    }

  } catch (error) {
    logger.error('Error handling function call', { 
      error,
      name: message.name,
      callId: message.call_id 
    });
  }
}

/**
 * Send results back to AIGENTS
 */
async function sendResultsToAigents(
  payload: any,
  ctx: SessionContext,
  logger: any
): Promise<void> {
  try {
    const webhookPayload = {
      chainRunId: ctx.chainRunId,
      agentResponse: payload.payload || payload,
      agentName: 'HF_Voice_Agent',
      currentIsoDateTime: new Date().toISOString(),
    };

    logger.info('Sending results to AIGENTS', {
      callbackUrl: ctx.callbackUrl,
      chainRunId: ctx.chainRunId,
    });

    const response = await fetch(ctx.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    logger.info('Results sent to AIGENTS successfully');

    // Update database
    await repo.updateAutomationLogStatus(
      ctx.chainRunId,
      'completed',
      JSON.stringify(payload.payload || payload)
    );

  } catch (error) {
    logger.error('Failed to send results to AIGENTS', { error });
    throw error;
  }
}

/**
 * Handle escalation requests
 */
async function handleEscalation(
  escalationData: any,
  ctx: SessionContext,
  logger: any
): Promise<void> {
  logger.warn('Escalation requested', {
    level: escalationData.level,
    reason: escalationData.reason,
    urgent: escalationData.urgent,
  });

  // Log escalation event
  if (ctx.callSid) {
    try {
      const call = await repo.getCallByCallSid(ctx.callSid);
      if (call) {
        await repo.logCallEvent(call.id, 'escalation', escalationData);
      }
    } catch (error) {
      logger.error('Failed to log escalation event', { error });
    }
  }

  // Here you would implement actual escalation logic:
  // - Send alerts to healthcare providers
  // - Create urgent tasks in EMR systems
  // - Trigger emergency protocols if needed
}

/**
 * Resolve session context from call SID
 * Retrieves context from database using the call SID
 */
async function resolveContextFromCallSid(callSid: string): Promise<SessionContext | null> {
  const logger = createWebSocketLogger('twilio', callSid);
  
  try {
    logger.debug('Resolving context for call', { callSid });
    
    // Look up the call in the database
    const call = await repo.getCallByCallSid(callSid);
    if (!call) {
      logger.error('Call not found in database', { callSid });
      return null;
    }
    
    // Parse the stored context
    const context = call.context as any;
    if (!context) {
      logger.error('No context stored for call', { callSid });
      return null;
    }
    
    // Return the session context
    const sessionContext: SessionContext = {
      chainRunId: call.chainRunId,
      patient: context.patient,
      callObjective: context.callObjective,
      clinicalContext: context.clinicalContext,
      callbackUrl: call.callbackUrl,
      callSid: callSid
    };
    
    logger.info('Context resolved successfully', { 
      chainRunId: sessionContext.chainRunId,
      callSid 
    });
    
    return sessionContext;
    
  } catch (error) {
    logger.error('Failed to resolve context from call SID', { error, callSid });
    return null;
  }
}

/**
 * Resolve session context from WebSocket request
 * Extracts call SID from URL and retrieves context from database
 */
async function resolveContextFromRequest(request: any): Promise<SessionContext | null> {
  const logger = createWebSocketLogger('twilio', 'context-resolution');
  
  try {
    // Extract call SID from URL query params
    const url = new URL(request.url, `http://${request.headers.host}`);
    const callSid = url.searchParams.get('callSid');
    
    if (!callSid) {
      logger.error('No call SID provided in WebSocket URL');
      return null;
    }
    
    logger.debug('Resolving context for call', { callSid });
    
    // Look up the call in the database
    const call = await repo.getCallByCallSid(callSid);
    if (!call) {
      logger.error('Call not found in database', { callSid });
      return null;
    }
    
    // Parse the stored context
    const context = call.context as any;
    if (!context) {
      logger.error('No context stored for call', { callSid });
      return null;
    }
    
    // Return the session context
    const sessionContext: SessionContext = {
      chainRunId: call.chainRunId,
      patient: context.patient,
      callObjective: context.callObjective,
      clinicalContext: context.clinicalContext,
      callbackUrl: call.callbackUrl,
      callSid: callSid
    };
    
    logger.info('Context resolved successfully', { 
      chainRunId: sessionContext.chainRunId,
      callSid 
    });
    
    return sessionContext;
    
  } catch (error) {
    logger.error('Failed to resolve context from request', { error });
    return null;
  }
}

