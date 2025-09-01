import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const CallMonitor = ({ call, socket }) => {
  const [transcript, setTranscript] = useState([]);
  const [riskHistory, setRiskHistory] = useState([]);
  const [symptoms, setSymptoms] = useState({});
  const [voiceTasks, setVoiceTasks] = useState({
    sustained_ah: false,
    counting: false,
    reading: false,
  });

  useEffect(() => {
    // Listen for real-time updates
    socket.on('call:transcript', (data) => {
      if (data.callId === call.id) {
        setTranscript(prev => [...prev, data]);
      }
    });

    socket.on('call:biomarker', (data) => {
      if (data.callId === call.id) {
        setRiskHistory(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          risk: data.risk * 100,
        }]);
      }
    });

    socket.on('call:symptoms', (data) => {
      if (data.callId === call.id) {
        setSymptoms(data.symptoms);
      }
    });

    socket.on('call:voice_task', (data) => {
      if (data.callId === call.id) {
        setVoiceTasks(prev => ({
          ...prev,
          [data.task]: true,
        }));
      }
    });

    return () => {
      socket.off('call:transcript');
      socket.off('call:biomarker');
      socket.off('call:symptoms');
      socket.off('call:voice_task');
    };
  }, [call.id, socket]);

  const getRiskColor = (risk) => {
    if (risk >= 70) return '#ff4444';
    if (risk >= 50) return '#ffaa00';
    return '#44ff44';
  };

  const currentRisk = riskHistory.length > 0 
    ? riskHistory[riskHistory.length - 1].risk 
    : 0;

  return (
    <div className="call-monitor">
      <h3>Active Call Monitor</h3>
      
      <div className="monitor-header">
        <div className="call-info">
          <div>Call ID: {call.id}</div>
          <div>Phone: {call.phone}</div>
          <div>Duration: {call.duration || '00:00'}</div>
        </div>
      </div>

      <div className="risk-display">
        <h4>Biomarker Risk Score</h4>
        <div className="risk-gauge">
          <div 
            className="risk-value"
            style={{ color: getRiskColor(currentRisk) }}
          >
            {currentRisk.toFixed(1)}%
          </div>
          <div className="risk-bar">
            <div 
              className="risk-fill"
              style={{ 
                width: `${currentRisk}%`,
                backgroundColor: getRiskColor(currentRisk)
              }}
            />
          </div>
        </div>
        
        {riskHistory.length > 1 && (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={riskHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line 
                type="monotone" 
                dataKey="risk" 
                stroke="#8884d8" 
                name="Risk %"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="voice-tasks">
        <h4>Voice Tasks</h4>
        <div className="task-list">
          <div className={`task-item ${voiceTasks.sustained_ah ? 'completed' : ''}`}>
            {voiceTasks.sustained_ah ? '✓' : '○'} Sustained "Ah" (3x)
          </div>
          <div className={`task-item ${voiceTasks.counting ? 'completed' : ''}`}>
            {voiceTasks.counting ? '✓' : '○'} Count 1-30
          </div>
          <div className={`task-item ${voiceTasks.reading ? 'completed' : ''}`}>
            {voiceTasks.reading ? '✓' : '○'} Read Sentence
          </div>
        </div>
      </div>

      <div className="symptoms-tracker">
        <h4>Detected Symptoms</h4>
        <div className="symptom-grid">
          <div className={`symptom ${symptoms.dyspnea ? 'detected' : ''}`}>
            Shortness of Breath: {symptoms.dyspnea || 'None'}
          </div>
          <div className={`symptom ${symptoms.orthopnea ? 'detected' : ''}`}>
            Orthopnea: {symptoms.orthopnea ? 'Yes' : 'No'}
          </div>
          <div className={`symptom ${symptoms.edema ? 'detected' : ''}`}>
            Edema: {symptoms.edema || 'None'}
          </div>
          <div className={`symptom ${symptoms.chestPain ? 'detected' : ''}`}>
            Chest Pain: {symptoms.chestPain ? 'Yes' : 'No'}
          </div>
          <div className={`symptom ${symptoms.fatigue ? 'detected' : ''}`}>
            Fatigue: {symptoms.fatigue || 'None'}
          </div>
        </div>
      </div>

      <div className="transcript">
        <h4>Live Transcript</h4>
        <div className="transcript-box">
          {transcript.length === 0 ? (
            <p className="no-transcript">Waiting for conversation...</p>
          ) : (
            transcript.map((entry, index) => (
              <div key={index} className={`transcript-entry ${entry.role}`}>
                <span className="speaker">{entry.role}:</span>
                <span className="text">{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CallMonitor;