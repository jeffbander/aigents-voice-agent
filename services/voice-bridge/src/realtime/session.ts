import { ENV } from '../utils/env';
import { logger } from '../utils/logger';
import type { Patient } from '../types/contracts';

export interface SessionContext {
  chainRunId: string;
  patient: Patient;
  callObjective: string;
  clinicalContext?: string;
  callbackUrl: string;
  callSid?: string;
}

/**
 * Build the system prompt for the OpenAI Realtime session
 */
export function buildSystemPrompt(ctx: SessionContext): string {
  const { patient, callObjective, clinicalContext } = ctx;
  
  return `You are a virtual heart-failure nurse assistant on a telephone call.

Patient Information (keep PHI minimal in speech):
- Name: ${patient.name}
- Language: ${patient.demographics?.lang || 'en-US'}
- Date of Birth: ${patient.dob}
- MRN: ${patient.mrn}
- Insurance: ${patient.insurance || 'Not specified'}
- Care Plan: ${patient.carePlan || 'Standard heart failure management'}

Clinical Context: ${clinicalContext || 'Routine heart failure follow-up'}
Call Objective: ${callObjective}

Your Goals:
1) Triage heart failure symptoms systematically:
   - Dyspnea (shortness of breath): none, on exertion, at rest
   - Orthopnea (difficulty breathing when lying flat)
   - Edema (swelling): none, mild, moderate, severe
   - Weight gain: ask about recent weight changes, especially >2-3 lbs in 24h
   - Chest pain or discomfort
   - Palpitations or irregular heartbeat
   - Cough, especially at night
   - Fatigue level: none, mild, moderate, severe

2) Conduct 3 voice tasks for biomarker analysis (explain these are for voice health monitoring):
   - Sustained "ah" sound for at least 3 seconds (repeat 3 times)
   - Count from 1 to 30 clearly
   - Read this sentence: "The rainbow is in the sky"

3) Safety screening - IMMEDIATELY escalate if patient reports:
   - Chest pain or pressure
   - Syncope (fainting) or near-syncope
   - Severe shortness of breath at rest
   - Rapid weight gain ≥2-3 lbs in 24 hours
   - New confusion or altered mental status
   - Severe fatigue preventing daily activities

4) Provide appropriate education based on findings
5) Summarize findings and call finalize_summary tool
6) Use return_to_aigents tool to send structured results

Communication Style:
- Warm, professional, and empathetic
- Speak in 1-2 sentences at a time
- Use simple, clear language
- NEVER diagnose or provide medical advice
- Minimize PHI in speech and logs
- If patient seems distressed, provide reassurance and appropriate escalation

Remember: You are conducting a structured assessment, not providing treatment. Always defer medical decisions to the healthcare team.`;
}

/**
 * Define the tools available to the OpenAI Realtime session
 */
export const realtimeTools = [
  {
    name: 'log_symptom',
    description: 'Record heart failure symptoms reported by the patient',
    parameters: {
      type: 'object',
      properties: {
        dyspnea: {
          type: 'string',
          enum: ['none', 'exertion', 'rest'],
          description: 'Shortness of breath: none, on exertion only, or at rest',
        },
        orthopnea: {
          type: 'boolean',
          description: 'Difficulty breathing when lying flat',
        },
        edema: {
          type: 'string',
          enum: ['none', 'mild', 'moderate', 'severe'],
          description: 'Swelling in legs, ankles, or feet',
        },
        weightGainLb24h: {
          type: 'number',
          description: 'Weight gain in pounds over the last 24 hours',
        },
        chestPain: {
          type: 'boolean',
          description: 'Chest pain or discomfort',
        },
        palpitations: {
          type: 'boolean',
          description: 'Irregular heartbeat or palpitations',
        },
        fatigue: {
          type: 'string',
          enum: ['none', 'mild', 'moderate', 'severe'],
          description: 'Level of fatigue or tiredness',
        },
        cough: {
          type: 'boolean',
          description: 'Persistent cough, especially at night',
        },
        notes: {
          type: 'string',
          description: 'Additional symptom details or patient comments',
        },
      },
      required: [],
    },
  },
  {
    name: 'run_voice_task',
    description: 'Guide the patient through a voice task for biomarker analysis',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: ['sustained_ah', 'count_1_30', 'fixed_sentence'],
          description: 'Type of voice task to perform',
        },
        repeats: {
          type: 'number',
          default: 1,
          description: 'Number of times to repeat the task',
        },
        completed: {
          type: 'boolean',
          description: 'Whether the patient successfully completed the task',
        },
        notes: {
          type: 'string',
          description: 'Notes about task performance or patient response',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'escalate',
    description: 'Escalate to healthcare provider for urgent issues',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['nurse', 'emergent'],
          description: 'Level of escalation needed',
        },
        reason: {
          type: 'string',
          description: 'Reason for escalation',
        },
        symptoms: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of concerning symptoms',
        },
        urgent: {
          type: 'boolean',
          description: 'Whether this requires immediate attention',
        },
      },
      required: ['level', 'reason'],
    },
  },
  {
    name: 'provide_education',
    description: 'Provide heart failure education to the patient',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['daily_weights', 'medication_adherence', 'diet_sodium', 'fluid_restriction', 'activity_guidelines', 'symptom_monitoring'],
          description: 'Education topic to cover',
        },
        keyPoints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key educational points shared',
        },
        patientUnderstanding: {
          type: 'string',
          enum: ['good', 'fair', 'poor'],
          description: 'Patient\'s apparent understanding of the education',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'finalize_summary',
    description: 'Create final summary of the call before ending',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'array',
          items: { type: 'string' },
          description: 'Five key bullet points summarizing the call',
        },
        recommendation: {
          type: 'string',
          description: 'Next steps or recommendations for the patient',
        },
        redFlags: {
          type: 'boolean',
          description: 'Whether any red flag symptoms were identified',
        },
        followUpNeeded: {
          type: 'string',
          enum: ['none', '24h', '48h', '1week', 'urgent'],
          description: 'Recommended follow-up timeframe',
        },
      },
      required: ['summary', 'recommendation', 'redFlags'],
    },
  },
  {
    name: 'return_to_aigents',
    description: 'Send structured results back to AIGENTS system',
    parameters: {
      type: 'object',
      properties: {
        chainRunId: {
          type: 'string',
          description: 'The chain run ID for this call',
        },
        payload: {
          type: 'object',
          description: 'Structured payload with call results',
          properties: {
            summary: {
              type: 'array',
              items: { type: 'string' },
              description: 'Five bullet point summary',
            },
            recommendation: {
              type: 'string',
              description: 'Clinical recommendation',
            },
            red_flags: {
              type: 'boolean',
              description: 'Whether red flags were identified',
            },
            symptoms: {
              type: 'object',
              description: 'Documented symptoms',
            },
            voice_tasks_completed: {
              type: 'number',
              description: 'Number of voice tasks completed',
            },
            escalation: {
              type: 'object',
              description: 'Escalation details if applicable',
            },
            education_provided: {
              type: 'array',
              items: { type: 'string' },
              description: 'Education topics covered',
            },
          },
          required: ['summary', 'recommendation', 'red_flags'],
        },
      },
      required: ['chainRunId', 'payload'],
    },
  },
];

/**
 * Create session configuration for OpenAI Realtime
 */
export function createSessionConfig(ctx: SessionContext) {
  const sessionLogger = logger.child({
    component: 'realtime-session',
    chainRunId: ctx.chainRunId,
    callSid: ctx.callSid,
  });

  sessionLogger.info('Creating OpenAI Realtime session configuration');

  return {
    instructions: buildSystemPrompt(ctx),
    tools: realtimeTools,
    
    // Audio configuration for telephony (μ-law 8kHz)
    input_audio_format: {
      type: 'g711_ulaw',
      sample_rate_hz: 8000,
    },
    output_audio_format: {
      type: 'g711_ulaw', 
      sample_rate_hz: 8000,
    },
    
    // Voice configuration
    voice: 'alloy', // Professional, clear voice
    
    // Turn detection configuration
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 800,
    },
    
    // Tool choice configuration
    tool_choice: 'auto',
    
    // Temperature for response generation
    temperature: 0.7,
    
    // Max response tokens
    max_response_output_tokens: 4096,
  };
}

/**
 * Validate session context
 */
export function validateSessionContext(ctx: any): ctx is SessionContext {
  return (
    typeof ctx === 'object' &&
    typeof ctx.chainRunId === 'string' &&
    typeof ctx.patient === 'object' &&
    typeof ctx.callObjective === 'string' &&
    typeof ctx.callbackUrl === 'string'
  );
}

/**
 * Create a session context from AIGENTS call data
 */
export function createSessionContext(
  chainRunId: string,
  patient: Patient,
  callObjective: string,
  callbackUrl: string,
  clinicalContext?: string,
  callSid?: string
): SessionContext {
  return {
    chainRunId,
    patient,
    callObjective,
    clinicalContext,
    callbackUrl,
    callSid,
  };
}

