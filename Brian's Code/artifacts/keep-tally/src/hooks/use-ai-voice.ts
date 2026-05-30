import { useRef, useCallback, useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type VoiceSupport = { hasSpeechRecognition: boolean; hasTTS: boolean };
export type ListenResult =
  | { ok: true; transcript: string }
  | { ok: false; reason: "microphone-denied" | "unsupported" | "silent" | "transcription-failed" | "aborted" };

export function getAIVoiceSupport(): VoiceSupport {
  return {
    hasSpeechRecognition: typeof MediaRecorder !== "undefined",
    hasTTS: true,
  };
}

/* ── Silence detection via Web Audio AnalyserNode ── */
const SILENCE_THRESHOLD = 8;      // RMS amplitude 0-100
const SILENCE_DURATION_MS = 1400; // stop after this many ms of silence
const MIN_RECORD_MS = 600;        // always record at least this long before silence-stop

function createSilenceDetector(stream: MediaStream, onSilence: () => void) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  let silenceStart: number | null = null;
  let startedAt = Date.now();
  let rafId: number;
  let triggered = false;

  function tick() {
    analyser.getByteFrequencyData(dataArray);
    const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v * v, 0) / dataArray.length);
    const now = Date.now();

    if (rms < SILENCE_THRESHOLD) {
      if (silenceStart === null) silenceStart = now;
      const elapsed = now - (startedAt + MIN_RECORD_MS);
      if (elapsed > 0 && now - silenceStart >= SILENCE_DURATION_MS && !triggered) {
        triggered = true;
        onSilence();
        return;
      }
    } else {
      silenceStart = null;
    }

    rafId = requestAnimationFrame(tick);
  }

  startedAt = Date.now();
  rafId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(rafId);
    source.disconnect();
    ctx.close().catch(() => {});
  };
}

/* ── Audio playback ── */
function playAudioBuffer(buffer: ArrayBuffer): { el: HTMLAudioElement; promise: Promise<void> } {
  const blob = new Blob([buffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const promise = new Promise<void>((resolve) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(() => resolve());
  });
  return { el: audio, promise };
}

/* ── Main hook ── */
export function useAIVoice() {
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const abortedRef = useRef(false);

  useEffect(() => {
    return () => {
      abortedRef.current = true;
      currentAudioRef.current?.pause();
      try { mediaRecorderRef.current?.stop(); } catch {}
    };
  }, []);

  /* ── speak ── */
  const speak = useCallback(async (text: string): Promise<void> => {
    if (abortedRef.current) return;

    try {
      const res = await fetch(`${BASE}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });

      if (!res.ok || abortedRef.current) return;

      const arrayBuffer = await res.arrayBuffer();
      if (abortedRef.current) return;

      const { el, promise } = playAudioBuffer(arrayBuffer);
      currentAudioRef.current = el;
      await promise;
      currentAudioRef.current = null;
    } catch {
      // Silently fail — don't block the session
    }
  }, []);

  const listenDetailed = useCallback(async (timeoutMs = 8000): Promise<ListenResult> => {
    if (abortedRef.current) return { ok: false, reason: "aborted" };
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: "unsupported" };
    }

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return { ok: false, reason: "microphone-denied" };
    }

    if (abortedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return { ok: false, reason: "aborted" };
    }

    return new Promise<ListenResult>((resolve) => {
      const chunks: BlobPart[] = [];
      let finished = false;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = new MediaRecorder(stream!, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream!.getTracks().forEach((t) => t.stop());
        stopSilenceDetector?.();
        clearTimeout(timer);

        if (finished) return;
        finished = true;

        if (abortedRef.current) {
          resolve({ ok: false, reason: "aborted" });
          return;
        }
        if (chunks.length === 0) {
          resolve({ ok: false, reason: "silent" });
          return;
        }

        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        if (blob.size < 1000) {
          resolve({ ok: false, reason: "silent" });
          return;
        }

        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");

          const res = await fetch(`${BASE}/api/voice/transcribe`, {
            method: "POST",
            credentials: "include",
            body: formData,
          });

          if (!res.ok) {
            resolve({ ok: false, reason: "transcription-failed" });
            return;
          }
          const data = await res.json() as { transcript?: string };
          resolve({ ok: true, transcript: (data.transcript ?? "").toLowerCase().trim() });
        } catch {
          resolve({ ok: false, reason: "transcription-failed" });
        }
      };

      const stopRecording = () => {
        if (recorder.state !== "inactive") {
          try { recorder.stop(); } catch {}
        }
      };

      stopRecordingRef.current = stopRecording;

      const stopSilenceDetector = createSilenceDetector(stream!, stopRecording);

      const timer = setTimeout(stopRecording, timeoutMs);

      recorder.start(250);
    });
  }, []);

  const cancelSpeech = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
  }, []);

  /* ── listen ── */
  const listen = useCallback(async (timeoutMs = 8000): Promise<string> => {
    const result = await listenDetailed(timeoutMs);
    return result.ok ? result.transcript : "";
  }, [listenDetailed]);

  const stopListening = useCallback(() => {
    stopRecordingRef.current?.();
    stopRecordingRef.current = null;
  }, []);

  const cancelAll = useCallback(() => {
    abortedRef.current = true;
    cancelSpeech();
    stopListening();
    // Re-enable for next use
    setTimeout(() => { abortedRef.current = false; }, 50);
  }, [cancelSpeech, stopListening]);

  return { speak, cancelSpeech, listen, listenDetailed, stopListening, cancelAll };
}
