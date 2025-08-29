import 'dotenv/config';

function req(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function opt(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const ENV = {
  // Basic configuration
  NODE_ENV: opt('NODE_ENV', 'development'),
  PORT: parseInt(opt('PORT', '8080'), 10),
  PUBLIC_ORIGIN: req('PUBLIC_ORIGIN'),

  // OpenAI configuration
  OPENAI_API_KEY: req('OPENAI_API_KEY'),
  OPENAI_REALTIME_MODEL: opt('OPENAI_REALTIME_MODEL', 'gpt-realtime'),

  // Twilio configuration
  TWILIO_ACCOUNT_SID: req('TWILIO_ACCOUNT_SID'),
  TWILIO_AUTH_TOKEN: req('TWILIO_AUTH_TOKEN'),
  TWILIO_FROM_NUMBER: req('TWILIO_FROM_NUMBER'),
  TWIML_URL: req('TWIML_URL'),

  // AIGENTS configuration
  AIGENTS_HMAC_SECRET: req('AIGENTS_HMAC_SECRET'),

  // Biomarker sidecar configuration
  BIOMARKER_WS: opt('BIOMARKER_WS', 'ws://127.0.0.1:9091/ingest'),

  // Database configuration
  DATABASE_URL: req('DATABASE_URL'),

  // Optional JWT configuration
  JWT_SECRET: opt('JWT_SECRET', 'default-jwt-secret-change-in-production'),

  // Rate limiting configuration
  RATE_LIMIT_WINDOW_MS: parseInt(opt('RATE_LIMIT_WINDOW_MS', '900000'), 10), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: parseInt(opt('RATE_LIMIT_MAX_REQUESTS', '100'), 10),

  // Development helpers
  get isDevelopment() {
    return this.NODE_ENV === 'development';
  },

  get isProduction() {
    return this.NODE_ENV === 'production';
  },
} as const;

// Validate critical environment variables on startup
export function validateEnvironment(): void {
  const requiredVars = [
    'PUBLIC_ORIGIN',
    'OPENAI_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'TWIML_URL',
    'AIGENTS_HMAC_SECRET',
    'DATABASE_URL',
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  console.log('✅ Environment validation passed');
}

