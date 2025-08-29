# CLAUDE.md

**Project:** AIGENTS-integrated voice agent for heart-failure outreach using **OpenAI Realtime** (telephony voice model) over **Twilio Media Streams** (or OpenAI **Realtime SIP**), with a **Neon Postgres** database for dev/test and **Google Cloud** (Cloud Run + Cloud SQL Postgres) for production. Includes a sidecar **vocal-biomarker** pipeline.

> This document is the build spec for Claude/CoPilot/your editor. It contains the target stack, security rules, API contracts, and copy‑pasteable scaffolds so we can implement quickly and safely.

---

## 0) High-Level Architecture

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

**Control flow:**

1. AIGENTS posts a job (patient context + call objective) ⇒ `/aigents/call.trigger`.
2. Voice Bridge dials via Twilio and upgrades to Media Streams. (Swap to **Realtime SIP** later if enabled.)
3. The bridge opens an OpenAI Realtime session with instructions + tools; forwards caller audio; streams synthesized audio back.
4. Audio is also mirrored to the biomarker sidecar for risk scoring (within‑patient drift).
5. The agent summarizes & returns structured results back to AIGENTS via `/webhook/agents`.

---

## 1) Tech Stack

* **Runtime:** Node.js 20 (TypeScript) for the Voice Bridge.
* **Telephony:** Twilio Programmable Voice **Media Streams** (μ‑law 8k). (Drop‑in option: OpenAI **Realtime SIP** when available.)
* **LLM + Voice:** OpenAI **Realtime** voice model (`gpt-realtime` or your current realtime model). Audio in/out, tool calling, turn detection.
* **Biomarkers:** Python sidecar (openSMILE eGeMAPS + IsolationForest drift) via WebSocket.
* **Database:**

  * Dev/Test: **Neon Postgres** (serverless, free tier).
  * Prod: **Cloud SQL for Postgres** (Private IP, VPC‑SC recommended).
* **ORM/Migrations:** **drizzle-orm** + **drizzle-kit**.
* **Security libs:** `helmet`, `cors`, `rate-limiter-flexible`, `zod`, `twilio` (signature verify), `jsonwebtoken` (optional), `argon2` (if needed), `pino` for logs.
* **Deployment:**

  * Dev: local w/ `ngrok` or Cloud Run dev service.
  * Prod: **Cloud Run** (WebSocket supported), **Secret Manager**, **Cloud Build** or GitHub Actions.

---

## 2) Repository Layout

```
/ (monorepo or single service)
├─ packages/
│  └─ biomarker-service/            # optional: Python ws service
├─ services/
│  └─ voice-bridge/
│     ├─ src/
│     │  ├─ server.ts               # express + ws upgrade handler
│     │  ├─ routes/
│     │  │  ├─ aigents.ts           # /aigents/call.trigger
│     │  │  └─ webhook.ts           # /webhook/agents (ingest results)
│     │  ├─ twilio/
│     │  │  ├─ twiml.ts             # TwiML endpoint (<Start><Stream>)
│     │  │  └─ client.ts            # outbound dial helper
│     │  ├─ realtime/
│     │  │  ├─ session.ts           # system prompt + tools
│     │  │  └─ bridge.ts            # OpenAI WS bridge logic
│     │  ├─ security/
│     │  │  ├─ auth.ts              # HMAC auth for AIGENTS, JWT optional
│     │  │  ├─ twilio-verify.ts     # X-Twilio-Signature verification
│     │  │  └─ rate-limit.ts
│     │  ├─ db/
│     │  │  ├─ drizzle.ts           # pg/neon client + drizzle
│     │  │  ├─ schema.ts            # tables (automation_logs, calls, etc.)
│     │  │  └─ repo.ts              # typed queries
│     │  ├─ types/
│     │  │  └─ contracts.ts         # zod contracts for requests/responses
│     │  └─ utils/
│     │     ├─ env.ts               # env loader, hard fail on missing
│     │     └─ logger.ts            # pino
│     ├─ drizzle.config.ts
│     ├─ package.json
│     ├─ Dockerfile
│     ├─ .env.example
│     └─ README.md
└─ CLAUDE.md  # this file
```

---

## 3) Environment Variables

**Dev (.env, Neon):**

```
NODE_ENV=development
PORT=8080
PUBLIC_ORIGIN=https://<your-ngrok>.ngrok.io

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime # or your current realtime model id

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
TWIML_URL=https://<your-ngrok>.ngrok.io/twiml

# AIGENTS
AIGENTS_HMAC_SECRET=change-me # to verify triggers

# Biomarker sidecar
BIOMARKER_WS=ws://127.0.0.1:9091/ingest

# Database (Neon for dev)
DATABASE_URL=postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
```

**Prod (Cloud Run + Cloud SQL):**

* Put secrets in **Secret Manager** and mount as env.
* `DATABASE_URL` via Cloud SQL Auth Proxy or private IP: `postgresql://USER:PASS@/DBNAME?host=/cloudsql/PROJECT:REGION:INSTANCE` (or use PG connection pooler like pgbouncer).
* Restrict egress; allow listed domains for OpenAI + Twilio.

---

## 4) Database Schema (Drizzle + raw SQL)

### 4.1 Core tables from AIGENTS guide

```sql
-- automation_logs
CREATE TABLE IF NOT EXISTS automation_logs (
  id SERIAL PRIMARY KEY,
  chain_name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL,
  response TEXT,
  request_data JSONB,
  unique_id TEXT,
  email_response TEXT,
  email_received_at TIMESTAMP,
  agent_response TEXT,
  agent_name TEXT,
  agent_received_at TIMESTAMP,
  webhook_payload JSONB,
  chain_type TEXT,
  is_completed BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- optional
CREATE TABLE IF NOT EXISTS custom_chains (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 Additional tables for telephony/run state

```sql
-- map Twilio Call SID and Realtime session to AIGENTS run
CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  chain_run_id TEXT NOT NULL,
  call_sid TEXT UNIQUE,
  patient_id TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'created', -- created|dialing|connected|completed|failed
  callback_url TEXT NOT NULL,
  context JSONB,           -- patient demographic snapshot, objective, etc.
  summary JSONB,           -- final agent summary payload
  risk_last NUMERIC,       -- last biomarker risk value
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calls_chain_run ON calls(chain_run_id);
CREATE INDEX IF NOT EXISTS idx_calls_call_sid ON calls(call_sid);
```

### 4.3 Drizzle schema.ts (excerpt)

```ts
import { pgTable, serial, text, boolean, timestamp, jsonb, numeric } from 'drizzle-orm/pg-core';

export const automationLogs = pgTable('automation_logs', {
  id: serial('id').primaryKey(),
  chainName: text('chain_name').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull(),
  response: text('response'),
  requestData: jsonb('request_data'),
  uniqueId: text('unique_id'),
  emailResponse: text('email_response'),
  emailReceivedAt: timestamp('email_received_at'),
  agentResponse: text('agent_response'),
  agentName: text('agent_name'),
  agentReceivedAt: timestamp('agent_received_at'),
  webhookPayload: jsonb('webhook_payload'),
  chainType: text('chain_type'),
  isCompleted: boolean('is_completed').default(false),
  ts: timestamp('timestamp').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const calls = pgTable('calls', {
  id: serial('id').primaryKey(),
  chainRunId: text('chain_run_id').notNull(),
  callSid: text('call_sid').unique(),
  patientId: text('patient_id'),
  phone: text('phone'),
  status: text('status').notNull().default('created'),
  callbackUrl: text('callback_url').notNull(),
  context: jsonb('context'),
  summary: jsonb('summary'),
  riskLast: numeric('risk_last'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

---

## 5) API Contracts

### 5.1 AIGENTS → `/aigents/call.trigger` (POST)

**Auth:** HMAC header `X-Aigents-Signature: sha256=<hex>` over raw body using `AIGENTS_HMAC_SECRET`.

**Request (JSON):**

```json
{
  "chainRunId": "RUN-abc123",
  "agentName": "HF_Outreach_1",
  "patient": {
    "id": "pt-789", "name": "Jamie Rivera", "phone": "+15555551212",
    "dob": "1961-05-02", "mrn": "MRN-00042",
    "insurance": "Aetna PPO",
    "demographics": { "sex": "F", "lang": "en-US" },
    "notes": "NYHA II-III.",
    "lastTests": { "BNP": 620, "Echo_EF": 30, "date": "2025-08-12" },
    "carePlan": "Daily weights"
  },
  "callObjective": "HF symptom check + voice tasks + education",
  "clinicalContext": "Recent SOB on exertion, new diuretic titration",
  "callbackUrl": "https://your-app/webhook/agents"
}
```

**Response (200):** `{ ok: true, callSid: "CA..." }`

**Side effects:** insert into `calls` + `automation_logs` (status transitions: queued → calling).

### 5.2 Voice webhook (Twilio) `/twiml` (POST)

Respond with TwiML that starts Media Streams:

```xml
<Response>
  <Start>
    <Stream url="wss://YOUR_DOMAIN/twilio-stream" />
  </Start>
  <Say>Hi, connecting you to your care assistant.</Say>
  <Pause length="60" />
</Response>
```

### 5.3 WebSocket upgrade `/twilio-stream`

* Accepts Twilio Media Streams (JSON messages). Bridges to OpenAI Realtime; mirrors to biomarker WS.

### 5.4 AIGENTS webhook `/webhook/agents` (POST)

**Auth:** (a) mutual HMAC, or (b) signed POST from our bridge (API key).

**Request (JSON):**

```json
{
  "chainRunId": "RUN-abc123",
  "agentResponse": {
    "summary": ["... five bullets ..."],
    "recommendation": "RN follow-up in 24–48h",
    "red_flags": false,
    "biomarker": { "risk": 0.34, "status": "ok", "n": 27 },
    "transcript_snippets": ["..."]
  },
  "agentName": "HF_Voice_SIP_Agent",
  "currentIsoDateTime": "2025-08-28T15:04:05Z"
}
```

**Response:** `{ message: "Agent response processed successfully", chainRunId, status: "success" }`

**Side effects:** update `calls.summary`, `automation_logs.agent_response`, mark completed.

---

## 6) Realtime Session: System Prompt & Tools

### 6.1 System prompt (session.update → `instructions`)

```text
You are a virtual heart-failure nurse assistant on a telephone call.

Patient (PHI minimal in speech): {{patient.name}} ({{patient.demographics.lang||"en-US"}}), DOB {{patient.dob}}, MRN {{patient.mrn}}.
Recent clinical context: {{clinicalContext}}.
Call objective from AIGENTS: {{callObjective}}.

Goals:
1) Triage HF symptoms (dyspnea, orthopnea, edema, weight gain, chest pain, palpitations, cough, fatigue).
2) Run 3 voice tasks to support vocal-biomarker analysis:
   - sustained "ah" (≥3s) ×3,
   - count 1–30,
   - read: "The rainbow is in the sky."
3) Safety gate & escalate on red flags (chest pain, syncope, severe dyspnea, rapid weight gain ≥2–3 lb/24h, new confusion).
4) Summarize concisely and call finalize_summary, then return_to_aigents.

Style: warm, clear, 1–2 sentences at a time. Never diagnose. Minimize PHI in speech and logs.
```

### 6.2 Tool schema (JSON serializable)

```ts
export const tools = [
  { name: "log_symptom", description: "Record HF symptoms", parameters: {
      type: "object", properties: {
        dyspnea: { type:"string", enum:["none","exertion","rest"] },
        orthopnea: { type:"boolean" },
        edema: { type:"string", enum:["none","mild","moderate","severe"] },
        weightGainLb24h: { type:"number" },
        chestPain: { type:"boolean" },
        palpitations: { type:"boolean" },
        fatigue: { type:"string", enum:["none","mild","moderate","severe"] }
      }
  }},
  { name: "run_voice_task", description:"Guide & capture a voice task", parameters:{
      type:"object", properties:{ task:{ type:"string", enum:["sustained_ah","count_1_30","fixed_sentence"] }, repeats:{ type:"number", default:1 } }, required:["task"]
  }},
  { name: "escalate", description:"Escalate to nurse or emergent", parameters:{
      type:"object", properties:{ level:{ type:"string", enum:["nurse","emergent"] }, reason:{ type:"string" } }, required:["level","reason"]
  }},
  { name: "finalize_summary", description:"5-bullet summary + next action", parameters:{ type:"object", properties:{} }},
  { name: "return_to_aigents", description:"Send structured payload back to AIGENTS", parameters:{
      type:"object", properties:{ chainRunId:{ type:"string" }, payload:{ type:"object" } }, required:["chainRunId","payload"]
  }}
];
```

**Audio formats:** set `input_audio_format` and `output_audio_format` to `{ type: "g711_ulaw", sample_rate_hz: 8000 }` to match PSTN.

---

## 7) Core Server Scaffolds (Node/TS)

### 7.1 `env.ts`

```ts
import 'dotenv/config';

function req(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '8080', 10),
  PUBLIC_ORIGIN: req('PUBLIC_ORIGIN'),
  OPENAI_API_KEY: req('OPENAI_API_KEY'),
  OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
  TWILIO_ACCOUNT_SID: req('TWILIO_ACCOUNT_SID'),
  TWILIO_AUTH_TOKEN: req('TWILIO_AUTH_TOKEN'),
  TWILIO_FROM_NUMBER: req('TWILIO_FROM_NUMBER'),
  TWIML_URL: req('TWIML_URL'),
  AIGENTS_HMAC_SECRET: req('AIGENTS_HMAC_SECRET'),
  BIOMARKER_WS: process.env.BIOMARKER_WS || 'ws://127.0.0.1:9091/ingest',
  DATABASE_URL: req('DATABASE_URL'),
};
```

### 7.2 `twiml.ts`

```ts
import { Request, Response } from 'express';
import twilio from 'twilio';

export function twimlHandler(req: Request, res: Response) {
  const twiml = new twilio.twiml.VoiceResponse();
  const start = twiml.start();
  start.stream({ url: `${process.env.PUBLIC_ORIGIN}/twilio-stream` });
  twiml.say('Hi, connecting you to your care assistant.');
  twiml.pause({ length: 60 });
  res.type('text/xml').send(twiml.toString());
}
```

### 7.3 Outbound dial helper `client.ts`

```ts
import Twilio from 'twilio';
import { ENV } from '../utils/env';

export const twilioClient = Twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN);

export async function startTwilioCall({ to, twimlWebhookUrl, passThrough }: { to: string; twimlWebhookUrl: string; passThrough: any; }) {
  const call = await twilioClient.calls.create({
    to,
    from: ENV.TWILIO_FROM_NUMBER,
    url: twimlWebhookUrl,
    statusCallbackEvent: ['initiated','ringing','answered','completed'],
    statusCallback: `${ENV.PUBLIC_ORIGIN}/twilio-status?data=${encodeURIComponent(Buffer.from(JSON.stringify(passThrough)).toString('base64'))}`,
    statusCallbackMethod: 'POST'
  });
  return { callSid: call.sid };
}
```

### 7.4 WebSocket bridge `bridge.ts` (OpenAI Realtime)

```ts
import WebSocket from 'ws';
import { ENV } from '../utils/env';
import { buildSystemPrompt, tools } from './session';

export function openaiRealtime(wsUrl = `wss://api.openai.com/v1/realtime?model=${ENV.OPENAI_REALTIME_MODEL}`) {
  return new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${ENV.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
      'Content-Type': 'application/json'
    }
  });
}

export function initSession(socket: WebSocket, ctx: any) {
  socket.on('open', () => {
    socket.send(JSON.stringify({
      type: 'session.update',
      session: {
        instructions: buildSystemPrompt(ctx),
        tools,
        input_audio_format: { type: 'g711_ulaw', sample_rate_hz: 8000 },
        output_audio_format: { type: 'g711_ulaw', sample_rate_hz: 8000 },
        turn_detection: { type: 'server_vad' }
      }
    }));
  });
}
```

### 7.5 WS upgrade handler in `server.ts` (bridge Twilio ⇄ OpenAI)

```ts
import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import { ENV } from './utils/env';
import { twimlHandler } from './twilio/twiml';
import { router as aigents } from './routes/aigents';
import fetch from 'node-fetch';
import { openaiRealtime, initSession } from './realtime/bridge';

const app = express();
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

app.post('/twiml', twimlHandler);
app.use(aigents);

app.post('/webhook/agents', async (req, res) => {
  // store results; minimal example
  res.json({ message: 'Agent response processed successfully', chainRunId: req.body.chainRunId, status: 'success' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/twilio-stream')) {
    wss.handleUpgrade(req, socket, head, (twilioWS) => handleTwilioStream(twilioWS, req));
  } else {
    socket.destroy();
  }
});

async function handleTwilioStream(twilioWS: WebSocket, req: any) {
  const openaiWS = openaiRealtime();
  const ctx = await resolveContextFromReq(req); // chainRunId, patient, callObjective, clinicalContext, callbackUrl
  initSession(openaiWS, ctx);

  const biomarkerWS = new WebSocket(ENV.BIOMARKER_WS);

  twilioWS.on('message', (buf) => {
    const evt = JSON.parse(buf.toString());
    if (evt.event === 'media') {
      const b64 = evt.media.payload;
      openaiWS.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
      biomarkerWS.send(JSON.stringify({ type: 'audio', audio: b64, chainRunId: ctx.chainRunId }));
    } else if (evt.event === 'stop') {
      openaiWS.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      openaiWS.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio'] } }));
    }
  });

  openaiWS.on('message', async (raw) => {
    const data = JSON.parse(raw.toString());
    if (data.type === 'response.audio.delta') {
      twilioWS.send(JSON.stringify({ event: 'media', media: { payload: data.delta } }));
    }
    if (data.type === 'response.function_call') {
      if (data.name === 'return_to_aigents') {
        const out = JSON.parse(data.arguments_json);
        await fetch(ctx.callbackUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chainRunId: out.chainRunId,
            agentResponse: out.payload,
            agentName: 'HF_Voice_SIP_Agent',
            currentIsoDateTime: new Date().toISOString()
          })
        });
      }
      openaiWS.send(JSON.stringify({ type: 'response.function_call.output', call_id: data.call_id, output: JSON.stringify({ ok: true }) }));
    }
  });
}

async function resolveContextFromReq(req: any) {
  // Extract call SID -> load context from DB or status callback (simplified here)
  // TODO: Implement DB lookup using calls table
  return { chainRunId: 'RUN-abc123', callbackUrl: process.env.PUBLIC_ORIGIN + '/webhook/agents', patient: { name: 'Jamie', demographics: { lang: 'en-US' }, dob: '1961-05-02', mrn: 'MRN-00042' }, callObjective: 'HF check', clinicalContext: 'Recent SOB' };
}

server.listen(ENV.PORT, () => console.log(`Voice bridge on :${ENV.PORT}`));
```

> **Note:** for production, replace the stub `resolveContextFromReq` with a lookup keyed by Twilio Call SID captured in `/aigents/call.trigger` and in the `statusCallback` on the outbound call (persist the `chainRunId`, patient snapshot, and `callbackUrl`).

---

## 8) Biomarker Sidecar (Python) – Interface Contract

* **Ingress WS:** `ws://...:9091/ingest`
* **Incoming message:** `{ type: "audio", audio: <base64 μ-law>, chainRunId: "RUN-..." }`
* **Outgoing message:** `{ type: "risk", risk: 0.0..1.0, status: "ok|warming_up", n: <int>, chainRunId }`
* **Bridge behavior:** if `risk >= 0.8`, post an advisory to the Realtime session (text) to recheck red flags; always include the last risk in the final payload to AIGENTS.

(You can reuse the openSMILE + IsolationForest scaffold we already drafted.)

---

## 9) Security & Compliance Posture

* **Transport:** HTTPS everywhere; WSS for Twilio streams; TLS 1.2+.
* **AIGENTS trigger auth:** HMAC header `X-Aigents-Signature` (sha256 over raw body).
* **Webhook auth (AIGENTS):** add a shared secret header or HMAC in our POSTs back to `/webhook/agents`.
* **Twilio request verification:** verify `X-Twilio-Signature` on `/twiml` and status callbacks.
* **Input validation:** `zod` schemas on all JSON.
* **Rate limiting:** IP + token bucket on `/aigents/call.trigger` and `/webhook/agents`.
* **Secrets:** `.env` (dev), **Secret Manager** (prod). Do not log secrets/PHI.
* **Data minimization:** store derived features/scores and short, PHI‑minimized snippets; avoid storing raw audio.
* **Audit logs:** structured `pino` logs with correlation IDs (`chainRunId`, `callSid`).
* **Least privilege:** service account with minimal IAM; VPC egress only to OpenAI/Twilio; Cloud SQL private IP.

> HIPAA/BAA notes: coordinate BAAs with your telephony and hosting vendors as appropriate. Keep PHI footprint minimal and under your VPC controls.

---

## 10) Local Dev (Neon) & Migrations

1. Create a Neon project; copy `DATABASE_URL` with `sslmode=require`.
2. Install deps: `npm i` (voice-bridge). Add `drizzle-orm`, `drizzle-kit`, `pg`, `@neondatabase/serverless`.
3. Configure `drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! }
});
```

4. Run migrations: `npm run db:push` or `drizzle-kit push`.
5. Start dev: `npm run dev` (ts-node / nodemon).
6. Expose public URL using `ngrok http 8080`; set `PUBLIC_ORIGIN` and `TWIML_URL` accordingly.

---

## 11) Google Cloud Production

* **Build & Deploy (Cloud Run):**

  * Dockerfile (Node 20‑slim), healthcheck on `/healthz`.
  * `gcloud run deploy voice-bridge --source . --region us-central1 --allow-unauthenticated` (or restrict with IAP if Twilio IP ranges are allowed).
  * Concurrency: 1–4 (reduce tail latency for WS). Min instances ≥1 for warm starts.
* **Secrets:** `gcloud secrets create ...`; mount as env.
* **Cloud SQL:** Postgres 15; private IP; connect via Cloud Run VPC connector or Cloud SQL Auth Proxy.
* **Observability:** Cloud Logging sinks → BigQuery; OpenTelemetry exporter optional.
* **Scaling:** set CPU always allocated if long WS sessions; max timeout ≥ 15 minutes to allow calls.

---

## 12) Twilio Setup

1. Buy/provision a phone number.
2. Voice webhook (POST) → `https://YOUR_DOMAIN/twiml`.
3. Outbound caller ID = `TWILIO_FROM_NUMBER`.
4. Status callback URL → `https://YOUR_DOMAIN/twilio-status` (store passThrough data here). Verify signatures.
5. Test call: curl POST `/aigents/call.trigger` with a sample payload.

> **Realtime SIP option:** When enabled, you can point a SIP trunk at OpenAI Realtime per the guide and remove Media Streams. Keep this bridge for tools and AIGENTS callbacks (you can also fork audio for biomarkers at your SBC or via recording webhooks).

---

## 13) Testing Plan

* **Unit:** zod validation, HMAC verification, TwiML generation, DB repo.
* **Integration:** mock Twilio Media Streams (send sample `media` JSON; assert the model gets `input_audio_buffer.append`).
* **E2E:**

  * Trigger from AIGENTS → call placed → basic conversation → agent returns payload to `/webhook/agents`.
  * Biomarker emits `risk` > 0.8 mid‑call; model receives advisory; summary contains risk.
* **Failure cases:** network drop (reconnect policy), model timeout (failover to text prompts), Twilio 4xx/5xx (retry/backoff), DB outage (queue to memory + retry).

---

## 14) Example: AIGENTS Trigger cURL

```bash
curl -X POST $PUBLIC_ORIGIN/aigents/call.trigger \
 -H 'Content-Type: application/json' \
 -H 'X-Aigents-Signature: sha256=<computed>' \
 -d '{
  "chainRunId": "RUN-abc123",
  "agentName": "HF_Outreach_1",
  "patient": { "id":"pt-789","name":"Jamie","phone":"+15555551212","dob":"1961-05-02","mrn":"MRN-00042" },
  "callObjective": "HF symptom check + voice tasks",
  "clinicalContext": "Recent SOB on exertion",
  "callbackUrl": "'$PUBLIC_ORIGIN'/webhook/agents"
 }'
```

---

## 15) npm Scripts & Dockerfile

**package.json scripts (voice-bridge):**

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn src/server.ts",
    "build": "tsc -p .",
    "start": "node dist/server.js",
    "db:push": "drizzle-kit push"
  }
}
```

**Dockerfile:**

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

---

## 16) Open Questions / Next Steps

* Confirm the exact **Realtime model id** available in your account; set `OPENAI_REALTIME_MODEL` accordingly.
* Decide whether to persist **full transcripts** or only **snippets** + features.
* Add **Redis** or Cloud Memorystore for call/session state if we need horizontal scaling.
* Implement **idempotency** on `/aigents/call.trigger` using `chainRunId`.
* Add **/healthz** and **/version** endpoints for Cloud Run monitoring.

---

## 17) Appendix – Twilio Signature & AIGENTS HMAC Snippets

**Verify Twilio signature (Express middleware):**

```ts
import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';

export function verifyTwilio(req: Request, res: Response, next: NextFunction) {
  const signature = req.header('X-Twilio-Signature') || '';
  const url = process.env.PUBLIC_ORIGIN + req.originalUrl; // exact URL Twilio posts to
  const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN!, signature, url, req.body);
  if (!valid) return res.status(403).send('Invalid Twilio signature');
  next();
}
```

**Verify AIGENTS HMAC:**

```ts
import crypto from 'crypto';

export function verifyAigentsSignature(rawBody: string, header: string|undefined, secret: string) {
  if (!header) return false;
  const [algo, sig] = header.split('=');
  if (algo !== 'sha256' || !sig) return false;
  const mac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(sig, 'hex'));
}
```

---

### Done ✅

This spec is ready to implement. Start with `/services/voice-bridge`, wire Neon via Drizzle, connect Twilio Media Streams, then integrate the biomarker sidecar. Swap to Realtime SIP later without changing AIGENTS contracts.
