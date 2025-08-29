import { z } from 'zod';

// Patient data schema
export const PatientSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().regex(/^\+\d{10,15}$/, 'Invalid phone number format'),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  mrn: z.string(),
  insurance: z.string().optional(),
  demographics: z.object({
    sex: z.enum(['M', 'F', 'O']).optional(),
    lang: z.string().default('en-US'),
  }).optional(),
  notes: z.string().optional(),
  lastTests: z.object({
    BNP: z.number().optional(),
    Echo_EF: z.number().optional(),
    date: z.string().optional(),
  }).optional(),
  carePlan: z.string().optional(),
});

// AIGENTS call trigger request schema
export const AigentsCallTriggerSchema = z.object({
  chainRunId: z.string().min(1, 'Chain run ID is required'),
  agentName: z.string().min(1, 'Agent name is required'),
  patient: PatientSchema,
  callObjective: z.string().min(1, 'Call objective is required'),
  clinicalContext: z.string().optional(),
  callbackUrl: z.string().url('Invalid callback URL'),
});

// AIGENTS call trigger response schema
export const AigentsCallTriggerResponseSchema = z.object({
  ok: z.boolean(),
  callSid: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// Agent response payload schema (sent back to AIGENTS)
export const AgentResponsePayloadSchema = z.object({
  summary: z.array(z.string()).min(1, 'Summary must have at least one item'),
  recommendation: z.string(),
  red_flags: z.boolean(),
  biomarker: z.object({
    risk: z.number().min(0).max(1),
    status: z.enum(['ok', 'warming_up', 'error']),
    n: z.number().int().min(0),
  }).optional(),
  transcript_snippets: z.array(z.string()).optional(),
  symptoms: z.object({
    dyspnea: z.enum(['none', 'exertion', 'rest']).optional(),
    orthopnea: z.boolean().optional(),
    edema: z.enum(['none', 'mild', 'moderate', 'severe']).optional(),
    weightGainLb24h: z.number().optional(),
    chestPain: z.boolean().optional(),
    palpitations: z.boolean().optional(),
    fatigue: z.enum(['none', 'mild', 'moderate', 'severe']).optional(),
  }).optional(),
  escalation: z.object({
    level: z.enum(['none', 'nurse', 'emergent']),
    reason: z.string().optional(),
  }).optional(),
});

// AIGENTS webhook request schema (our response back to AIGENTS)
export const AigentsWebhookRequestSchema = z.object({
  chainRunId: z.string().min(1),
  agentResponse: AgentResponsePayloadSchema,
  agentName: z.string().min(1),
  currentIsoDateTime: z.string().datetime(),
});

// AIGENTS webhook response schema
export const AigentsWebhookResponseSchema = z.object({
  message: z.string(),
  chainRunId: z.string(),
  status: z.enum(['success', 'error']),
  error: z.string().optional(),
});

// Twilio Media Stream event schemas
export const TwilioMediaEventSchema = z.object({
  event: z.literal('media'),
  sequenceNumber: z.string(),
  media: z.object({
    track: z.enum(['inbound', 'outbound']),
    chunk: z.string(),
    timestamp: z.string(),
    payload: z.string(), // Base64 encoded audio
  }),
  streamSid: z.string(),
});

export const TwilioStartEventSchema = z.object({
  event: z.literal('start'),
  sequenceNumber: z.string(),
  start: z.object({
    streamSid: z.string(),
    accountSid: z.string(),
    callSid: z.string(),
    tracks: z.array(z.enum(['inbound', 'outbound'])),
    mediaFormat: z.object({
      encoding: z.string(),
      sampleRate: z.number(),
      channels: z.number(),
    }),
  }),
  streamSid: z.string(),
});

export const TwilioStopEventSchema = z.object({
  event: z.literal('stop'),
  sequenceNumber: z.string(),
  stop: z.object({
    accountSid: z.string(),
    callSid: z.string(),
  }),
  streamSid: z.string(),
});

// OpenAI Realtime message schemas
export const OpenAIRealtimeInputAudioSchema = z.object({
  type: z.literal('input_audio_buffer.append'),
  audio: z.string(), // Base64 encoded audio
});

export const OpenAIRealtimeResponseSchema = z.object({
  type: z.string(),
  response_id: z.string().optional(),
  item_id: z.string().optional(),
  output_index: z.number().optional(),
  content_index: z.number().optional(),
  delta: z.string().optional(), // Base64 encoded audio delta
});

// Biomarker WebSocket message schemas
export const BiomarkerInputSchema = z.object({
  type: z.literal('audio'),
  audio: z.string(), // Base64 encoded μ-law audio
  chainRunId: z.string(),
  timestamp: z.string().optional(),
});

export const BiomarkerOutputSchema = z.object({
  type: z.literal('risk'),
  risk: z.number().min(0).max(1),
  status: z.enum(['ok', 'warming_up', 'error']),
  n: z.number().int().min(0),
  chainRunId: z.string(),
  timestamp: z.string().optional(),
  features: z.record(z.number()).optional(), // Optional feature vector
});

// Health check schema
export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  timestamp: z.string(),
  version: z.string().optional(),
  database: z.object({
    status: z.enum(['healthy', 'unhealthy']),
    latency: z.number().optional(),
  }).optional(),
  services: z.object({
    openai: z.enum(['healthy', 'unhealthy']).optional(),
    twilio: z.enum(['healthy', 'unhealthy']).optional(),
    biomarker: z.enum(['healthy', 'unhealthy']).optional(),
  }).optional(),
});

// Error response schema
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.any().optional(),
  timestamp: z.string().optional(),
  requestId: z.string().optional(),
});

// Export types inferred from schemas
export type Patient = z.infer<typeof PatientSchema>;
export type AigentsCallTrigger = z.infer<typeof AigentsCallTriggerSchema>;
export type AigentsCallTriggerResponse = z.infer<typeof AigentsCallTriggerResponseSchema>;
export type AgentResponsePayload = z.infer<typeof AgentResponsePayloadSchema>;
export type AigentsWebhookRequest = z.infer<typeof AigentsWebhookRequestSchema>;
export type AigentsWebhookResponse = z.infer<typeof AigentsWebhookResponseSchema>;
export type TwilioMediaEvent = z.infer<typeof TwilioMediaEventSchema>;
export type TwilioStartEvent = z.infer<typeof TwilioStartEventSchema>;
export type TwilioStopEvent = z.infer<typeof TwilioStopEventSchema>;
export type OpenAIRealtimeInput = z.infer<typeof OpenAIRealtimeInputAudioSchema>;
export type OpenAIRealtimeResponse = z.infer<typeof OpenAIRealtimeResponseSchema>;
export type BiomarkerInput = z.infer<typeof BiomarkerInputSchema>;
export type BiomarkerOutput = z.infer<typeof BiomarkerOutputSchema>;
export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Validation helper functions
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

export function safeValidateRequest<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}

