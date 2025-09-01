import Twilio from 'twilio';
import { ENV } from '../utils/env';
import { logger } from '../utils/logger';

// Initialize Twilio client
export const twilioClient = Twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN);

export interface OutboundCallOptions {
  to: string;
  twimlWebhookUrl?: string;
  statusCallback?: string;
  passThrough?: any;
  timeout?: number;
  machineDetection?: boolean;
}

export interface CallResult {
  callSid: string;
  status: string;
  to: string;
  from: string;
}

/**
 * Start an outbound Twilio call with Media Streams
 */
export async function startTwilioCall(options: OutboundCallOptions): Promise<CallResult> {
  const {
    to,
    twimlWebhookUrl = ENV.TWIML_URL,
    statusCallback,
    passThrough,
    timeout = 30,
    machineDetection = false,
  } = options;

  const callLogger = logger.child({
    component: 'twilio-client',
    to,
    from: ENV.TWILIO_FROM_NUMBER,
  });

  try {
    callLogger.info('Initiating outbound call');

    // Prepare status callback URL with pass-through data
    let statusCallbackUrl = statusCallback || `${ENV.PUBLIC_ORIGIN}/twilio-status`;
    if (passThrough) {
      const encodedData = Buffer.from(JSON.stringify(passThrough)).toString('base64');
      statusCallbackUrl += `?data=${encodeURIComponent(encodedData)}`;
    }

    // Create the call
    const call = await twilioClient.calls.create({
      to,
      from: ENV.TWILIO_FROM_NUMBER,
      url: twimlWebhookUrl,
      timeout,
      
      // Status callback configuration
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'failed'],
      statusCallbackMethod: 'POST',
      
      // Machine detection (optional)
      ...(machineDetection && {
        machineDetection: 'Enable',
        machineDetectionTimeout: 30,
      }),
      
      // Call recording (disabled for privacy)
      record: false,
      
      // Caller ID
      callerId: ENV.TWILIO_FROM_NUMBER,
    });

    const result: CallResult = {
      callSid: call.sid,
      status: call.status,
      to: call.to,
      from: call.from,
    };

    callLogger.info('Outbound call initiated successfully', {
      callSid: call.sid,
      status: call.status,
    });

    return result;
    
  } catch (error) {
    callLogger.error('Failed to initiate outbound call', { error });
    throw new Error(`Failed to start Twilio call: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get call details from Twilio
 */
export async function getCallDetails(callSid: string) {
  const callLogger = logger.child({
    component: 'twilio-client',
    callSid,
  });

  try {
    callLogger.debug('Fetching call details from Twilio');
    
    const call = await twilioClient.calls(callSid).fetch();
    
    return {
      sid: call.sid,
      status: call.status,
      from: call.from,
      to: call.to,
      duration: call.duration,
      startTime: call.startTime,
      endTime: call.endTime,
      price: call.price,
      priceUnit: call.priceUnit,
      direction: call.direction,
      answeredBy: call.answeredBy,
    };
    
  } catch (error) {
    callLogger.error('Failed to fetch call details', { error });
    throw new Error(`Failed to get call details: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Update a call in progress (e.g., to redirect to a new TwiML URL)
 */
export async function updateCall(callSid: string, updates: { url?: string; method?: string; status?: 'canceled' | 'completed' }) {
  const callLogger = logger.child({
    component: 'twilio-client',
    callSid,
  });

  try {
    callLogger.info('Updating call', { updates });
    
    const call = await twilioClient.calls(callSid).update(updates as any);
    
    callLogger.info('Call updated successfully', {
      status: call.status,
    });
    
    return {
      sid: call.sid,
      status: call.status,
    };
    
  } catch (error) {
    callLogger.error('Failed to update call', { error });
    throw new Error(`Failed to update call: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Hang up a call
 */
export async function hangupCall(callSid: string) {
  const callLogger = logger.child({
    component: 'twilio-client',
    callSid,
  });

  try {
    callLogger.info('Hanging up call');
    
    const call = await twilioClient.calls(callSid).update({
      status: 'completed',
    });
    
    callLogger.info('Call hung up successfully');
    
    return {
      sid: call.sid,
      status: call.status,
    };
    
  } catch (error) {
    callLogger.error('Failed to hang up call', { error });
    throw new Error(`Failed to hang up call: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * List recent calls (for debugging/monitoring)
 */
export async function listRecentCalls(limit: number = 20) {
  const callLogger = logger.child({
    component: 'twilio-client',
  });

  try {
    callLogger.debug('Fetching recent calls', { limit });
    
    const calls = await twilioClient.calls.list({
      limit,
    });
    
    return calls.map(call => ({
      sid: call.sid,
      status: call.status,
      from: call.from,
      to: call.to,
      duration: call.duration,
      startTime: call.startTime,
      endTime: call.endTime,
      direction: call.direction,
    }));
    
  } catch (error) {
    callLogger.error('Failed to list recent calls', { error });
    throw new Error(`Failed to list calls: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate phone number format
 */
export function validatePhoneNumber(phone: string): boolean {
  // Basic E.164 format validation
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phone);
}

/**
 * Format phone number to E.164 format
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Add country code if missing (assume US +1)
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  } else {
    return `+${digits}`;
  }
}

/**
 * Check Twilio service health
 */
export async function checkTwilioHealth(): Promise<{ status: 'healthy' | 'unhealthy'; details?: any }> {
  const callLogger = logger.child({
    component: 'twilio-client',
  });

  try {
    // Try to fetch account details as a health check
    const account = await twilioClient.api.accounts(ENV.TWILIO_ACCOUNT_SID).fetch();
    
    callLogger.debug('Twilio health check passed', {
      accountSid: account.sid,
      status: account.status,
    });
    
    return {
      status: 'healthy',
      details: {
        accountSid: account.sid,
        accountStatus: account.status,
        friendlyName: account.friendlyName,
      },
    };
    
  } catch (error) {
    callLogger.error('Twilio health check failed', { error });
    
    return {
      status: 'unhealthy',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

