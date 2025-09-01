#!/usr/bin/env node

/**
 * Test script to trigger a call through the AIGENTS voice agent system
 * This simulates an AIGENTS platform trigger for a heart failure patient outreach call
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
require('dotenv').config();

// Configuration
const SERVER_URL = process.env.PUBLIC_ORIGIN || 'http://localhost:8080';
const HMAC_SECRET = process.env.AIGENTS_HMAC_SECRET || 'test-secret-key';
const TARGET_PHONE = '+16465565559'; // The phone number to call

// Generate a unique chain run ID
const chainRunId = `TEST-CHF-${Date.now()}`;

// Patient data for testing (simulated CHF patient)
const testPayload = {
  chainRunId: chainRunId,
  agentName: 'HF_Outreach_Test',
  patient: {
    id: 'pt-test-001',
    name: 'Test Patient',
    phone: TARGET_PHONE,
    dob: '1960-05-15',
    mrn: 'MRN-TEST-001',
    insurance: 'Test Insurance PPO',
    demographics: {
      sex: 'M',
      lang: 'en-US'
    },
    notes: 'Test patient for CHF voice agent. NYHA Class II-III heart failure.',
    lastTests: {
      BNP: 650,
      Echo_EF: 35,
      date: '2025-08-20'
    },
    carePlan: 'Daily weight monitoring, low sodium diet, medication compliance'
  },
  callObjective: 'Heart failure symptom assessment, voice biomarker collection, and patient education',
  clinicalContext: 'Recent hospitalization for acute decompensated heart failure. Started on new diuretic regimen. Needs close monitoring for fluid status and symptom progression.',
  callbackUrl: `${SERVER_URL}/webhook/agents`
};

/**
 * Generate HMAC signature for request authentication
 */
function generateHMACSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Make the API call to trigger the voice agent
 */
async function triggerCall() {
  console.log('========================================');
  console.log('AIGENTS Voice Agent Test Call');
  console.log('========================================');
  console.log('Target Phone:', TARGET_PHONE);
  console.log('Chain Run ID:', chainRunId);
  console.log('Server URL:', SERVER_URL);
  console.log('');
  
  try {
    // Generate HMAC signature
    const signature = generateHMACSignature(testPayload, HMAC_SECRET);
    
    console.log('Triggering outbound call...');
    console.log('Patient:', testPayload.patient.name);
    console.log('Objective:', testPayload.callObjective);
    console.log('');
    
    // Make the API request
    const response = await fetch(`${SERVER_URL}/aigents/call.trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Aigents-Signature': signature
      },
      body: JSON.stringify(testPayload)
    });
    
    const responseData = await response.json();
    
    if (response.ok && responseData.ok) {
      console.log('✅ Call initiated successfully!');
      console.log('Call SID:', responseData.callSid);
      console.log('Message:', responseData.message);
      console.log('');
      console.log('The system will now:');
      console.log('1. Place an outbound call to', TARGET_PHONE);
      console.log('2. Connect to OpenAI Realtime for voice interaction');
      console.log('3. Conduct a heart failure symptom assessment');
      console.log('4. Collect voice biomarkers for risk analysis');
      console.log('5. Send results back to the callback URL');
      console.log('');
      console.log('Monitor the server logs for real-time updates.');
      
      // Optional: Check status after a delay
      setTimeout(async () => {
        console.log('');
        console.log('Checking call status...');
        try {
          const statusResponse = await fetch(`${SERVER_URL}/aigents/status/${chainRunId}`);
          const statusData = await statusResponse.json();
          console.log('Current Status:', statusData.status);
          if (statusData.call) {
            console.log('Call Status:', statusData.call.status);
            console.log('Call SID:', statusData.call.callSid);
          }
        } catch (error) {
          console.log('Could not fetch status:', error.message);
        }
      }, 5000);
      
    } else {
      console.error('❌ Failed to initiate call');
      console.error('Response:', responseData);
      if (responseData.details) {
        console.error('Validation errors:', JSON.stringify(responseData.details, null, 2));
      }
    }
    
  } catch (error) {
    console.error('❌ Error triggering call:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      const errorText = await error.response.text();
      console.error('Response body:', errorText);
    }
  }
}

// Run the test
triggerCall().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

// Keep the process alive to check status
setTimeout(() => {
  console.log('');
  console.log('Test completed. Exiting...');
  process.exit(0);
}, 30000);