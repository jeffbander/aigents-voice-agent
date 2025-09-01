const express = require('express');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/healthz', (req, res) => {
  res.json({ status: 'healthy' });
});

// TwiML endpoint for CHF voice assessment
app.post('/twiml', (req, res) => {
  console.log('📞 CHF Assessment Call Started');
  console.log('  Call SID:', req.body.CallSid);
  console.log('  From:', req.body.From);
  console.log('  To:', req.body.To);
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.hostname}/media-stream" track="both_tracks">
      <Parameter name="callSid" value="${req.body.CallSid}" />
    </Stream>
  </Connect>
</Response>`;
  
  res.type('text/xml').send(twiml);
});

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleMediaStream(ws);
    });
  } else {
    socket.destroy();
  }
});

function handleMediaStream(twilioWS) {
  console.log('✅ Twilio WebSocket connected');
  
  let openaiWS = null;
  let biomarkerWS = null;
  let streamSid = null;
  let callSid = null;
  let sessionReady = false;
  let audioBuffer = [];
  let biomarkerRisk = 0;
  let audioFrameCount = 0;
  
  try {
    // Connect to Biomarker Service
    console.log('🧬 Connecting to biomarker service...');
    biomarkerWS = new WebSocket('ws://127.0.0.1:9091/ingest');
    
    biomarkerWS.on('open', () => {
      console.log('✅ Biomarker service connected');
    });
    
    biomarkerWS.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'risk') {
        biomarkerRisk = msg.risk;
        console.log(`🧬 Biomarker Risk Update: ${(msg.risk * 100).toFixed(1)}%`);
        console.log(`  Status: ${msg.status}`);
        console.log(`  Frames analyzed: ${msg.n}`);
        
        // Alert if high risk detected
        if (msg.risk >= 0.8 && openaiWS && sessionReady) {
          console.log('⚠️ HIGH RISK DETECTED - Alerting AI assistant');
          openaiWS.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'system',
              content: [{
                type: 'text',
                text: `ALERT: Voice biomarker analysis indicates elevated CHF risk (${(msg.risk * 100).toFixed(1)}%). Please check for red flag symptoms immediately.`
              }]
            }
          }));
        }
      }
    });
    
    biomarkerWS.on('error', (error) => {
      console.error('❌ Biomarker service error:', error.message);
    });
    
    // Connect to OpenAI Realtime
    const wsUrl = `wss://api.openai.com/v1/realtime?model=${process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01'}`;
    console.log('🤖 Connecting to OpenAI Realtime...');
    
    openaiWS = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    
    openaiWS.on('open', () => {
      console.log('✅ OpenAI connected, configuring CHF assessment session...');
      
      const sessionConfig = {
        type: 'session.update',
        session: {
          voice: 'alloy',
          instructions: `You are a virtual heart failure nurse assistant conducting a telephone assessment.

CRITICAL: This is a CHF symptom check call. You must:
1. Start by warmly greeting the patient and asking how they're feeling today
2. Systematically assess key CHF symptoms:
   - Shortness of breath (at rest or with activity)
   - Orthopnea (difficulty breathing when lying flat)
   - Swelling in legs, ankles, or feet
   - Weight gain (how much in last 24-48 hours)
   - Fatigue or weakness
   - Cough (especially at night)
   - Chest pain or palpitations

3. Conduct voice biomarker tasks - IMPORTANT:
   - Ask the patient to say "Ahhhh" for 5 seconds (repeat 3 times)
   - Ask them to count from 1 to 30 at their normal pace
   - Ask them to read: "The rainbow is a division of white light"

4. Red flags requiring immediate escalation:
   - Severe shortness of breath at rest
   - Chest pain
   - Weight gain >2-3 lbs in 24 hours or >5 lbs in a week
   - New confusion or dizziness
   - Syncope (fainting)

5. Provide appropriate guidance based on symptoms
6. Keep responses brief and conversational
7. Be warm and empathetic

Remember: The voice biomarker system is analyzing their voice quality in real-time for CHF risk indicators.`,
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 200
          },
          modalities: ['text', 'audio'],
          temperature: 0.7
        }
      };
      
      openaiWS.send(JSON.stringify(sessionConfig));
    });
    
    openaiWS.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      switch(msg.type) {
        case 'session.updated':
          console.log('✅ CHF Assessment session ready!');
          sessionReady = true;
          
          // Process buffered audio
          if (audioBuffer.length > 0) {
            audioBuffer.forEach(audio => {
              openaiWS.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: audio
              }));
            });
            audioBuffer = [];
          }
          
          // Start assessment
          console.log('🏥 Starting CHF assessment...');
          openaiWS.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio']
            }
          }));
          break;
          
        case 'response.audio_transcript.done':
          console.log('🤖 Nurse AI:', msg.transcript);
          break;
          
        case 'conversation.item.input_audio_transcription.completed':
          console.log('👤 Patient:', msg.transcript);
          
          // Check for symptom keywords
          const transcript = msg.transcript.toLowerCase();
          if (transcript.includes('breath') || transcript.includes('tired') || 
              transcript.includes('swelling') || transcript.includes('chest')) {
            console.log('🚨 Symptom mentioned - monitoring closely');
          }
          break;
      }
    });
    
  } catch (error) {
    console.error('Failed to connect:', error);
  }
  
  // Handle Twilio messages
  twilioWS.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      switch(msg.event) {
        case 'start':
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          console.log('🎬 Assessment stream started');
          console.log('  Call SID:', callSid);
          
          // Initialize biomarker session
          if (biomarkerWS && biomarkerWS.readyState === WebSocket.OPEN) {
            biomarkerWS.send(JSON.stringify({
              type: 'session_start',
              chainRunId: `CHF-${callSid}`,
              timestamp: new Date().toISOString()
            }));
          }
          break;
          
        case 'media':
          audioFrameCount++;
          
          // Forward to OpenAI
          if (openaiWS && openaiWS.readyState === WebSocket.OPEN) {
            if (!sessionReady) {
              audioBuffer.push(msg.media.payload);
            } else {
              openaiWS.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: msg.media.payload
              }));
            }
          }
          
          // Forward to Biomarker service
          if (biomarkerWS && biomarkerWS.readyState === WebSocket.OPEN) {
            biomarkerWS.send(JSON.stringify({
              type: 'audio',
              audio: msg.media.payload,
              chainRunId: `CHF-${callSid}`,
              timestamp: new Date().toISOString()
            }));
            
            // Log every 500 frames
            if (audioFrameCount % 500 === 0) {
              console.log(`📊 Processed ${audioFrameCount} audio frames, Current risk: ${(biomarkerRisk * 100).toFixed(1)}%`);
            }
          }
          break;
          
        case 'stop':
          console.log('📞 Assessment completed');
          console.log(`  Total frames: ${audioFrameCount}`);
          console.log(`  Final biomarker risk: ${(biomarkerRisk * 100).toFixed(1)}%`);
          
          if (biomarkerRisk >= 0.7) {
            console.log('⚠️ ELEVATED RISK - Recommend follow-up');
          } else if (biomarkerRisk >= 0.5) {
            console.log('⚠️ MODERATE RISK - Continue monitoring');
          } else {
            console.log('✅ LOW RISK - Routine follow-up');
          }
          
          if (openaiWS) openaiWS.close();
          if (biomarkerWS) biomarkerWS.close();
          break;
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });
  
  twilioWS.on('close', () => {
    console.log('🔌 Session ended');
    if (openaiWS && openaiWS.readyState === WebSocket.OPEN) openaiWS.close();
    if (biomarkerWS && biomarkerWS.readyState === WebSocket.OPEN) biomarkerWS.close();
  });
}

const PORT = 8081;
server.listen(PORT, () => {
  console.log(`🏥 CHF Voice Assessment Bridge running on port ${PORT}`);
  console.log(`🧬 Biomarker service: ws://127.0.0.1:9091/ingest`);
  console.log(`🤖 OpenAI Realtime: Enabled`);
  console.log(`📊 Features: Real-time CHF risk scoring + symptom assessment`);
});