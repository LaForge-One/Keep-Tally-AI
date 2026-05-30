import { useRef, useCallback, useEffect } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any;

export function getVoiceSupport() {
  if (typeof window === "undefined") return { tts: false, stt: false };
  return {
    tts: "speechSynthesis" in window,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stt: !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
  };
}

export function useVoice() {
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const recognitionRef = useRef<AnySpeechRecognition>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      synthRef.current = window.speechSynthesis;
    }
    return () => {
      synthRef.current?.cancel();
      try { recognitionRef.current?.abort(); } catch {}
    };
  }, []);

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      const synth = synthRef.current;
      if (!synth) { resolve(); return; }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.88;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }, []);

  const cancelSpeech = useCallback(() => {
    synthRef.current?.cancel();
  }, []);

  const listen = useCallback((timeoutMs = 8000): Promise<string> => {
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!SR) { resolve(""); return; }

      const recognition: AnySpeechRecognition = new SR();
      recognitionRef.current = recognition;
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;

      let done = false;
      const finish = (text: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        recognitionRef.current = null;
        resolve(text.toLowerCase().trim());
      };

      recognition.onresult = (e: { results: { length: number; [i: number]: { [j: number]: { transcript: string } } } }) => {
        const parts: string[] = [];
        for (let i = 0; i < e.results.length; i++) {
          parts.push(e.results[i]?.[0]?.transcript ?? "");
        }
        finish(parts.join(" "));
      };
      recognition.onerror = () => finish("");
      recognition.onend = () => finish("");

      const timer = setTimeout(() => {
        try { recognition.stop(); } catch {}
        finish("");
      }, timeoutMs);

      try {
        recognition.start();
      } catch {
        finish("");
      }
    });
  }, []);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
  }, []);

  const cancelAll = useCallback(() => {
    synthRef.current?.cancel();
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
  }, []);

  return { speak, cancelSpeech, listen, stopListening, cancelAll };
}
