// DOM Elements
const settingsButton = document.getElementById('settingsButton');
const settingsPanel = document.getElementById('settingsPanel');
const saveSettingsButton = document.getElementById('saveSettings');
const audioDeviceSelect = document.getElementById('audioDevice');
const recordButton = document.getElementById('recordButton');
const recordingStatus = document.getElementById('recordingStatus');
const audioVisualizer = document.getElementById('audioVisualizer');
const transcriptionOutput = document.getElementById('transcriptionOutput');
const generateSummaryButton = document.getElementById('generateSummary');
const summaryOutput = document.getElementById('summaryOutput');
const systemStatus = document.getElementById('systemStatus');
const connectionStatus = document.getElementById('connectionStatus');

// Settings
const whisperEndpointInput = document.getElementById('whisperEndpoint');
const llmEndpointInput = document.getElementById('llmEndpoint');
const apiKeyInput = document.getElementById('apiKey');
const llmModelInput = document.getElementById('llmModel');

// App State
let isRecording = false;
let currentStream = null;
let mediaRecorder = null;
let audioContext = null;
let analyser = null;
let audioChunks = [];
let transcriptText = '';
let webSocket = null;

// Determine if we're running in Docker by checking the hostname
const isDockerEnvironment = window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !window.location.protocol.startsWith('file');

// Default settings with environment-aware endpoints
let settings = {
    whisperEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
    // Use ollama service name in Docker, localhost otherwise
    llmEndpoint: isDockerEnvironment
        ? 'http://ollama:11434/v1/chat/completions'
        : 'http://localhost:11434/v1/chat/completions',
    apiKey: '',
    llmModel: 'llama3'
};

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initializeAudioDevices();
    setupEventListeners();
    createAudioVisualizer();
    updateStatus('System initialized', 'Ready for recording');
});

// Load settings from localStorage
function loadSettings() {
    const savedSettings = localStorage.getItem('transcriptionSettings');
    if (savedSettings) {
        settings = JSON.parse(savedSettings);
        whisperEndpointInput.value = settings.whisperEndpoint;
        llmEndpointInput.value = settings.llmEndpoint;
        apiKeyInput.value = settings.apiKey;
        llmModelInput.value = settings.llmModel;
    }
}

// Save settings to localStorage
function saveSettings() {
    settings.whisperEndpoint = whisperEndpointInput.value;
    settings.llmEndpoint = llmEndpointInput.value;
    settings.apiKey = apiKeyInput.value;
    settings.llmModel = llmModelInput.value;

    localStorage.setItem('transcriptionSettings', JSON.stringify(settings));
    settingsPanel.classList.add('hidden');
    updateStatus('Settings saved', 'Configuration updated');
}

// Initialize audio devices
async function initializeAudioDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputDevices = devices.filter(device => device.kind === 'audioinput');

        audioDeviceSelect.innerHTML = '';
        audioInputDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microphone ${audioDeviceSelect.length + 1}`;
            audioDeviceSelect.appendChild(option);
        });

        if (audioInputDevices.length === 0) {
            updateStatus('No audio devices found', 'Check microphone permissions', 'warning');
        }
    } catch (error) {
        console.error('Error accessing media devices:', error);
        updateStatus('Device error', 'Cannot access audio devices', 'error');
    }
}

// Set up event listeners
function setupEventListeners() {
    // Settings panel toggle
    settingsButton.addEventListener('click', () => {
        settingsPanel.classList.toggle('hidden');
    });

    // Save settings
    saveSettingsButton.addEventListener('click', saveSettings);

    // Record button
    recordButton.addEventListener('click', toggleRecording);

    // Generate summary button
    generateSummaryButton.addEventListener('click', generateSummary);

    // Audio device change
    audioDeviceSelect.addEventListener('change', () => {
        if (isRecording) {
            stopRecording();
        }
    });
}

// Toggle recording state
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}
// Start recording audio
async function startRecording() {
    try {
        const deviceId = audioDeviceSelect.value;
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000 // Request 16kHz sample rate
            }
        });

        // Set up audio context for visualization and processing
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000 // Force 16kHz sample rate
            });
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
        }

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        // Clear previous transcript
        transcriptText = '';
        transcriptionOutput.innerHTML = '<div class="blinking-cursor"></div>';
        summaryOutput.innerHTML = '';
        generateSummaryButton.disabled = true;

        // Set up WebSocket connection
        setupWebSocketConnection();

        // Create a processor node with smaller buffer for lower latency
        const bufferSize = 4096;
        const mediaRecorder = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        // Store reference to stop it later
        currentStream = stream;
        
        source.connect(mediaRecorder);
        mediaRecorder.connect(audioContext.destination);

        mediaRecorder.onaudioprocess = function(e) {
            if (!isRecording) return;

            // Get the PCM data
            const inputBuffer = e.inputBuffer;
            const inputData = inputBuffer.getChannelData(0);

            // Convert to 16-bit PCM (s16le)
            const pcmBuffer = new ArrayBuffer(inputData.length * 2);
            const dataView = new DataView(pcmBuffer);

            for (let i = 0; i < inputData.length; i++) {
                // Convert float32 to int16 with proper scaling
                // Apply some gain to make the audio louder
                const gain = 1.2;
                const sample = Math.max(-1, Math.min(1, inputData[i] * gain));
                // Convert to int16 with proper scaling (-32768 to 32767)
                dataView.setInt16(i * 2, Math.round(sample * 32767), true); // true = little endian
            }

            // Send the binary data directly
            if (webSocket && webSocket.readyState === WebSocket.OPEN) {
                streamAudioChunkViaWebSocket(pcmBuffer);
            }
        };

        // Start recording
        isRecording = true;
        recordButton.textContent = 'Stop Recording';
        recordButton.classList.add('recording');
        recordingStatus.textContent = 'Recording...';
        updateStatus('Recording active', 'Streaming 16kHz PCM audio to transcription service');

        // Start visualizer animation
        createAudioVisualizer();

    } catch (error) {
        console.error('Error starting recording:', error);
        updateStatus('Recording error', error.message, 'error');
    }
}

// Set up WebSocket connection
function setupWebSocketConnection() {
    const model = 'Systran/faster-whisper-large-v3';
    const language = 'de';
    const responseFormat = 'json';
    const temperature = '0';

    const wsUrl = `ws://${settings.whisperEndpoint}?model=${encodeURIComponent(model)}&language=${encodeURIComponent(language)}&response_format=${encodeURIComponent(responseFormat)}&temperature=${encodeURIComponent(temperature)}`;

    webSocket = new WebSocket(wsUrl);

    webSocket.onopen = () => {
        console.log('WebSocket connection established');
        updateStatus('WebSocket connected', 'Ready to stream audio');
    };

    webSocket.onmessage = (event) => {
        try {
            const response = JSON.parse(event.data);
            console.log('WebSocket Response:', response);

            // Update the transcription
            if (response.text) {
                appendTranscription(response.text);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    webSocket.onclose = () => {
        console.log('WebSocket connection closed');
    };

    webSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('WebSocket error', 'Connection to transcription service failed', 'error');
    };
}

// Stream audio chunk via WebSocket
function streamAudioChunkViaWebSocket(audioChunk) {
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
        return
    }
    webSocket.send(audioChunk);
}

// Stop recording audio
function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        mediaRecorder.disconnect();
    }
    // Close WebSocket connection
    if (webSocket) {
        webSocket.close();
    }

    // Update UI
    isRecording = false;
    recordButton.textContent = 'Start Recording';
    recordButton.classList.remove('recording');
    recordingStatus.textContent = 'Recording stopped';
    updateStatus('Recording stopped', 'Processing complete');

    // Enable summary generation
    if (transcriptText.trim().length > 0) {
        generateSummaryButton.disabled = false;
    }

}

// Append transcription text to the output
function appendTranscription(text) {
    // Remove any duplicate text that might be in the new chunk
    const newText = removeDuplicateText(transcriptText, text);

    if (newText.trim().length > 0) {
        // Add the new text to the transcript
        transcriptText += newText;

        // Create a new span for the streaming effect
        const textSpan = document.createElement('span');
        textSpan.textContent = newText;
        textSpan.classList.add('streaming-text');

        // Remove the blinking cursor
        const cursor = transcriptionOutput.querySelector('.blinking-cursor');
        if (cursor) {
            transcriptionOutput.removeChild(cursor);
        }

        // Add the new text and cursor
        transcriptionOutput.appendChild(textSpan);
        transcriptionOutput.appendChild(document.createElement('div')).classList.add('blinking-cursor');

        // Scroll to the bottom
        transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
    }
}

// Remove duplicate text that might be in the new chunk
function removeDuplicateText(existingText, newChunk) {
    if (!existingText) return newChunk;

    // Check for overlapping content at the end of existing text and start of new chunk
    const maxOverlapLength = Math.min(existingText.length, newChunk.length);

    for (let overlapLength = maxOverlapLength; overlapLength > 0; overlapLength--) {
        const existingEnd = existingText.slice(-overlapLength);
        const newStart = newChunk.slice(0, overlapLength);

        if (existingEnd === newStart) {
            return newChunk.slice(overlapLength);
        }
    }

    return newChunk;
}

// Generate summary from transcript
async function generateSummary() {
    if (!transcriptText || transcriptText.trim().length === 0) {
        updateStatus('Summary error', 'No transcript available', 'warning');
        return;
    }

    try {
        updateStatus('Generating summary', 'Processing transcript');
        summaryOutput.innerHTML = '<div class="blinking-cursor"></div>';

        // Prepare the request for the LLM API
        const requestBody = {
            model: settings.llmModel,
            messages: [
                {
                    role: "system",
                    content: "You are an assistant to a german doctor. Create something called an Artzbrief. This is a structured summary of the diagnosis discussed in the conversation. Ignore non-medical conversation"
                },
                {
                    role: "user",
                    content: `Please create an Artzbrief in german out of the transcript of the doctor speech: ${transcriptText}`
                }
            ],
            stream: true
        };

        // Set up headers
        const headers = {
            'Content-Type': 'application/json'
        };

        if (settings.apiKey) {
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }

        // Make the request to the LLM API with streaming
        const response = await fetch(settings.llmEndpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        // Clear the summary output
        summaryOutput.innerHTML = '';

        // Process the streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let summaryText = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            // Decode the chunk
            const chunk = decoder.decode(value, { stream: true });

            // Process the chunk (handle SSE format)
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                    try {
                        const data = JSON.parse(line.substring(6));
                        if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                            const content = data.choices[0].delta.content;
                            appendSummaryText(content);
                            summaryText += content;
                        }
                    } catch (e) {
                        console.warn('Error parsing JSON from stream:', e);
                    }
                }
            }
        }

        updateStatus('Summary complete', 'Processing finished');

    } catch (error) {
        console.error('Error generating summary:', error);
        updateStatus('Summary error', error.message, 'error');
        summaryOutput.innerHTML = `<span style="color: var(--status-error);">Error generating summary: ${error.message}</span>`;
    }
}

// Append summary text with streaming effect
function appendSummaryText(text) {
    // Create a new span for the streaming effect
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    textSpan.classList.add('streaming-text');

    // Add the new text
    summaryOutput.appendChild(textSpan);

    // Scroll to the bottom
    summaryOutput.scrollTop = summaryOutput.scrollHeight;
}

// Create and animate the audio visualizer
function createAudioVisualizer() {
    const canvas = document.createElement('canvas');
    canvas.width = audioVisualizer.clientWidth;
    canvas.height = audioVisualizer.clientHeight;
    audioVisualizer.appendChild(canvas);

    const canvasContext = canvas.getContext('2d');

    function drawVisualizer() {
        if (!isRecording || !analyser) {
            // Draw a flat line when not recording
            canvasContext.clearRect(0, 0, canvas.width, canvas.height);
            canvasContext.beginPath();
            canvasContext.moveTo(0, canvas.height / 2);
            canvasContext.lineTo(canvas.width, canvas.height / 2);
            canvasContext.strokeStyle = 'rgba(0, 229, 255, 0.2)';
            canvasContext.stroke();
            return;
        }

        // Get frequency data
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Clear canvas
        canvasContext.clearRect(0, 0, canvas.width, canvas.height);

        // Draw visualizer
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i] / 2;

            // Use Star Trek colors
            const hue = i / bufferLength * 120 + 180; // Blue to teal range
            canvasContext.fillStyle = `hsla(${hue}, 100%, 50%, 0.7)`;

            canvasContext.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    function animateVisualizer() {
        drawVisualizer();
        requestAnimationFrame(animateVisualizer);
    }

    // Start the animation
    animateVisualizer();
}

// Update status displays
function updateStatus(system, connection, type = 'normal') {
    systemStatus.textContent = system;
    connectionStatus.textContent = connection;

    // Update status indicators
    const indicators = [systemStatus.previousElementSibling, connectionStatus.previousElementSibling];

    indicators.forEach(indicator => {
        if (indicator) {
            // Reset classes
            indicator.style.backgroundColor = '';

            // Apply appropriate color
            if (type === 'error') {
                indicator.style.backgroundColor = 'var(--status-error)';
            } else if (type === 'warning') {
                indicator.style.backgroundColor = 'var(--status-warning)';
            } else {
                indicator.style.backgroundColor = 'var(--status-good)';
            }
        }
    });
}

// Handle window resize for canvas
window.addEventListener('resize', () => {
    if (audioVisualizer.querySelector('canvas')) {
        const canvas = audioVisualizer.querySelector('canvas');
        canvas.width = audioVisualizer.clientWidth;
    }
});
