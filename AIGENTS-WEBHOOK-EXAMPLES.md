# AIGENTS Webhook Integration Examples

## 1. Inbound Webhook: AIGENTS → Voice Bridge
**Endpoint:** `POST /aigents/call.trigger`

### Example Request from AIGENTS

```bash
curl -X POST https://your-domain.com/aigents/call.trigger \
  -H "Content-Type: application/json" \
  -H "X-Aigents-Signature: sha256=a1b2c3d4e5f6..." \
  -d '{
    "chainRunId": "RUN-2025-01-29-abc123xyz",
    "agentName": "HF_Voice_Outreach_Agent",
    "patient": {
      "id": "pt-789456",
      "name": "Jamie Rivera",
      "phone": "+16465565559",
      "dob": "1961-05-02",
      "mrn": "MRN-00042",
      "insurance": "Aetna PPO",
      "demographics": {
        "sex": "F",
        "lang": "en-US",
        "timezone": "America/New_York"
      },
      "notes": "NYHA Class II-III, recent hospitalization",
      "lastTests": {
        "BNP": 620,
        "Echo_EF": 30,
        "date": "2025-01-15"
      },
      "medications": [
        "Entresto 49/51mg BID",
        "Carvedilol 12.5mg BID", 
        "Furosemide 40mg daily",
        "Spironolactone 25mg daily"
      ],
      "carePlan": "Daily weight monitoring, 2L fluid restriction, low sodium diet"
    },
    "callObjective": "Weekly CHF symptom assessment and medication adherence check",
    "clinicalContext": "Patient reported increased SOB on exertion last week. Diuretic dose increased 3 days ago.",
    "callbackUrl": "https://aigents-platform.com/webhook/voice-results/RUN-2025-01-29-abc123xyz"
  }'
```

### Response from Voice Bridge

```json
{
  "ok": true,
  "callSid": "CA9927e48fb33cdfed4fd2d2db69d88ec6",
  "message": "Call initiated successfully",
  "estimatedDuration": "5-7 minutes"
}
```

### Error Response Example

```json
{
  "ok": false,
  "error": "Invalid phone number format",
  "message": "Request validation failed",
  "details": [
    {
      "path": ["patient", "phone"],
      "message": "Phone number must be in E.164 format"
    }
  ]
}
```

## 2. Outbound Webhook: Voice Bridge → AIGENTS
**Endpoint:** The `callbackUrl` provided in the trigger request

### Example Callback to AIGENTS (After Call Completes)

```json
{
  "chainRunId": "RUN-2025-01-29-abc123xyz",
  "agentResponse": {
    "summary": [
      "Patient reports mild shortness of breath with moderate activity (walking up stairs)",
      "No chest pain or palpitations noted",
      "Weight stable at 178 lbs (no change from baseline)",
      "Confirms taking all medications as prescribed",
      "Voice biomarker analysis shows moderate risk elevation (62%)"
    ],
    "recommendation": "Schedule follow-up with HF nurse within 48 hours for symptom review",
    "red_flags": false,
    "biomarker": {
      "risk": 0.62,
      "status": "ok",
      "n": 2847
    },
    "transcript_snippets": [
      "Patient: 'I get a little winded going up the stairs, but it's not too bad'",
      "Patient: 'I've been taking my water pill every morning like you said'",
      "Patient: 'My weight has been the same, checking it every day'"
    ],
    "symptoms": {
      "dyspnea": "exertion",
      "orthopnea": false,
      "edema": "none",
      "weightGainLb24h": 0,
      "chestPain": false,
      "palpitations": false,
      "fatigue": "mild"
    },
    "escalation": {
      "level": "none",
      "reason": null
    },
    "callMetrics": {
      "duration": 342,
      "voiceTasksCompleted": ["sustained_ah", "counting", "reading"],
      "audioQuality": "good",
      "patientEngagement": "high"
    }
  },
  "agentName": "HF_Voice_Outreach_Agent",
  "currentIsoDateTime": "2025-01-29T15:47:23.456Z"
}
```

### High Risk Escalation Example

```json
{
  "chainRunId": "RUN-2025-01-29-urgent001",
  "agentResponse": {
    "summary": [
      "Patient reports severe shortness of breath at rest",
      "Weight gain of 4 pounds since yesterday (182 lbs → 186 lbs)",
      "Unable to lie flat, sleeping in recliner",
      "Voice biomarker shows critical risk elevation (89%)",
      "Patient sounds notably distressed with audible breathing difficulty"
    ],
    "recommendation": "IMMEDIATE medical attention required - advised patient to call 911",
    "red_flags": true,
    "biomarker": {
      "risk": 0.89,
      "status": "ok",
      "n": 1523
    },
    "symptoms": {
      "dyspnea": "rest",
      "orthopnea": true,
      "edema": "moderate",
      "weightGainLb24h": 4,
      "chestPain": false,
      "palpitations": true,
      "fatigue": "severe"
    },
    "escalation": {
      "level": "emergent",
      "reason": "Severe dyspnea at rest + rapid weight gain + high biomarker risk"
    }
  },
  "agentName": "HF_Voice_Outreach_Agent",
  "currentIsoDateTime": "2025-01-29T09:23:45.789Z"
}
```

## 3. HMAC Authentication

Both webhooks use HMAC-SHA256 for authentication:

### Calculating the Signature (Node.js)

```javascript
const crypto = require('crypto');

function generateHMACSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return 'sha256=' + hmac.digest('hex');
}

// Example
const payload = { chainRunId: "RUN-123", ... };
const secret = process.env.AIGENTS_HMAC_SECRET;
const signature = generateHMACSignature(payload, secret);
// Add to header: X-Aigents-Signature: sha256=a1b2c3...
```

### Verifying the Signature

```javascript
function verifyHMACSignature(payload, signature, secret) {
  const expectedSig = generateHMACSignature(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig)
  );
}
```

## 4. Webhook Flow Sequence

```
1. AIGENTS decides patient needs outreach
   ↓
2. AIGENTS sends POST /aigents/call.trigger
   ↓
3. Voice Bridge validates and queues call
   ↓
4. Voice Bridge returns { ok: true, callSid: "CA..." }
   ↓
5. Voice Bridge initiates Twilio call
   ↓
6. Patient answers, AI conducts assessment
   ↓
7. Call completes, results processed
   ↓
8. Voice Bridge sends POST to callbackUrl
   ↓
9. AIGENTS receives results and updates patient record
```

## 5. Testing with Mock AIGENTS

```javascript
// test-aigents-trigger.js
const axios = require('axios');
const crypto = require('crypto');

async function testAigentsTrigger() {
  const payload = {
    chainRunId: `TEST-${Date.now()}`,
    agentName: "Test_HF_Agent",
    patient: {
      id: "test-patient-001",
      name: "Test Patient",
      phone: "+16465565559", // Your test number
      dob: "1960-01-01",
      mrn: "TEST-001",
      demographics: { sex: "M", lang: "en-US" },
      lastTests: { BNP: 450, Echo_EF: 35, date: "2025-01-28" },
      carePlan: "Test monitoring"
    },
    callObjective: "Test CHF assessment",
    clinicalContext: "Testing voice bridge integration",
    callbackUrl: "http://localhost:3001/test-webhook" // Your test endpoint
  };

  const secret = "your-hmac-secret";
  const signature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex')}`;

  try {
    const response = await axios.post(
      'http://localhost:8080/aigents/call.trigger',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Aigents-Signature': signature
        }
      }
    );
    
    console.log('Call triggered:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testAigentsTrigger();
```

## 6. Webhook Retry Policy

AIGENTS should implement retry logic:

- **Retry on**: 5xx errors, network timeouts
- **Don't retry on**: 4xx errors (bad request, auth failure)
- **Retry schedule**: 1s, 5s, 30s, 2m, 5m
- **Max attempts**: 5
- **Timeout**: 30 seconds per request

## 7. Rate Limits

- **Inbound** (AIGENTS → Voice Bridge): 100 requests per 15 minutes
- **Outbound** (Voice Bridge → AIGENTS): No limit (one per completed call)

## 8. Monitoring Webhooks

Check webhook status:

```sql
-- Recent incoming triggers
SELECT 
  chain_run_id,
  created_at,
  status,
  request_data->>'agentName' as agent,
  request_data->'patient'->>'name' as patient
FROM automation_logs
ORDER BY created_at DESC
LIMIT 10;

-- Completed calls awaiting webhook
SELECT 
  chain_run_id,
  call_sid,
  status,
  callback_url,
  summary
FROM calls
WHERE status = 'completed'
  AND summary IS NOT NULL
ORDER BY updated_at DESC;
```