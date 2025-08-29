# AIGENTS Voice Agent

An AI-powered voice agent system for heart failure patient outreach using OpenAI Realtime API over Twilio Media Streams, with vocal biomarker analysis and HIPAA-compliant architecture.

## Architecture Overview

```
AIGENTS (control plane)
   │  POST /aigents/call.trigger     ┌──────────────┐  WS (g711 μ-law 8k)
   ├────────────────────────────────►│ Voice Bridge │◄─────────────────── Twilio Media Streams
   │   (patient context, intent)     │  (Node/TS)   │
   │                                  └─────┬───────┘
   │        POST /webhook/agents            │
   ◄─────────────────────────────────────────┘
            (structured results)            │
                                           WS (audio frames)
                                           ▼
                                   Biomarker Sidecar (Python)
                                        (eGeMAPS + drift)
                                           ▲
                                           │
                                OpenAI Realtime Session (LLM+STT+TTS)
                                     (tools + system prompt)
```

## Features

- **Real-time Voice Processing**: OpenAI Realtime API for natural conversation
- **Telephony Integration**: Twilio Media Streams for PSTN connectivity
- **Vocal Biomarkers**: Python-based audio analysis for health monitoring
- **HIPAA Compliance**: Secure architecture with minimal PHI exposure
- **Scalable Deployment**: Docker containers with Cloud Run support
- **Heart Failure Focus**: Specialized prompts and tools for HF patient care

## Tech Stack

- **Runtime**: Node.js 20 (TypeScript) for Voice Bridge
- **AI/Voice**: OpenAI Realtime API (gpt-realtime model)
- **Telephony**: Twilio Programmable Voice Media Streams
- **Database**: Neon Postgres (dev), Cloud SQL Postgres (prod)
- **ORM**: Drizzle ORM with migrations
- **Biomarkers**: Python with librosa, scikit-learn, openSMILE
- **Security**: Helmet, CORS, rate limiting, signature verification
- **Deployment**: Docker, Cloud Run, Secret Manager

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- Docker and Docker Compose
- Twilio account with phone number
- OpenAI API key with Realtime access
- Neon Postgres database (or local PostgreSQL)

### Environment Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd aigents-voice-agent
   ```

2. **Copy environment files**:
   ```bash
   cp services/voice-bridge/.env.example services/voice-bridge/.env
   ```

3. **Configure environment variables** in `services/voice-bridge/.env`:
   ```env
   # OpenAI Configuration
   OPENAI_API_KEY=sk-your-openai-api-key
   OPENAI_REALTIME_MODEL=gpt-realtime

   # Twilio Configuration
   TWILIO_ACCOUNT_SID=ACyour-twilio-account-sid
   TWILIO_AUTH_TOKEN=your-twilio-auth-token
   TWILIO_FROM_NUMBER=+1your-twilio-phone-number
   
   # Public URL (use ngrok for development)
   PUBLIC_ORIGIN=https://your-ngrok-url.ngrok.io
   TWIML_URL=https://your-ngrok-url.ngrok.io/twiml

   # Database
   DATABASE_URL=postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
   
   # Security
   AIGENTS_HMAC_SECRET=your-secure-secret-key
   ```

### Development Setup

1. **Install dependencies**:
   ```bash
   # Voice Bridge
   cd services/voice-bridge
   npm install
   
   # Biomarker Service
   cd ../../packages/biomarker-service
   pip install -r requirements.txt
   ```

2. **Set up database**:
   ```bash
   cd services/voice-bridge
   npm run db:push
   ```

3. **Start services with Docker Compose**:
   ```bash
   docker-compose up --build
   ```

4. **Or start services individually**:
   ```bash
   # Terminal 1: Voice Bridge
   cd services/voice-bridge
   npm run dev
   
   # Terminal 2: Biomarker Service
   cd packages/biomarker-service
   python biomarker_service.py
   ```

5. **Expose public URL** (for Twilio webhooks):
   ```bash
   ngrok http 8080
   ```

### Testing the System

1. **Health Check**:
   ```bash
   curl http://localhost:8080/healthz
   ```

2. **Trigger a Test Call**:
   ```bash
   curl -X POST http://localhost:8080/aigents/call.trigger \
     -H 'Content-Type: application/json' \
     -H 'X-Aigents-Signature: sha256=<computed-hmac>' \
     -d '{
       "chainRunId": "test-123",
       "agentName": "HF_Test_Agent",
       "patient": {
         "id": "pt-test",
         "name": "Test Patient",
         "phone": "+15555551234",
         "dob": "1970-01-01",
         "mrn": "TEST-001"
       },
       "callObjective": "Test call functionality",
       "callbackUrl": "http://localhost:8080/webhook/test"
     }'
   ```

## API Documentation

### AIGENTS Integration

#### POST `/aigents/call.trigger`
Trigger an outbound call for patient outreach.

**Authentication**: HMAC signature in `X-Aigents-Signature` header.

**Request**:
```json
{
  "chainRunId": "RUN-abc123",
  "agentName": "HF_Outreach_1", 
  "patient": {
    "id": "pt-789",
    "name": "Jamie Rivera",
    "phone": "+15555551212",
    "dob": "1961-05-02",
    "mrn": "MRN-00042"
  },
  "callObjective": "HF symptom check + voice tasks",
  "clinicalContext": "Recent SOB on exertion",
  "callbackUrl": "https://your-app/webhook/agents"
}
```

**Response**:
```json
{
  "ok": true,
  "callSid": "CA1234567890abcdef",
  "message": "Call initiated successfully"
}
```

#### POST `/webhook/agents`
Receive structured results from the voice agent.

**Request**:
```json
{
  "chainRunId": "RUN-abc123",
  "agentResponse": {
    "summary": ["Patient reports mild dyspnea on exertion", "No chest pain or palpitations"],
    "recommendation": "Continue current medications, follow up in 1 week",
    "red_flags": false,
    "biomarker": {
      "risk": 0.34,
      "status": "ok",
      "n": 27
    }
  },
  "agentName": "HF_Voice_Agent",
  "currentIsoDateTime": "2025-08-29T15:04:05Z"
}
```

### Voice Agent Capabilities

The voice agent is equipped with specialized tools for heart failure assessment:

- **Symptom Assessment**: Dyspnea, orthopnea, edema, weight changes
- **Voice Tasks**: Sustained phonation, counting, sentence reading
- **Safety Screening**: Red flag detection and escalation
- **Patient Education**: HF management topics
- **Risk Scoring**: Real-time vocal biomarker analysis

## Deployment

### Google Cloud Run

1. **Build and deploy Voice Bridge**:
   ```bash
   cd services/voice-bridge
   gcloud run deploy voice-bridge \
     --source . \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars NODE_ENV=production
   ```

2. **Build and deploy Biomarker Service**:
   ```bash
   cd packages/biomarker-service
   gcloud run deploy biomarker-service \
     --source . \
     --region us-central1 \
     --allow-unauthenticated
   ```

3. **Configure secrets** in Google Secret Manager:
   ```bash
   gcloud secrets create openai-api-key --data-file=<(echo -n "$OPENAI_API_KEY")
   gcloud secrets create twilio-auth-token --data-file=<(echo -n "$TWILIO_AUTH_TOKEN")
   ```

### Security Considerations

- **Transport Security**: HTTPS/WSS everywhere, TLS 1.2+
- **Authentication**: HMAC signatures, Twilio signature verification
- **Rate Limiting**: IP-based and endpoint-specific limits
- **Input Validation**: Zod schemas for all API inputs
- **Secrets Management**: Environment variables, Secret Manager
- **Audit Logging**: Structured logs with correlation IDs
- **Data Minimization**: Limited PHI storage and transmission

## Monitoring and Observability

- **Health Checks**: `/healthz` endpoints for all services
- **Structured Logging**: Pino with correlation IDs
- **Metrics**: Call success rates, biomarker processing times
- **Alerts**: High-risk biomarker scores, system failures
- **Tracing**: Request flows across services

## Development

### Project Structure

```
├── services/
│   └── voice-bridge/           # Main Node.js service
│       ├── src/
│       │   ├── routes/         # API endpoints
│       │   ├── twilio/         # Twilio integration
│       │   ├── realtime/       # OpenAI Realtime API
│       │   ├── security/       # Authentication & rate limiting
│       │   ├── db/            # Database schema & queries
│       │   └── utils/         # Utilities & configuration
│       └── Dockerfile
├── packages/
│   └── biomarker-service/      # Python biomarker analysis
│       ├── biomarker_service.py
│       ├── requirements.txt
│       └── Dockerfile
├── docker-compose.yml
├── MANUS-CONTEXT.md           # Development context
└── README.md
```

### Contributing

1. **Code Style**: Use Prettier for TypeScript, Black for Python
2. **Testing**: Add tests for new features and bug fixes
3. **Documentation**: Update README and API docs
4. **Security**: Follow HIPAA compliance guidelines
5. **Performance**: Monitor call latency and biomarker processing

## Troubleshooting

### Common Issues

1. **Twilio Webhook Failures**:
   - Verify ngrok URL is accessible
   - Check Twilio signature verification
   - Ensure proper TwiML response format

2. **OpenAI Realtime Connection Issues**:
   - Verify API key and model access
   - Check WebSocket connection stability
   - Monitor rate limits and quotas

3. **Biomarker Service Errors**:
   - Check Python dependencies installation
   - Verify audio decoding (μ-law format)
   - Monitor memory usage for large audio buffers

4. **Database Connection Problems**:
   - Verify Neon connection string
   - Check SSL requirements
   - Run database migrations

### Logs and Debugging

- **Voice Bridge Logs**: `docker-compose logs voice-bridge`
- **Biomarker Logs**: `docker-compose logs biomarker-service`
- **Database Queries**: Enable Drizzle debug mode
- **WebSocket Traffic**: Use browser dev tools or wscat

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- Check the troubleshooting section
- Review logs for error details
- Open GitHub issues for bugs
- Contact the development team for urgent issues

