import React from 'react';

const CallQueue = ({ queue, onRefresh, apiBase }) => {
  const handleCancelCall = async (callId) => {
    try {
      const response = await fetch(`${apiBase}/test/call/${callId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to cancel call:', error);
    }
  };

  return (
    <div className="call-queue">
      <div className="queue-header">
        <h3>Call Queue ({queue.length} waiting)</h3>
        <button onClick={onRefresh} className="refresh-button">
          Refresh
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="empty-queue">No calls in queue</p>
      ) : (
        <div className="queue-list">
          {queue.map((item, index) => (
            <div key={item.id} className="queue-item">
              <div className="queue-position">#{index + 1}</div>
              <div className="queue-details">
                <div className="queue-phone">{item.phone}</div>
                <div className="queue-meta">
                  <span className={`priority ${item.priority}`}>
                    {item.priority}
                  </span>
                  <span className="status">{item.status}</span>
                </div>
                <div className="queue-time">
                  Queued: {new Date(item.queuedAt).toLocaleTimeString()}
                </div>
              </div>
              <button 
                onClick={() => handleCancelCall(item.id)}
                className="cancel-button"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CallQueue;