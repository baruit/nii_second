import React, { useState, useRef } from 'react';
import { Mic, Square } from 'lucide-react';

interface AudioRecorderProps {
    onRecordingComplete: (blob: Blob) => void;
}

const mergeFloat32 = (chunks: Float32Array[], totalLength: number) => {
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
};

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

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const isRecordingRef = useRef(false);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const chunksRef = useRef<Float32Array[]>([]);
    const totalLengthRef = useRef(0);
    const sampleRateRef = useRef(44100);
    const timerRef = useRef<number | null>(null);

    const startRecording = async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                alert("Your browser does not support audio recording.");
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const AudioContextConstructor =
                window.AudioContext || ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext | undefined);
            if (!AudioContextConstructor) {
                alert("Your browser does not support AudioContext.");
                return;
            }

            const audioContext = new AudioContextConstructor();
            await audioContext.resume();
            audioContextRef.current = audioContext;
            sampleRateRef.current = audioContext.sampleRate;

            chunksRef.current = [];
            totalLengthRef.current = 0;

            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            isRecordingRef.current = true;
            processor.onaudioprocess = (e) => {
                if (!isRecordingRef.current) return;
                const input = e.inputBuffer.getChannelData(0);
                const chunk = new Float32Array(input.length);
                chunk.set(input);
                chunksRef.current.push(chunk);
                totalLengthRef.current += chunk.length;

                const output = e.outputBuffer.getChannelData(0);
                output.fill(0);
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            setIsRecording(true);

            timerRef.current = window.setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);

        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("Could not access microphone. Please ensure permissions are granted.");
        }
    };

    const stopRecording = () => {
        if (isRecording) {
            isRecordingRef.current = false;
            setIsRecording(false);
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            setRecordingTime(0);

            try {
                sourceRef.current?.disconnect();
            } catch {
                // ignore
            }
            try {
                processorRef.current?.disconnect();
            } catch {
                // ignore
            }

            streamRef.current?.getTracks().forEach(track => track.stop());
            streamRef.current = null;

            const audioContext = audioContextRef.current;
            audioContextRef.current = null;
            void audioContext?.close();

            const totalLength = totalLengthRef.current;
            const samples = totalLength > 0 ? mergeFloat32(chunksRef.current, totalLength) : new Float32Array();
            const wavBlob = encodeWav(samples, sampleRateRef.current);
            onRecordingComplete(wavBlob);

            chunksRef.current = [];
            totalLengthRef.current = 0;
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
