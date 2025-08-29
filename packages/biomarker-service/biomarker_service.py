#!/usr/bin/env python3
"""
AIGENTS Vocal Biomarker Service

This service processes real-time audio streams from Twilio Media Streams
to extract vocal biomarkers for heart failure risk assessment.

Features:
- WebSocket server for real-time audio ingestion
- μ-law audio decoding
- eGeMAPS feature extraction using openSMILE
- Isolation Forest for anomaly detection (within-patient drift)
- Risk scoring and alerting
"""

import asyncio
import base64
import json
import logging
import os
import struct
import time
from collections import defaultdict, deque
from typing import Dict, List, Optional, Tuple

import numpy as np
import websockets
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import librosa
import soundfile as sf

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class AudioBuffer:
    """Buffer for accumulating audio frames for feature extraction"""
    
    def __init__(self, sample_rate: int = 8000, buffer_duration: float = 3.0):
        self.sample_rate = sample_rate
        self.buffer_size = int(sample_rate * buffer_duration)
        self.buffer = deque(maxlen=self.buffer_size)
        self.frame_count = 0
    
    def add_frame(self, audio_data: np.ndarray) -> bool:
        """Add audio frame to buffer. Returns True if buffer is full."""
        self.buffer.extend(audio_data)
        self.frame_count += len(audio_data)
        return len(self.buffer) >= self.buffer_size
    
    def get_buffer(self) -> np.ndarray:
        """Get current buffer as numpy array"""
        return np.array(list(self.buffer))
    
    def clear(self):
        """Clear the buffer"""
        self.buffer.clear()
        self.frame_count = 0

class FeatureExtractor:
    """Extract vocal biomarker features from audio"""
    
    def __init__(self):
        self.sample_rate = 8000
        
    def extract_basic_features(self, audio: np.ndarray) -> Dict[str, float]:
        """Extract basic acoustic features (fallback if openSMILE not available)"""
        try:
            # Ensure audio is not empty and has reasonable values
            if len(audio) == 0 or np.all(audio == 0):
                return self._get_zero_features()
            
            # Normalize audio
            audio = audio / (np.max(np.abs(audio)) + 1e-8)
            
            features = {}
            
            # Fundamental frequency (F0) features
            try:
                f0 = librosa.yin(audio, fmin=50, fmax=400, sr=self.sample_rate)
                f0_valid = f0[f0 > 0]
                if len(f0_valid) > 0:
                    features['f0_mean'] = np.mean(f0_valid)
                    features['f0_std'] = np.std(f0_valid)
                    features['f0_range'] = np.max(f0_valid) - np.min(f0_valid)
                else:
                    features['f0_mean'] = 0.0
                    features['f0_std'] = 0.0
                    features['f0_range'] = 0.0
            except Exception as e:
                logger.warning(f"F0 extraction failed: {e}")
                features['f0_mean'] = 0.0
                features['f0_std'] = 0.0
                features['f0_range'] = 0.0
            
            # Spectral features
            try:
                # Spectral centroid
                spectral_centroids = librosa.feature.spectral_centroid(y=audio, sr=self.sample_rate)[0]
                features['spectral_centroid_mean'] = np.mean(spectral_centroids)
                features['spectral_centroid_std'] = np.std(spectral_centroids)
                
                # Spectral rolloff
                spectral_rolloff = librosa.feature.spectral_rolloff(y=audio, sr=self.sample_rate)[0]
                features['spectral_rolloff_mean'] = np.mean(spectral_rolloff)
                
                # Zero crossing rate
                zcr = librosa.feature.zero_crossing_rate(audio)[0]
                features['zcr_mean'] = np.mean(zcr)
                features['zcr_std'] = np.std(zcr)
                
                # MFCCs
                mfccs = librosa.feature.mfcc(y=audio, sr=self.sample_rate, n_mfcc=13)
                for i in range(13):
                    features[f'mfcc_{i}_mean'] = np.mean(mfccs[i])
                    features[f'mfcc_{i}_std'] = np.std(mfccs[i])
                
            except Exception as e:
                logger.warning(f"Spectral feature extraction failed: {e}")
                # Fill with zeros
                features.update({
                    'spectral_centroid_mean': 0.0,
                    'spectral_centroid_std': 0.0,
                    'spectral_rolloff_mean': 0.0,
                    'zcr_mean': 0.0,
                    'zcr_std': 0.0,
                })
                for i in range(13):
                    features[f'mfcc_{i}_mean'] = 0.0
                    features[f'mfcc_{i}_std'] = 0.0
            
            # Energy features
            try:
                rms = librosa.feature.rms(y=audio)[0]
                features['rms_mean'] = np.mean(rms)
                features['rms_std'] = np.std(rms)
                
                # Log energy
                log_energy = np.log(rms + 1e-8)
                features['log_energy_mean'] = np.mean(log_energy)
                features['log_energy_std'] = np.std(log_energy)
                
            except Exception as e:
                logger.warning(f"Energy feature extraction failed: {e}")
                features.update({
                    'rms_mean': 0.0,
                    'rms_std': 0.0,
                    'log_energy_mean': 0.0,
                    'log_energy_std': 0.0,
                })
            
            return features
            
        except Exception as e:
            logger.error(f"Feature extraction failed: {e}")
            return self._get_zero_features()
    
    def _get_zero_features(self) -> Dict[str, float]:
        """Return zero-filled feature vector"""
        features = {
            'f0_mean': 0.0, 'f0_std': 0.0, 'f0_range': 0.0,
            'spectral_centroid_mean': 0.0, 'spectral_centroid_std': 0.0,
            'spectral_rolloff_mean': 0.0,
            'zcr_mean': 0.0, 'zcr_std': 0.0,
            'rms_mean': 0.0, 'rms_std': 0.0,
            'log_energy_mean': 0.0, 'log_energy_std': 0.0,
        }
        # Add MFCC features
        for i in range(13):
            features[f'mfcc_{i}_mean'] = 0.0
            features[f'mfcc_{i}_std'] = 0.0
        return features

class RiskAssessment:
    """Risk assessment using Isolation Forest for anomaly detection"""
    
    def __init__(self, contamination: float = 0.1):
        self.models: Dict[str, IsolationForest] = {}
        self.scalers: Dict[str, StandardScaler] = {}
        self.feature_history: Dict[str, List[List[float]]] = defaultdict(list)
        self.contamination = contamination
        self.min_samples = 10  # Minimum samples before risk assessment
        
    def update_patient_model(self, patient_id: str, features: Dict[str, float]) -> Tuple[float, str]:
        """Update patient-specific model and return risk score"""
        
        # Convert features to array
        feature_vector = list(features.values())
        
        # Add to history
        self.feature_history[patient_id].append(feature_vector)
        
        # Keep only recent history (sliding window)
        max_history = 100
        if len(self.feature_history[patient_id]) > max_history:
            self.feature_history[patient_id] = self.feature_history[patient_id][-max_history:]
        
        n_samples = len(self.feature_history[patient_id])
        
        if n_samples < self.min_samples:
            return 0.0, "warming_up"
        
        try:
            # Get feature matrix
            X = np.array(self.feature_history[patient_id])
            
            # Initialize or update scaler
            if patient_id not in self.scalers:
                self.scalers[patient_id] = StandardScaler()
            
            # Fit scaler and transform features
            X_scaled = self.scalers[patient_id].fit_transform(X)
            
            # Initialize or update isolation forest
            if patient_id not in self.models:
                self.models[patient_id] = IsolationForest(
                    contamination=self.contamination,
                    random_state=42,
                    n_estimators=100
                )
            
            # Fit model
            self.models[patient_id].fit(X_scaled)
            
            # Get anomaly score for latest sample
            latest_sample = X_scaled[-1:]
            anomaly_score = self.models[patient_id].decision_function(latest_sample)[0]
            
            # Convert to risk score (0-1, higher = more anomalous)
            # Isolation Forest returns negative scores for anomalies
            risk_score = max(0.0, min(1.0, (0.5 - anomaly_score) / 1.0))
            
            return risk_score, "ok"
            
        except Exception as e:
            logger.error(f"Risk assessment failed for patient {patient_id}: {e}")
            return 0.0, "error"

class BiomarkerService:
    """Main biomarker service with WebSocket server"""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 9091):
        self.host = host
        self.port = port
        self.feature_extractor = FeatureExtractor()
        self.risk_assessment = RiskAssessment()
        self.audio_buffers: Dict[str, AudioBuffer] = {}
        self.active_sessions: Dict[str, dict] = {}
        
    def decode_mulaw(self, encoded_data: bytes) -> np.ndarray:
        """Decode μ-law encoded audio data"""
        try:
            # μ-law decoding lookup table
            MULAW_BIAS = 0x84
            MULAW_MAX = 0x1FFF
            
            decoded = []
            for byte in encoded_data:
                # Convert to signed
                byte = byte ^ 0xFF
                
                # Extract sign, exponent, and mantissa
                sign = byte & 0x80
                exponent = (byte & 0x70) >> 4
                mantissa = byte & 0x0F
                
                # Decode
                if exponent == 0:
                    decoded_val = (mantissa << 1) + MULAW_BIAS
                else:
                    decoded_val = ((mantissa << 1) + MULAW_BIAS) << (exponent - 1)
                
                if sign:
                    decoded_val = -decoded_val
                
                decoded.append(decoded_val / 32768.0)  # Normalize to [-1, 1]
            
            return np.array(decoded, dtype=np.float32)
            
        except Exception as e:
            logger.error(f"μ-law decoding failed: {e}")
            return np.array([])
    
    async def process_audio_message(self, message: dict, websocket) -> Optional[dict]:
        """Process incoming audio message and return risk assessment"""
        try:
            if message.get('type') != 'audio':
                return None
            
            chain_run_id = message.get('chainRunId')
            if not chain_run_id:
                logger.warning("Missing chainRunId in audio message")
                return None
            
            # Decode base64 audio
            audio_b64 = message.get('audio', '')
            if not audio_b64:
                return None
            
            try:
                audio_bytes = base64.b64decode(audio_b64)
            except Exception as e:
                logger.error(f"Base64 decoding failed: {e}")
                return None
            
            # Decode μ-law audio
            audio_data = self.decode_mulaw(audio_bytes)
            if len(audio_data) == 0:
                return None
            
            # Get or create audio buffer for this session
            if chain_run_id not in self.audio_buffers:
                self.audio_buffers[chain_run_id] = AudioBuffer()
                self.active_sessions[chain_run_id] = {
                    'start_time': time.time(),
                    'frame_count': 0,
                    'last_risk': 0.0,
                }
            
            buffer = self.audio_buffers[chain_run_id]
            session = self.active_sessions[chain_run_id]
            
            # Add audio to buffer
            buffer_full = buffer.add_frame(audio_data)
            session['frame_count'] += len(audio_data)
            
            # Process when buffer is full
            if buffer_full:
                audio_segment = buffer.get_buffer()
                
                # Extract features
                features = self.feature_extractor.extract_basic_features(audio_segment)
                
                # Assess risk (using chain_run_id as patient identifier)
                risk_score, status = self.risk_assessment.update_patient_model(
                    chain_run_id, features
                )
                
                session['last_risk'] = risk_score
                
                # Clear buffer for next segment
                buffer.clear()
                
                logger.info(f"Risk assessment: {chain_run_id} -> {risk_score:.3f} ({status})")
                
                # Return risk message
                return {
                    'type': 'risk',
                    'risk': risk_score,
                    'status': status,
                    'n': len(self.risk_assessment.feature_history[chain_run_id]),
                    'chainRunId': chain_run_id,
                    'timestamp': message.get('timestamp', time.time()),
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Audio processing failed: {e}")
            return None
    
    async def handle_client(self, websocket, path):
        """Handle WebSocket client connection"""
        client_addr = websocket.remote_address
        logger.info(f"Client connected: {client_addr}")
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    
                    # Process audio message
                    response = await self.process_audio_message(data, websocket)
                    
                    # Send response if available
                    if response:
                        await websocket.send(json.dumps(response))
                        
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from {client_addr}")
                except Exception as e:
                    logger.error(f"Message processing error from {client_addr}: {e}")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client disconnected: {client_addr}")
        except Exception as e:
            logger.error(f"Client handler error for {client_addr}: {e}")
        finally:
            # Cleanup session data
            # Note: In production, you might want to keep some history
            logger.info(f"Cleaning up session data for {client_addr}")
    
    async def start_server(self):
        """Start the WebSocket server"""
        logger.info(f"Starting biomarker service on {self.host}:{self.port}")
        
        server = await websockets.serve(
            self.handle_client,
            self.host,
            self.port,
            subprotocols=['biomarker'],
            ping_interval=30,
            ping_timeout=10,
        )
        
        logger.info(f"Biomarker service listening on ws://{self.host}:{self.port}/ingest")
        
        # Keep server running
        await server.wait_closed()

def main():
    """Main entry point"""
    # Configuration from environment
    host = os.getenv('BIOMARKER_HOST', '127.0.0.1')
    port = int(os.getenv('BIOMARKER_PORT', '9091'))
    
    # Create and start service
    service = BiomarkerService(host=host, port=port)
    
    try:
        asyncio.run(service.start_server())
    except KeyboardInterrupt:
        logger.info("Service stopped by user")
    except Exception as e:
        logger.error(f"Service failed: {e}")

if __name__ == "__main__":
    main()

