# Medical Transcription and Summarization Tool

A web-based tool for recording, transcribing, and summarizing medical audio, styled after Star Trek medical interfaces.

## Features

- **Audio Recording**: Select input device and record audio
- **Live Transcription**: Stream audio to a Whisper-compatible service for real-time transcription
- **Medical Summary**: Generate concise summaries from transcripts using an LLM
- **Configurable Endpoints**: Easily change API endpoints in the settings panel
- **Star Trek Medical UI**: Styled after medical interfaces from the Star Trek universe

## Setup

1. Open `index.html` in a modern web browser
2. Click the "Settings" button to configure your API endpoints:
   - **Whisper API Endpoint**: URL for the OpenAI Whisper-compatible transcription service
   - **LLM API Endpoint**: URL for the OpenAI-compatible LLM service (default: local Ollama at `http://localhost:11434/v1/chat/completions`)
   - **API Key**: Your API key (if required)
   - **LLM Model**: The model to use for summarization (default: `llama3`)

## Usage

1. **Select Audio Device**: Choose your microphone from the dropdown menu
2. **Record Audio**: Click "Start Recording" to begin capturing audio
3. **View Transcription**: Watch as your speech is transcribed in real-time
4. **Generate Summary**: After recording, click "Generate Summary" to create a medical summary of the transcript

## API Requirements

### Whisper-Compatible Transcription Service

The application is configured to work with any API that follows the OpenAI Whisper API format:
- Accepts POST requests with audio file in form data
- Returns JSON with a `text` field containing the transcription

### OpenAI-Compatible LLM Service

The application works with any LLM API that follows the OpenAI Chat Completions API format:
- Accepts POST requests with JSON body containing `model` and `messages`
- Supports streaming responses with Server-Sent Events (SSE)
- Compatible with Ollama, OpenAI, and other similar services

## Running the Application

### Local Development (Browser)

To run the application directly in your browser:

1. Clone this repository
2. Open `index.html` in your browser
3. Configure the API endpoints in the settings panel

### Using Docker

To run the application using Docker:

1. Make sure you have Docker and Docker Compose installed
2. Run the following command to start all services:
   ```
   docker-compose up -d
   ```
3. Access the application at `http://localhost:8080`
4. Access Ollama API at `http://localhost:11434`
5. Access Open WebUI at `http://localhost:7000`

To stop the services:
```
docker-compose down
```

#### Building Changes

If you make changes to the application, rebuild the container:
```
docker-compose build web-app
docker-compose up -d web-app
```

## Notes

- Audio is streamed in chunks to the transcription service
- The application implements duplicate text detection to prevent repeated text in transcriptions
- All settings are saved in your browser's localStorage
