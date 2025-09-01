# Dashboard Implementation Plan

## Current State
- Backend-only system triggered by AIGENTS
- No frontend/UI currently exists
- All monitoring via terminal logs

## Proposed Dashboard Architecture

### 1. Real-Time Monitoring Dashboard
```
┌─────────────────────────────────────────────────┐
│              CHF Voice Assessment Dashboard      │
├─────────────────────────────────────────────────┤
│                                                  │
│  Active Calls                 │  Risk Analytics │
│  ┌──────────────┐            │  ┌────────────┐ │
│  │ John D.      │            │  │   Risk     │ │
│  │ Call: 2:34   │            │  │   Score    │ │
│  │ Risk: 72% 🔴 │            │  │    72%     │ │
│  └──────────────┘            │  │    ████    │ │
│                               │  └────────────┘ │
│                               │                  │
│  Recent Assessments           │  Voice Patterns │
│  ┌──────────────────────┐    │  [Waveform viz] │
│  │ Mary S. - 45% ✓      │    │                  │
│  │ Robert K. - 89% ⚠️    │    │  Symptoms       │
│  │ Linda M. - 23% ✓      │    │  ☑ Shortness   │
│  └──────────────────────┘    │  ☑ Fatigue      │
│                               │  ☐ Chest pain   │
└─────────────────────────────────────────────────┘
```

### 2. Quick Implementation Options

#### Option A: Express + Socket.io + React (Quick MVP)
```javascript
// Add to voice-bridge/src/server.ts
import { Server } from 'socket.io';

const io = new Server(server, {
  cors: { origin: '*' }
});

// Emit real-time updates
io.emit('call.update', {
  callSid,
  risk: biomarkerRisk,
  transcript: lastTranscript,
  symptoms: detectedSymptoms
});

// Simple React dashboard
// dashboard/src/App.jsx
function Dashboard() {
  const [calls, setCalls] = useState([]);
  
  useEffect(() => {
    const socket = io('http://localhost:8080');
    socket.on('call.update', (data) => {
      setCalls(prev => [...prev, data]);
    });
  }, []);
  
  return (
    <div>
      <h1>CHF Voice Monitoring</h1>
      {calls.map(call => (
        <CallCard key={call.callSid} {...call} />
      ))}
    </div>
  );
}
```

#### Option B: Grafana + PostgreSQL (Production Ready)
- Use existing Neon database
- Grafana for visualization
- Real-time updates via WebSocket
- No custom frontend needed

#### Option C: Retool/Bubble (No-Code)
- Connect to PostgreSQL
- Drag-drop dashboard builder
- Quick deployment
- Good for clinical teams

### 3. Database Tables for Dashboard

```sql
-- Add views for dashboard
CREATE VIEW dashboard_active_calls AS
SELECT 
  c.call_sid,
  c.patient_id,
  c.risk_last as current_risk,
  c.created_at as call_start,
  EXTRACT(EPOCH FROM (NOW() - c.created_at)) as duration_seconds,
  c.status
FROM calls c
WHERE c.status IN ('dialing', 'connected', 'streaming');

CREATE VIEW dashboard_risk_trends AS
SELECT 
  DATE(created_at) as assessment_date,
  AVG(risk_last) as avg_risk,
  COUNT(*) as call_count,
  SUM(CASE WHEN risk_last >= 0.7 THEN 1 ELSE 0 END) as high_risk_count
FROM calls
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at);

CREATE VIEW dashboard_symptoms AS
SELECT 
  call_sid,
  jsonb_array_elements_text(summary->'symptoms') as symptom,
  created_at
FROM calls
WHERE summary IS NOT NULL;
```

### 4. API Endpoints for Dashboard

```typescript
// Add to voice-bridge/src/routes/dashboard.ts
router.get('/api/dashboard/active', async (req, res) => {
  const activeCalls = await repo.getActiveCalls();
  res.json(activeCalls);
});

router.get('/api/dashboard/stats', async (req, res) => {
  const stats = await repo.getDashboardStats();
  res.json({
    totalCalls: stats.total,
    avgRisk: stats.avgRisk,
    highRiskCount: stats.highRisk,
    todaysCalls: stats.today
  });
});

router.get('/api/dashboard/call/:id', async (req, res) => {
  const call = await repo.getCallDetails(req.params.id);
  res.json(call);
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
  socket.join('dashboard');
  
  // Send updates when calls change
  eventEmitter.on('call.update', (data) => {
    io.to('dashboard').emit('update', data);
  });
});
```

### 5. Quick Start Dashboard

```bash
# Create dashboard directory
mkdir dashboard
cd dashboard

# Initialize React app
npx create-react-app chf-dashboard
cd chf-dashboard

# Install dependencies
npm install socket.io-client recharts axios

# Start development
npm start
```

### 6. Integration with AIGENTS

AIGENTS could potentially:
- View dashboard via embedded iframe
- Receive dashboard URLs in webhook responses
- Access dashboard API endpoints directly

### 7. Security Considerations

- Add authentication (JWT/OAuth)
- PHI data masking
- Role-based access (clinician vs admin)
- Audit logging
- HTTPS only

## Next Steps

1. Choose dashboard approach (A, B, or C)
2. Create database views
3. Add WebSocket events to bridge
4. Build frontend components
5. Deploy behind authentication