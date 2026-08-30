

function createJarvisVoice(options) {
  options = options || {};
  var onStatus = typeof options.onStatus === 'function' ? options.onStatus : function(){};
  var onTranscript = typeof options.onTranscript === 'function' ? options.onTranscript : function(){};
  var onCommand = typeof options.onCommand === 'function' ? options.onCommand : function(){};

  var SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognizer = null;
  var listening = false;
  var speakingEnabled = options.speakingEnabled !== false; // on by default

  // ---- Speak (text-to-speech) ----
  function speak(text) {
    if (!speakingEnabled) return;
    if (!('speechSynthesis' in window)) {
      onStatus('Speech output not supported in this browser.');
      return;
    }
    try {
      window.speechSynthesis.cancel(); // don't let replies pile up and queue
      var utter = new SpeechSynthesisUtterance(text);
      utter.rate = options.rate || 1.02;
      utter.pitch = options.pitch || 0.85;
      if (options.voiceName) {
        var match = window.speechSynthesis.getVoices().find(function(v){ return v.name === options.voiceName; });
        if (match) utter.voice = match;
      }
      window.speechSynthesis.speak(utter);
    } catch (e) {
      onStatus('Speech output failed: ' + (e && e.message ? e.message : 'unknown error'));
    }
  }

  function setSpeakingEnabled(on) {
    speakingEnabled = !!on;
    if (!speakingEnabled && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }

  function isSpeakingEnabled() { return speakingEnabled; }

  // ---- Listen (speech-to-text) ----
  function ensureRecognizer() {
    if (recognizer) return recognizer;
    recognizer = new SpeechRecognitionAPI();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = options.lang || 'en-US';

    recognizer.onresult = function(e) {
      var last = e.results[e.results.length - 1];
      if (!last.isFinal) return;
      var transcript = last[0].transcript;
      onTranscript(transcript);
      onCommand(transcript);
    };

    recognizer.onerror = function(e) {
      onStatus('Voice error: ' + e.error);
      // "no-speech" and "aborted" are routine (silence, or a deliberate
      // stop) -- not worth surfacing as a failure the way a real
      // permission or hardware error is.
    };

    recognizer.onend = function() {
      // Browsers auto-stop recognition after a period of silence even in
      // continuous mode -- restart automatically if the caller hasn't
      // explicitly stopped it, so this behaves like a real always-on
      // listener instead of a one-shot that quietly dies.
      if (listening) {
        try { recognizer.start(); } catch (e) { /* already running */ }
      }
    };

    return recognizer;
  }

  function startListening() {
    if (!SpeechRecognitionAPI) {
      onStatus('Voice recognition not supported in this browser.');
      return false;
    }
    listening = true;
    ensureRecognizer();
    try {
      recognizer.start();
      onStatus('Listening…');
      return true;
    } catch (e) {
      // Most common real cause: already started, or mic permission
      // denied/blocked (including the iframe-permission-policy case
      // described at the top of this file).
      onStatus('Could not start listening: ' + (e && e.message ? e.message : 'unknown error'));
      return false;
    }
  }

  function stopListening() {
    listening = false;
    if (recognizer) {
      try { recognizer.stop(); } catch (e) {}
    }
    onStatus('Stopped.');
  }

  function isListening() { return listening; }

  function isSupported() {
    return {
      recognition: !!SpeechRecognitionAPI,
      synthesis: 'speechSynthesis' in window
    };
  }

  return {
    startListening: startListening,
    stopListening: stopListening,
    isListening: isListening,
    speak: speak,
    setSpeakingEnabled: setSpeakingEnabled,
    isSpeakingEnabled: isSpeakingEnabled,
    isSupported: isSupported
  };
}

// Exposes both as a global (drop-in <script> tag usage) and as a CommonJS
// export (if this ever gets bundled) -- covers both ways this might
// actually get used without assuming either.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createJarvisVoice: createJarvisVoice };
}
