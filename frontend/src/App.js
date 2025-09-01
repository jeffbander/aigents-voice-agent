import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import CallTrigger from './components/CallTrigger';
import CallQueue from './components/CallQueue';
import CallMonitor from './components/CallMonitor';
import ResultsDisplay from './components/ResultsDisplay';
import './App.css';

const API_BASE = 'http://localhost:8080';
const socket = io(API_BASE);

function App() {
  const [queue, setQueue] = useState([]);
  const [activeCall, setActiveCall] = useState(null);
  const [recentCalls, setRecentCalls] = useState([]);
  const [selectedCall, setSelectedCall] = useState(null);

  useEffect(() => {
    // Connect to WebSocket for real-time updates
    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('queue:update', (data) => {
      setQueue(data.queue || []);
    });

    socket.on('call:update', (data) => {
      if (data.status === 'active') {
        setActiveCall(data);
      } else if (data.status === 'completed') {
        setActiveCall(null);
        fetchRecentCalls();
      }
    });

    // Fetch initial data
    fetchQueue();
    fetchRecentCalls();

    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchQueue = async () => {
    try {
      const response = await fetch(`${API_BASE}/test/queue`);
      const data = await response.json();
      setQueue(data.queue || []);
    } catch (error) {
      console.error('Failed to fetch queue:', error);
    }
  };

  const fetchRecentCalls = async () => {
    try {
      const response = await fetch(`${API_BASE}/test/calls`);
      const data = await response.json();
      setRecentCalls(data.calls || []);
    } catch (error) {
      console.error('Failed to fetch calls:', error);
    }
  };

  const handleCallTriggered = (callData) => {
    console.log('Call triggered:', callData);
    fetchQueue();
  };

  const handleCallSelect = async (callId) => {
    try {
      const response = await fetch(`${API_BASE}/test/call/${callId}`);
      const data = await response.json();
      setSelectedCall(data);
    } catch (error) {
      console.error('Failed to fetch call details:', error);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>CHF Voice Assessment Testing Interface</h1>
        <p>Test calls without authentication - Development Only</p>
      </header>

      <div className="container">
        <div className="row">
          <div className="col-md-6">
            <CallTrigger 
              onCallTriggered={handleCallTriggered}
              apiBase={API_BASE}
            />
            <CallQueue 
              queue={queue}
              onRefresh={fetchQueue}
              apiBase={API_BASE}
            />
          </div>
          
          <div className="col-md-6">
            {activeCall && (
              <CallMonitor 
                call={activeCall}
                socket={socket}
              />
            )}
            
            <ResultsDisplay 
              recentCalls={recentCalls}
              selectedCall={selectedCall}
              onSelectCall={handleCallSelect}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
