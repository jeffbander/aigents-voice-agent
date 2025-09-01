// Automated Testing Script for CHF Voice Assessment System
// This script can test the system automatically without manual intervention

const puppeteer = require('puppeteer');
const axios = require('axios');

const API_BASE = 'http://localhost:8080';
const FRONTEND_URL = 'http://localhost:3000';

// Test phone numbers (you can add multiple)
const TEST_PHONES = [
  '+16465565559',
  // Add more test numbers here
];

// Test scenarios
const TEST_SCENARIOS = [
  {
    name: 'Normal Patient - Low Risk',
    data: {
      name: 'John Doe - Low Risk',
      phone: TEST_PHONES[0],
      dob: '1960-01-01',
      mrn: 'TEST-LOW-001',
      medicalHistory: {
        bnp: 200,
        ejectionFraction: 55,
        medications: ['Lisinopril 10mg daily'],
        carePlan: 'Routine monitoring',
        recentHospitalization: false,
      },
      callObjective: 'Routine check-up',
      clinicalContext: 'Stable patient with mild HF',
    }
  },
  {
    name: 'High Risk Patient',
    data: {
      name: 'Jane Smith - High Risk',
      phone: TEST_PHONES[0],
      dob: '1955-03-15',
      mrn: 'TEST-HIGH-001',
      medicalHistory: {
        bnp: 900,
        ejectionFraction: 25,
        medications: [
          'Entresto 97/103mg BID',
          'Carvedilol 25mg BID',
          'Furosemide 80mg BID',
          'Spironolactone 50mg daily'
        ],
        carePlan: 'Close monitoring, fluid restriction',
        recentHospitalization: true,
      },
      customPrompt: 'Patient is high risk. Check for red flag symptoms carefully.',
      callObjective: 'Urgent symptom assessment post-hospitalization',
      clinicalContext: 'Recent HF exacerbation, discharged 3 days ago',
      priority: 'high'
    }
  },
  {
    name: 'Custom Prompt Test',
    data: {
      name: 'Custom Prompt Patient',
      phone: TEST_PHONES[0],
      dob: '1965-07-20',
      mrn: 'TEST-CUSTOM-001',
      medicalHistory: {
        bnp: 450,
        ejectionFraction: 35,
      },
      customPrompt: `You are a specialized heart failure nurse. 
        Focus specifically on:
        1. Weight changes in the last 48 hours
        2. Medication compliance
        3. Dietary sodium intake
        Keep the call brief, under 3 minutes.`,
      callObjective: 'Test custom prompt functionality',
      clinicalContext: 'Testing custom AI instructions',
    }
  }
];

class CHFTestAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.testResults = [];
  }

  async initialize() {
    console.log('🚀 Starting CHF Voice Assessment Test Automation');
    
    // Check if services are running
    await this.checkServices();
    
    // Launch browser
    this.browser = await puppeteer.launch({
      headless: false, // Set to true for headless testing
      defaultViewport: { width: 1400, height: 900 }
    });
    
    this.page = await this.browser.newPage();
    
    // Set up console logging from the page
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('Browser Error:', msg.text());
      }
    });
  }

  async checkServices() {
    console.log('🔍 Checking services...');
    
    try {
      // Check backend
      const backendHealth = await axios.get(`${API_BASE}/healthz`);
      console.log('✅ Backend is running:', backendHealth.data);
    } catch (error) {
      console.error('❌ Backend is not running. Please start it with: npm run dev');
      process.exit(1);
    }
    
    // Check if frontend is accessible
    try {
      await axios.get(FRONTEND_URL);
      console.log('✅ Frontend is accessible');
    } catch (error) {
      console.warn('⚠️ Frontend might not be running. Will try to continue...');
    }
  }

  async runTestScenario(scenario) {
    console.log(`\n📞 Running Test: ${scenario.name}`);
    console.log('═'.repeat(50));
    
    const startTime = Date.now();
    const result = {
      scenario: scenario.name,
      success: false,
      duration: 0,
      callId: null,
      errors: []
    };
    
    try {
      // Navigate to frontend
      await this.page.goto(FRONTEND_URL, { waitUntil: 'networkidle2' });
      
      // Fill in the form
      console.log('📝 Filling out form...');
      await this.fillForm(scenario.data);
      
      // Submit the form
      console.log('🚀 Triggering call...');
      await this.page.click('.submit-button');
      
      // Wait for response
      await this.page.waitForSelector('.response-message', { timeout: 10000 });
      
      // Check if call was queued successfully
      const responseText = await this.page.$eval('.response-message', el => el.textContent);
      console.log('📨 Response:', responseText);
      
      if (responseText.includes('Call Queued!')) {
        result.success = true;
        
        // Extract call ID
        const callIdMatch = responseText.match(/Call ID: (TEST-[\w-]+)/);
        if (callIdMatch) {
          result.callId = callIdMatch[1];
          console.log('✅ Call queued with ID:', result.callId);
        }
        
        // Wait a bit and check call status
        await this.delay(5000);
        await this.checkCallStatus(result.callId);
        
        // Monitor the call for a bit
        await this.monitorCall(result.callId, 30000); // Monitor for 30 seconds
        
      } else {
        result.errors.push('Failed to queue call');
        console.error('❌ Failed to queue call');
      }
      
    } catch (error) {
      result.errors.push(error.message);
      console.error('❌ Test failed:', error.message);
    }
    
    result.duration = Date.now() - startTime;
    this.testResults.push(result);
    
    return result;
  }

  async fillForm(data) {
    // Clear and fill patient name
    await this.clearAndType('input[name="name"]', data.name);
    
    // Phone number
    await this.clearAndType('input[name="phone"]', data.phone);
    
    // Date of birth
    if (data.dob) {
      await this.clearAndType('input[name="dob"]', data.dob);
    }
    
    // MRN
    if (data.mrn) {
      await this.clearAndType('input[name="mrn"]', data.mrn);
    }
    
    // Medical history
    if (data.medicalHistory) {
      if (data.medicalHistory.bnp) {
        await this.clearAndType('input[name="bnp"]', data.medicalHistory.bnp.toString());
      }
      
      if (data.medicalHistory.ejectionFraction) {
        await this.clearAndType('input[name="ejectionFraction"]', 
          data.medicalHistory.ejectionFraction.toString());
      }
      
      if (data.medicalHistory.medications) {
        await this.clearAndType('textarea[name="medications"]', 
          data.medicalHistory.medications.join('\n'));
      }
      
      if (data.medicalHistory.carePlan) {
        await this.clearAndType('textarea[name="carePlan"]', 
          data.medicalHistory.carePlan);
      }
      
      if (data.medicalHistory.recentHospitalization) {
        await this.page.click('input[name="recentHospitalization"]');
      }
    }
    
    // Call configuration
    if (data.callObjective) {
      await this.clearAndType('textarea[name="callObjective"]', data.callObjective);
    }
    
    if (data.clinicalContext) {
      await this.clearAndType('textarea[name="clinicalContext"]', data.clinicalContext);
    }
    
    if (data.customPrompt) {
      await this.clearAndType('textarea[name="customPrompt"]', data.customPrompt);
    }
    
    if (data.priority === 'high') {
      await this.page.select('select[name="priority"]', 'high');
    }
  }

  async clearAndType(selector, text) {
    await this.page.waitForSelector(selector);
    await this.page.click(selector, { clickCount: 3 }); // Select all
    await this.page.type(selector, text);
  }

  async checkCallStatus(callId) {
    try {
      const response = await axios.get(`${API_BASE}/test/call/${callId}`);
      console.log('📊 Call Status:', response.data.call.status);
      return response.data;
    } catch (error) {
      console.error('Failed to get call status:', error.message);
      return null;
    }
  }

  async monitorCall(callId, duration) {
    console.log(`👁️ Monitoring call for ${duration/1000} seconds...`);
    
    const endTime = Date.now() + duration;
    let lastStatus = null;
    
    while (Date.now() < endTime) {
      const callData = await this.checkCallStatus(callId);
      
      if (callData && callData.call.status !== lastStatus) {
        lastStatus = callData.call.status;
        console.log(`  Status changed to: ${lastStatus}`);
        
        if (lastStatus === 'completed') {
          console.log('✅ Call completed successfully!');
          
          if (callData.call.summary) {
            console.log('📋 Summary:', callData.call.summary);
          }
          
          if (callData.call.riskScore !== null) {
            console.log(`🎯 Risk Score: ${(callData.call.riskScore * 100).toFixed(1)}%`);
          }
          
          break;
        }
        
        if (lastStatus === 'failed') {
          console.error('❌ Call failed');
          break;
        }
      }
      
      await this.delay(5000); // Check every 5 seconds
    }
  }

  async runQueueTest() {
    console.log('\n🔄 Testing Call Queue System');
    console.log('═'.repeat(50));
    
    // Queue multiple calls rapidly
    const queuePromises = [];
    
    for (let i = 0; i < 3; i++) {
      const payload = {
        name: `Queue Test Patient ${i + 1}`,
        phone: TEST_PHONES[0],
        dob: '1960-01-01',
        mrn: `QUEUE-TEST-${i + 1}`,
        priority: i === 0 ? 'high' : 'normal',
        callObjective: `Queue test call ${i + 1}`,
      };
      
      queuePromises.push(
        axios.post(`${API_BASE}/test/trigger-call`, payload)
          .then(res => {
            console.log(`✅ Queued call ${i + 1}:`, res.data.callId);
            return res.data;
          })
          .catch(err => {
            console.error(`❌ Failed to queue call ${i + 1}:`, err.message);
            return null;
          })
      );
    }
    
    const queueResults = await Promise.all(queuePromises);
    
    // Check queue status
    const queueStatus = await axios.get(`${API_BASE}/test/queue`);
    console.log(`📊 Queue Status: ${queueStatus.data.queueLength} calls waiting`);
    
    // Cancel one call
    if (queueResults[2] && queueResults[2].callId) {
      console.log('🚫 Canceling last call...');
      await axios.delete(`${API_BASE}/test/call/${queueResults[2].callId}`);
      
      const newQueueStatus = await axios.get(`${API_BASE}/test/queue`);
      console.log(`📊 Updated Queue: ${newQueueStatus.data.queueLength} calls waiting`);
    }
  }

  async runStressTest() {
    console.log('\n⚡ Running Stress Test');
    console.log('═'.repeat(50));
    
    const concurrentCalls = 5;
    const promises = [];
    
    for (let i = 0; i < concurrentCalls; i++) {
      promises.push(
        axios.post(`${API_BASE}/test/trigger-call`, {
          name: `Stress Test ${i}`,
          phone: TEST_PHONES[0],
          priority: 'normal',
          callObjective: 'Stress test',
        }).catch(err => ({ error: err.message }))
      );
    }
    
    const results = await Promise.all(promises);
    const successful = results.filter(r => !r.error).length;
    
    console.log(`📊 Stress Test Results: ${successful}/${concurrentCalls} calls queued successfully`);
  }

  async generateReport() {
    console.log('\n📊 TEST REPORT');
    console.log('═'.repeat(50));
    
    const totalTests = this.testResults.length;
    const successfulTests = this.testResults.filter(r => r.success).length;
    const successRate = ((successfulTests / totalTests) * 100).toFixed(1);
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Successful: ${successfulTests}`);
    console.log(`Failed: ${totalTests - successfulTests}`);
    console.log(`Success Rate: ${successRate}%`);
    
    console.log('\nDetailed Results:');
    this.testResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.scenario}`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);
      if (result.callId) {
        console.log(`   Call ID: ${result.callId}`);
      }
      if (result.errors.length > 0) {
        console.log(`   Errors: ${result.errors.join(', ')}`);
      }
    });
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      await this.initialize();
      
      // Run individual test scenarios
      for (const scenario of TEST_SCENARIOS) {
        await this.runTestScenario(scenario);
        await this.delay(5000); // Wait between tests
      }
      
      // Run queue test
      await this.runQueueTest();
      
      // Run stress test
      await this.runStressTest();
      
      // Generate report
      await this.generateReport();
      
    } catch (error) {
      console.error('Fatal error:', error);
    } finally {
      await this.cleanup();
    }
  }
}

// Run the tests
const tester = new CHFTestAutomation();
tester.run().then(() => {
  console.log('\n✅ Test automation completed');
  process.exit(0);
}).catch(err => {
  console.error('❌ Test automation failed:', err);
  process.exit(1);
});