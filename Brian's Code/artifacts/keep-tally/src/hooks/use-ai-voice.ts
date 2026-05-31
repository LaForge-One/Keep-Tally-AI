import { useRef, useCallback, useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SPEAK_TIMEOUT_MS = 3500;
const TRANSCRIBE_TIMEOUT_MS = 18000;
const END_OF_UTTERANCE_SILENCE_MS = 7000;

export type VoiceSupport = {
  hasSpeechRecognition: boolean;
  hasTTS: boolean;
  hasMediaRecorder: boolean;
  hasGetUserMedia: boolean;
  isSecureContext: boolean;
  recordingMimeType: string;
};

export type ListenResult =
  | { ok: true; transcript: string }
  | {
      ok: false;
      reason:
        | "microphone-denied"
        | "unsupported"
        | "silent"
        | "transcription-failed"
        | "aborted"
        | "microphone-timeout";
    };

export type MicrophonePrecheckResult =
  | { ok: true; message: string; details: string[] }
  | {
      ok: false;
      reason: "microphone-denied" | "unsupported" | "microphone-timeout";
      message: string;
      details: string[];
    };

function getRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

export function getAIVoiceSupport(): VoiceSupport {
  const hasMediaRecorder = typeof MediaRecorder !== "undefined";
  const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia);
  const isSecureContext = window.isSecureContext;
  return {
    hasSpeechRecognition: hasMediaRecorder && hasGetUserMedia && isSecureContext,
    hasTTS: true,
    hasMediaRecorder,
    hasGetUserMedia,
    isSecureContext,
    recordingMimeType: getRecordingMimeType(),
  };
}

const SILENCE_THRESHOLD = 8;
const SILENCE_DURATION_MS = END_OF_UTTERANCE_SILENCE_MS;
const MIN_RECORD_MS = 600;

function createSilenceDetector(stream: MediaStream, onSilence: () => void) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  let silenceStart: number | null = null;
  const startedAt = Date.now();
  let rafId: number;
  let triggered = false;

  function tick() {
    analyser.getByteFrequencyData(dataArray);
    const rms = Math.sqrt(dataArray.reduce((sum, value) => sum + value * value, 0) / dataArray.length);
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

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(rafId);
    source.disconnect();
    ctx.close().catch(() => {});
  };
}

function playAudioBuffer(buffer: ArrayBuffer): { el: HTMLAudioElement; promise: Promise<void> } {
  const blob = new Blob([buffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const promise = new Promise<void>((resolve) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.play().catch(() => resolve());
  });
  return { el: audio, promise };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  onController?: (controller: AbortController | null) => void,
) {
  const controller = new AbortController();
  onController?.(controller);
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    onController?.(null);
  }
}

async function speakWithBrowserTts(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return;

  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const timer = window.setTimeout(() => {
      window.speechSynthesis.cancel();
      resolve();
    }, SPEAK_TIMEOUT_MS);

    utterance.onend = () => {
      window.clearTimeout(timer);
      resolve();
    };
    utterance.onerror = () => {
      window.clearTimeout(timer);
      resolve();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

async function getMicrophoneStream(timeoutMs = 10000): Promise<MediaStream | null> {
  const request = navigator.mediaDevices.getUserMedia({ audio: true });
  const timeout = new Promise<null>((resolve) => {
    window.setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([request, timeout]);
}

export function useAIVoice() {
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const activeTtsFetchControllerRef = useRef<AbortController | null>(null);
  const activeTranscribeFetchControllerRef = useRef<AbortController | null>(null);
  const discardRecordingRef = useRef(false);
  const abortedRef = useRef(false);

  useEffect(() => {
    return () => {
      abortedRef.current = true;
      currentAudioRef.current?.pause();
      activeTtsFetchControllerRef.current?.abort();
      activeTranscribeFetchControllerRef.current?.abort();
      try {
        mediaRecorderRef.current?.stop();
      } catch {}
    };
  }, []);

  const speak = useCallback(async (text: string): Promise<void> => {
    if (abortedRef.current) return;

    try {
      const res = await fetchWithTimeout(`${BASE}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      }, SPEAK_TIMEOUT_MS, (controller) => {
        activeTtsFetchControllerRef.current = controller;
      });

      if (!res.ok || abortedRef.current) {
        await speakWithBrowserTts(text);
        return;
      }

      const arrayBuffer = await res.arrayBuffer();
      if (abortedRef.current) return;

      const { el, promise } = playAudioBuffer(arrayBuffer);
      currentAudioRef.current = el;
      await promise;
      currentAudioRef.current = null;
    } catch {
      await speakWithBrowserTts(text);
    }
  }, []);

  const precheckMicrophone = useCallback(async (): Promise<MicrophonePrecheckResult> => {
    const support = getAIVoiceSupport();
    const details = [
      `Secure context: ${support.isSecureContext ? "yes" : "no"}`,
      `MediaRecorder: ${support.hasMediaRecorder ? "available" : "missing"}`,
      `getUserMedia: ${support.hasGetUserMedia ? "available" : "missing"}`,
      `Recording format: ${support.recordingMimeType || "browser default"}`,
    ];

    if (!support.isSecureContext) {
      return {
        ok: false,
        reason: "unsupported",
        message: "Microphone access requires HTTPS or localhost. Open the VPS site through HTTPS before voice testing.",
        details,
      };
    }
    if (!support.hasMediaRecorder || !support.hasGetUserMedia) {
      return {
        ok: false,
        reason: "unsupported",
        message: "This browser does not support the recording APIs needed for AI transcription testing.",
        details,
      };
    }

    let stream: MediaStream | null = null;
    try {
      stream = await getMicrophoneStream();
    } catch {
      return {
        ok: false,
        reason: "microphone-denied",
        message: "Microphone permission was denied. Allow microphone access in the browser and run the check again.",
        details,
      };
    }

    if (!stream) {
      return {
        ok: false,
        reason: "microphone-timeout",
        message: "The browser did not return microphone access in time. Check the permission prompt or selected input device.",
        details,
      };
    }

    const audioTracks = stream.getAudioTracks();
    const activeTracks = audioTracks.filter((track) => track.readyState === "live");
    const label = audioTracks[0]?.label;
    stream.getTracks().forEach((track) => track.stop());

    if (activeTracks.length === 0) {
      return {
        ok: false,
        reason: "microphone-denied",
        message: "No active microphone track was detected.",
        details,
      };
    }

    return {
      ok: true,
      message: label ? `Microphone ready: ${label}` : "Microphone ready.",
      details: [...details, `Audio tracks: ${activeTracks.length}`],
    };
  }, []);

  const listenDetailed = useCallback(async (timeoutMs = 8000): Promise<ListenResult> => {
    if (abortedRef.current) return { ok: false, reason: "aborted" };
    discardRecordingRef.current = false;
    if (!window.isSecureContext || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: "unsupported" };
    }

    let stream: MediaStream | null = null;

    try {
      stream = await getMicrophoneStream();
    } catch {
      return { ok: false, reason: "microphone-denied" };
    }

    if (!stream) return { ok: false, reason: "microphone-timeout" };

    if (abortedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return { ok: false, reason: "aborted" };
    }

    return new Promise<ListenResult>((resolve) => {
      const chunks: BlobPart[] = [];
      let finished = false;

      const mimeType = getRecordingMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream!, mimeType ? { mimeType } : undefined);
      } catch {
        stream!.getTracks().forEach((track) => track.stop());
        resolve({ ok: false, reason: "unsupported" });
        return;
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      let stopSilenceDetector: (() => void) | null = null;
      const timer = window.setTimeout(() => stopRecording(), timeoutMs);

      recorder.onstop = async () => {
        stream!.getTracks().forEach((track) => track.stop());
        stopSilenceDetector?.();
        window.clearTimeout(timer);

        if (finished) return;
        finished = true;

        if (abortedRef.current) {
          resolve({ ok: false, reason: "aborted" });
          return;
        }
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
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

          const res = await fetchWithTimeout(`${BASE}/api/voice/transcribe`, {
            method: "POST",
            credentials: "include",
            body: formData,
          }, TRANSCRIBE_TIMEOUT_MS, (controller) => {
            activeTranscribeFetchControllerRef.current = controller;
          });

          if (!res.ok) {
            resolve({ ok: false, reason: "transcription-failed" });
            return;
          }
          const data = (await res.json()) as { transcript?: string };
          resolve({ ok: true, transcript: (data.transcript ?? "").toLowerCase().trim() });
        } catch {
          resolve({ ok: false, reason: "transcription-failed" });
        }
      };

      function stopRecording() {
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {}
        }
      }

      stopRecordingRef.current = stopRecording;
      stopSilenceDetector = createSilenceDetector(stream!, stopRecording);
      recorder.start(250);
    });
  }, []);

  const cancelSpeech = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    activeTtsFetchControllerRef.current?.abort();
    activeTtsFetchControllerRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const listen = useCallback(async (timeoutMs = 8000): Promise<string> => {
    const result = await listenDetailed(timeoutMs);
    return result.ok ? result.transcript : "";
  }, [listenDetailed]);

  const stopListening = useCallback(() => {
    discardRecordingRef.current = true;
    activeTranscribeFetchControllerRef.current?.abort();
    activeTranscribeFetchControllerRef.current = null;
    stopRecordingRef.current?.();
    stopRecordingRef.current = null;
  }, []);

  const cancelAll = useCallback(() => {
    abortedRef.current = true;
    cancelSpeech();
    stopListening();
  }, [cancelSpeech, stopListening]);

  const resetVoiceSession = useCallback(() => {
    abortedRef.current = false;
  }, []);

  return {
    speak,
    cancelSpeech,
    listen,
    listenDetailed,
    precheckMicrophone,
    stopListening,
    cancelAll,
    resetVoiceSession,
  };
}
