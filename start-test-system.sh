#!/bin/bash

echo "🚀 Starting CHF Voice Assessment Test System"
echo "==========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if a port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Start backend service
echo -e "${YELLOW}Starting backend service...${NC}"
cd services/voice-bridge

if check_port 8080; then
    echo -e "${GREEN}✓ Backend already running on port 8080${NC}"
else
    echo "Installing backend dependencies..."
    npm install
    echo "Starting backend..."
    npm run dev &
    BACKEND_PID=$!
    echo "Backend started with PID: $BACKEND_PID"
    sleep 5
fi

# Start biomarker service (optional)
echo -e "${YELLOW}Starting biomarker service...${NC}"
cd ../../packages/biomarker-service

if check_port 9091; then
    echo -e "${GREEN}✓ Biomarker service already running on port 9091${NC}"
else
    echo "Starting biomarker service..."
    python biomarker_service.py &
    BIOMARKER_PID=$!
    echo "Biomarker service started with PID: $BIOMARKER_PID"
    sleep 3
fi

# Start frontend
echo -e "${YELLOW}Starting frontend...${NC}"
cd ../../frontend

if check_port 3000; then
    echo -e "${GREEN}✓ Frontend already running on port 3000${NC}"
else
    echo "Installing frontend dependencies..."
    npm install
    echo "Starting frontend..."
    npm start &
    FRONTEND_PID=$!
    echo "Frontend started with PID: $FRONTEND_PID"
    sleep 5
fi

# Display status
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ All services started successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "📱 Frontend: http://localhost:3000"
echo "🔧 Backend API: http://localhost:8080"
echo "🧬 Biomarker Service: ws://localhost:9091"
echo ""
echo "📋 Available Endpoints:"
echo "  - Trigger Call: POST http://localhost:8080/test/trigger-call"
echo "  - Queue Status: GET http://localhost:8080/test/queue"
echo "  - Recent Calls: GET http://localhost:8080/test/calls"
echo ""
echo "🧪 To run automated tests:"
echo "  cd frontend && node test-automation.js"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for user to stop
trap "echo 'Stopping services...'; kill $BACKEND_PID $FRONTEND_PID $BIOMARKER_PID 2>/dev/null; exit" INT

wait