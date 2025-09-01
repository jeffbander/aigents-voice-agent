import React from 'react';

const ResultsDisplay = ({ recentCalls, selectedCall, onSelectCall }) => {
  const getRiskBadge = (risk) => {
    if (!risk) return null;
    const value = parseFloat(risk) * 100;
    let className = 'risk-badge ';
    if (value >= 70) className += 'high';
    else if (value >= 50) className += 'moderate';
    else className += 'low';
    
    return <span className={className}>{value.toFixed(1)}%</span>;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="results-display">
      <h3>Assessment Results</h3>

      {selectedCall && (
        <div className="selected-call-details">
          <h4>Call Details: {selectedCall.call.id}</h4>
          
          <div className="call-summary">
            <div className="summary-header">
              <div>Phone: {selectedCall.call.phone}</div>
              <div>Duration: {formatDuration(selectedCall.call.duration)}</div>
              <div>Risk: {getRiskBadge(selectedCall.call.riskScore)}</div>
            </div>

            {selectedCall.call.summary && (
              <div className="summary-content">
                <h5>Summary</h5>
                {selectedCall.call.summary.summary && (
                  <ul>
                    {selectedCall.call.summary.summary.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}

                {selectedCall.call.summary.recommendation && (
                  <div className="recommendation">
                    <strong>Recommendation:</strong> {selectedCall.call.summary.recommendation}
                  </div>
                )}

                {selectedCall.call.summary.red_flags && (
                  <div className="red-flags">
                    <strong>⚠️ Red Flags Detected</strong>
                  </div>
                )}

                {selectedCall.call.summary.symptoms && (
                  <div className="symptoms-summary">
                    <h5>Symptoms Assessed</h5>
                    <div className="symptom-list">
                      {Object.entries(selectedCall.call.summary.symptoms).map(([key, value]) => (
                        <div key={key} className="symptom-item">
                          <span className="symptom-key">{key}:</span>
                          <span className="symptom-value">{value || 'None'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedCall.call.summary.transcript_snippets && (
                  <div className="transcript-snippets">
                    <h5>Key Moments</h5>
                    {selectedCall.call.summary.transcript_snippets.map((snippet, i) => (
                      <div key={i} className="snippet">"{snippet}"</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedCall.events && selectedCall.events.length > 0 && (
              <div className="call-events">
                <h5>Call Events</h5>
                <div className="events-timeline">
                  {selectedCall.events.map((event, i) => (
                    <div key={i} className="event-item">
                      <div className="event-time">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </div>
                      <div className="event-type">{event.type}</div>
                      {event.data && (
                        <div className="event-data">
                          {JSON.stringify(event.data, null, 2)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={() => onSelectCall(null)}
            className="close-details"
          >
            Close Details
          </button>
        </div>
      )}

      <div className="recent-calls">
        <h4>Recent Calls</h4>
        {recentCalls.length === 0 ? (
          <p>No calls yet</p>
        ) : (
          <div className="calls-list">
            {recentCalls.map(call => (
              <div 
                key={call.id} 
                className="call-item"
                onClick={() => onSelectCall(call.id)}
              >
                <div className="call-header">
                  <span className="call-id">{call.id.substring(0, 20)}...</span>
                  <span className={`call-status ${call.status}`}>{call.status}</span>
                </div>
                <div className="call-meta">
                  <span>Phone: {call.phone}</span>
                  <span>Duration: {formatDuration(call.duration)}</span>
                  {getRiskBadge(call.riskScore)}
                </div>
                <div className="call-time">
                  {new Date(call.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultsDisplay;