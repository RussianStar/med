I want a web based tool for a two staged process. First I want a record interface for selecting an input device and recording audio. The audio should be streamed to a live transcription endpoint of an openai whisper compatible service. The result should be streamed into a prominent text interface.

The second stage is taking the transcript and generating an summary out of that. For this an llm with openai compatible specification should be used. 

Make sure all streaming parts are implemented well, meaning the audio input should be streamed to the server and the resulting transcript should be streamed back. Likewise the result of the summary should also be streamed back. Check that there are no duplicated fragments when the audio is being streamed back.

Both endpoints should be editable in a settings section and visually not prominient. They are changed rarely. 


The overall ui style should be like medicine in the star trek universe, stick to its visual language.  
