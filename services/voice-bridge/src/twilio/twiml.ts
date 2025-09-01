import { Request, Response } from 'express';
import twilio from 'twilio';
import { createRequestLogger } from '../utils/logger';
import { repo } from '../db/repo';

/**
 * TwiML handler that responds to incoming Twilio voice webhooks
 * This sets up Media Streams for real-time audio processing
 */
export async function twimlHandler(req: Request, res: Response): Promise<void> {
  const logger = createRequestLogger(req);
  
  try {
    logger.info('Handling TwiML request', {
      callSid: req.body.CallSid,
      from: req.body.From,
      to: req.body.To,
      callStatus: req.body.CallStatus,
    });

    // Create TwiML response
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Start Media Streams for real-time audio processing
    const start = twiml.start();
    
    // Create stream with parameters - Twilio will pass these as custom parameters
    const stream = start.stream({
      url: `wss://${req.get('host')}/twilio-stream`,
      track: 'both_tracks', // Capture both inbound and outbound audio
    });
    
    // Add custom parameters that Twilio will pass in the WebSocket connection
    stream.parameter({ name: 'callSid', value: req.body.CallSid });
    
    // Provide initial greeting while WebSocket connection establishes
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US',
    }, 'Hi, connecting you to your care assistant. Please hold on for just a moment.');
    
    // Add a pause to allow the WebSocket connection to establish
    // and the OpenAI Realtime session to initialize
    twiml.pause({ length: 2 });
    
    // Add another message to keep the call active
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US',
    }, 'Thank you for your patience. Your care assistant is now ready to speak with you.');
    
    // Keep the call open for up to 15 minutes (900 seconds)
    // The actual conversation will be handled via Media Streams
    twiml.pause({ length: 900 });
    
    // If we reach this point, the call has timed out
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US',
    }, 'Thank you for calling. This session has ended. Goodbye.');
    
    twiml.hangup();

    // Update call status in database if we have the call SID
    if (req.body.CallSid) {
      try {
        await repo.updateCallStatus(req.body.CallSid, 'connected');
        logger.debug('Updated call status to connected', { callSid: req.body.CallSid });
      } catch (dbError) {
        logger.error('Failed to update call status', { error: dbError, callSid: req.body.CallSid });
      }
    }

    // Send TwiML response
    res.type('text/xml');
    res.send(twiml.toString());
    
    logger.info('TwiML response sent successfully', { 
      callSid: req.body.CallSid,
      twimlLength: twiml.toString().length,
    });
    
  } catch (error) {
    logger.error('Error handling TwiML request', { error });
    
    // Send error TwiML response
    const errorTwiml = new twilio.twiml.VoiceResponse();
    errorTwiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US',
    }, 'I apologize, but there was a technical issue. Please try calling again later. Goodbye.');
    errorTwiml.hangup();
    
    res.type('text/xml');
    res.status(500).send(errorTwiml.toString());
  }
}

/**
 * Handle Twilio status callbacks
 * This tracks the lifecycle of outbound calls
 */
export async function twilioStatusHandler(req: Request, res: Response): Promise<void> {
  const logger = createRequestLogger(req);
  
  try {
    const {
      CallSid,
      CallStatus,
      From,
      To,
      Duration,
      CallDuration,
    } = req.body;

    // Extract pass-through data if present
    let passThrough = null;
    try {
      const dataParam = req.query.data as string;
      if (dataParam) {
        passThrough = JSON.parse(Buffer.from(dataParam, 'base64').toString('utf8'));
      }
    } catch (parseError) {
      logger.warn('Failed to parse pass-through data', { error: parseError });
    }

    logger.info('Received Twilio status callback', {
      callSid: CallSid,
      status: CallStatus,
      from: From,
      to: To,
      duration: Duration,
      callDuration: CallDuration,
      passThrough,
    });

    // Update call status in database
    if (CallSid) {
      try {
        await repo.updateCallStatus(CallSid, CallStatus);
        
        // Log call event
        const call = await repo.getCallByCallSid(CallSid);
        if (call) {
          await repo.logCallEvent(call.id, `status_${CallStatus}`, {
            from: From,
            to: To,
            duration: Duration,
            callDuration: CallDuration,
            passThrough,
          });
        }
        
        logger.debug('Updated call status in database', { 
          callSid: CallSid, 
          status: CallStatus 
        });
      } catch (dbError) {
        logger.error('Failed to update call status in database', { 
          error: dbError, 
          callSid: CallSid 
        });
      }
    }

    // Send success response to Twilio
    res.status(200).json({ 
      message: 'Status callback received',
      callSid: CallSid,
      status: CallStatus,
    });
    
  } catch (error) {
    logger.error('Error handling Twilio status callback', { error });
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to process status callback',
    });
  }
}

/**
 * Handle incoming calls (if we want to accept inbound calls)
 */
export async function incomingCallHandler(req: Request, res: Response): Promise<void> {
  const logger = createRequestLogger(req);
  
  try {
    const { CallSid, From, To } = req.body;
    
    logger.info('Handling incoming call', {
      callSid: CallSid,
      from: From,
      to: To,
    });

    // For now, we'll reject incoming calls with a polite message
    // In the future, this could be enhanced to handle patient-initiated calls
    const twiml = new twilio.twiml.VoiceResponse();
    
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US',
    }, 'Thank you for calling. This number is currently used for outbound patient care calls only. Please contact your healthcare provider directly for assistance. Goodbye.');
    
    twiml.hangup();

    res.type('text/xml');
    res.send(twiml.toString());
    
    logger.info('Incoming call handled with rejection message', { callSid: CallSid });
    
  } catch (error) {
    logger.error('Error handling incoming call', { error });
    
    const errorTwiml = new twilio.twiml.VoiceResponse();
    errorTwiml.say('We apologize, but we cannot take your call at this time. Goodbye.');
    errorTwiml.hangup();
    
    res.type('text/xml');
    res.status(500).send(errorTwiml.toString());
  }
}

