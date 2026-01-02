import React, { useState, useRef } from 'react';
import { Mic, Square } from 'lucide-react';

interface AudioRecorderProps {
    onRecordingComplete: (blob: Blob) => void;
}

const writeString = (view: DataView, offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
    }
};

const encodeWav = (samples: Float32Array, sampleRate: number) => {
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(view, 8, 'WAVE');

    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16-bit

    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * bytesPerSample, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
};

const pickSupportedMimeType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
    ];
    for (const type of candidates) {
        try {
            if (MediaRecorder.isTypeSupported(type)) return type;
        } catch {
            // ignore
        }
    }
    return null;
};

const mixToMono = (audioBuffer: AudioBuffer) => {
    if (audioBuffer.numberOfChannels === 1) {
        const channel = audioBuffer.getChannelData(0);
        const copy = new Float32Array(channel.length);
        copy.set(channel);
        return copy;
    }

    const length = audioBuffer.length;
    const output = new Float32Array(length);
    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
        const channel = audioBuffer.getChannelData(channelIndex);
        for (let i = 0; i < length; i += 1) {
            output[i] += channel[i] / audioBuffer.numberOfChannels;
        }
    }
    return output;
};

const tryConvertToWav = async (blob: Blob) => {
    const AudioContextConstructor =
        window.AudioContext ||
        ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext | undefined);
    if (!AudioContextConstructor) return null;

    const audioContext = new AudioContextConstructor();
    try {
        try {
            await audioContext.resume();
        } catch {
            // ignore (decoding does not require running audio)
        }

        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        const monoSamples = mixToMono(audioBuffer);
        const wavBlob = encodeWav(monoSamples, audioBuffer.sampleRate);
        return wavBlob;
    } catch (err) {
        console.error('Failed to convert recording to WAV:', err);
        return null;
    } finally {
        try {
            await audioContext.close();
        } catch {
            // ignore
        }
    }
};

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const streamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<number | null>(null);

    const startRecording = async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
                alert("Your browser does not support audio recording.");
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            recordedChunksRef.current = [];

            const mimeType = pickSupportedMimeType();
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) recordedChunksRef.current.push(event.data);
            };

            recorder.onstop = async () => {
                const recordedBlob = new Blob(recordedChunksRef.current, { type: mimeType || recorder.mimeType || '' });
                recordedChunksRef.current = [];

                streamRef.current?.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
                mediaRecorderRef.current = null;

                if (recordedBlob.size < 512) {
                    alert('Не удалось записать звук. Попробуйте обновить страницу или дать доступ к микрофону заново.');
                    return;
                }

                const wavBlob = await tryConvertToWav(recordedBlob);
                onRecordingComplete(wavBlob || recordedBlob);
            };

            recorder.start();

            setIsRecording(true);

            timerRef.current = window.setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);
        } catch (err) {
            console.error("Error accessing microphone:", err);
            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
            mediaRecorderRef.current = null;
            recordedChunksRef.current = [];
            alert("Could not access microphone. Please ensure permissions are granted.");
        }
    };

    const stopRecording = () => {
        if (isRecording) {
            setIsRecording(false);
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            setRecordingTime(0);

            try {
                const recorder = mediaRecorderRef.current;
                if (recorder && recorder.state !== 'inactive') recorder.stop();
                else {
                    streamRef.current?.getTracks().forEach((track) => track.stop());
                    streamRef.current = null;
                    mediaRecorderRef.current = null;
                    recordedChunksRef.current = [];
                }
            } catch {
                // ignore
            }
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col items-center justify-center p-6 bg-gray-800 rounded-xl shadow-lg border border-gray-700">
            <div className="text-4xl font-mono text-cyan-400 mb-4 h-12 flex items-center">
                {isRecording ? formatTime(recordingTime) : "0:00"}
            </div>

            <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${isRecording
                        ? 'bg-red-500 hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                        : 'bg-cyan-500 hover:bg-cyan-600 shadow-[0_0_20px_rgba(6,182,212,0.5)]'
                    }`}
            >
                {isRecording ? (
                    <Square className="w-8 h-8 text-white" fill="currentColor" />
                ) : (
                    <Mic className="w-8 h-8 text-white" />
                )}
            </button>

            <p className="mt-4 text-gray-400 text-sm">
                {isRecording ? "Recording... Tap to stop" : "Tap to start recording"}
            </p>
        </div>
    );
};

export default AudioRecorder;
