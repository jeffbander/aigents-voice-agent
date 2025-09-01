import React, { useState } from 'react';

const CallTrigger = ({ onCallTriggered, apiBase }) => {
  const [formData, setFormData] = useState({
    name: 'Test Patient',
    phone: '+16465565559',
    dob: '1960-01-01',
    mrn: 'TEST-001',
    
    // Medical history
    bnp: 450,
    ejectionFraction: 35,
    medications: 'Entresto 49/51mg BID\nCarvedilol 12.5mg BID\nFurosemide 40mg daily',
    carePlan: 'Daily weight monitoring, 2L fluid restriction, low sodium diet',
    recentHospitalization: false,
    lastTestDate: new Date().toISOString().split('T')[0],
    
    // Custom prompt
    customPrompt: '',
    callObjective: 'Routine CHF symptom assessment and medication adherence check',
    clinicalContext: 'Stable outpatient with heart failure with reduced ejection fraction',
    
    // Queue options
    priority: 'normal',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setLastResponse(null);

    try {
      const payload = {
        name: formData.name,
        phone: formData.phone,
        dob: formData.dob,
        mrn: formData.mrn,
        medicalHistory: {
          bnp: parseInt(formData.bnp),
          ejectionFraction: parseInt(formData.ejectionFraction),
          medications: formData.medications.split('\n').filter(m => m.trim()),
          carePlan: formData.carePlan,
          recentHospitalization: formData.recentHospitalization,
          lastTestDate: formData.lastTestDate,
        },
        customPrompt: formData.customPrompt || undefined,
        callObjective: formData.callObjective,
        clinicalContext: formData.clinicalContext,
        priority: formData.priority,
      };

      const response = await fetch(`${apiBase}/test/trigger-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      
      if (response.ok) {
        setLastResponse({ success: true, ...data });
        onCallTriggered(data);
      } else {
        setLastResponse({ success: false, error: data.error || 'Failed to trigger call' });
      }
    } catch (error) {
      setLastResponse({ success: false, error: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="call-trigger-form">
      <h2>Trigger Test Call</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="form-section">
          <h3>Patient Information</h3>
          
          <div className="form-group">
            <label>Name:</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Phone Number:</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleInputChange}
              placeholder="+1234567890"
              required
            />
          </div>

          <div className="form-group">
            <label>Date of Birth:</label>
            <input
              type="date"
              name="dob"
              value={formData.dob}
              onChange={handleInputChange}
            />
          </div>

          <div className="form-group">
            <label>MRN:</label>
            <input
              type="text"
              name="mrn"
              value={formData.mrn}
              onChange={handleInputChange}
            />
          </div>
        </div>

        <div className="form-section">
          <h3>Medical History</h3>
          
          <div className="form-group">
            <label>BNP Level:</label>
            <input
              type="number"
              name="bnp"
              value={formData.bnp}
              onChange={handleInputChange}
              min="0"
            />
          </div>

          <div className="form-group">
            <label>Ejection Fraction (%):</label>
            <input
              type="number"
              name="ejectionFraction"
              value={formData.ejectionFraction}
              onChange={handleInputChange}
              min="0"
              max="100"
            />
          </div>

          <div className="form-group">
            <label>Medications (one per line):</label>
            <textarea
              name="medications"
              value={formData.medications}
              onChange={handleInputChange}
              rows="4"
            />
          </div>

          <div className="form-group">
            <label>Care Plan:</label>
            <textarea
              name="carePlan"
              value={formData.carePlan}
              onChange={handleInputChange}
              rows="3"
            />
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="recentHospitalization"
                checked={formData.recentHospitalization}
                onChange={handleInputChange}
              />
              Recent Hospitalization
            </label>
          </div>

          <div className="form-group">
            <label>Last Test Date:</label>
            <input
              type="date"
              name="lastTestDate"
              value={formData.lastTestDate}
              onChange={handleInputChange}
            />
          </div>
        </div>

        <div className="form-section">
          <h3>Call Configuration</h3>
          
          <div className="form-group">
            <label>Call Objective:</label>
            <textarea
              name="callObjective"
              value={formData.callObjective}
              onChange={handleInputChange}
              rows="2"
            />
          </div>

          <div className="form-group">
            <label>Clinical Context:</label>
            <textarea
              name="clinicalContext"
              value={formData.clinicalContext}
              onChange={handleInputChange}
              rows="2"
            />
          </div>

          <div className="form-group">
            <label>Custom AI Prompt (optional):</label>
            <textarea
              name="customPrompt"
              value={formData.customPrompt}
              onChange={handleInputChange}
              rows="4"
              placeholder="Override the default system prompt..."
            />
          </div>

          <div className="form-group">
            <label>Priority:</label>
            <select
              name="priority"
              value={formData.priority}
              onChange={handleInputChange}
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <button 
          type="submit" 
          disabled={isSubmitting}
          className="submit-button"
        >
          {isSubmitting ? 'Triggering Call...' : 'Trigger Call'}
        </button>
      </form>

      {lastResponse && (
        <div className={`response-message ${lastResponse.success ? 'success' : 'error'}`}>
          {lastResponse.success ? (
            <div>
              <strong>Call Queued!</strong>
              <p>Call ID: {lastResponse.callId}</p>
              <p>Queue Position: {lastResponse.queuePosition}</p>
              <p>Estimated Wait: {lastResponse.estimatedWait}</p>
            </div>
          ) : (
            <div>
              <strong>Error:</strong> {lastResponse.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CallTrigger;