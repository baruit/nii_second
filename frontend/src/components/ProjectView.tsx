import React, { useState, useEffect } from 'react';
import { ArrowLeft, Wand2, FileText, Music, Loader2, Pencil, Trash2, Check, X } from 'lucide-react';
import { api, getProjectAudioUrl } from '../api';
import type { AuthUser } from './AuthForm';

interface Project {
    id: number;
    name: string;
    audio_url: string;
    transcription: string | null;
    emotional_analysis: string | null;
    cover_url: string | null;
    created_at: string;
    user_id: number | null;
    owner_username?: string | null;
}

interface ProjectViewProps {
    projectId: number;
    currentUser: AuthUser | null;
    onBack: () => void;
    onDeleted: () => void;
}

const ProjectView: React.FC<ProjectViewProps> = ({ projectId, currentUser, onBack, onDeleted }) => {
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [transcribing, setTranscribing] = useState(false);
    const [generatingCover, setGeneratingCover] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        fetchProject();
    }, [projectId]);

    const fetchProject = async () => {
        try {
            const res = await api.get(`/projects/${projectId}`);
            setProject(res.data);
            setNameDraft(res.data.name);
        } catch (err) {
            console.error("Failed to fetch project", err);
        } finally {
            setLoading(false);
        }
    };

    const handleTranscribe = async () => {
        if (!project) return;
        setTranscribing(true);
        try {
            const res = await api.post(`/transcribe/${project.id}`);
            setProject(res.data);
        } catch (err) {
            console.error("Transcription failed", err);
            alert("Transcription failed.");
        } finally {
            setTranscribing(false);
        }
    };

    const handleGenerateCover = async () => {
        if (!project) return;
        setGeneratingCover(true);
        try {
            const res = await api.post(`/generate-cover/${project.id}`);
            setProject(res.data);
        } catch (err) {
            console.error("Cover generation failed", err);
            alert("Cover generation failed.");
        } finally {
            setGeneratingCover(false);
        }
    };

    if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-cyan-500" /></div>;
    if (!project) return <div className="text-red-500 p-10">Project not found</div>;

    const canEdit =
        !!currentUser && (currentUser.role === 'admin' || (project.user_id != null && project.user_id === currentUser.id));

    const saveName = async () => {
        const nextName = nameDraft.trim();
        if (!nextName || !project) return;
        setSavingName(true);
        try {
            const res = await api.put(`/projects/${project.id}`, { name: nextName });
            setProject(res.data);
            setEditingName(false);
        } catch (err) {
            console.error('Failed to rename', err);
            alert('Не удалось сохранить название.');
        } finally {
            setSavingName(false);
        }
    };

    const deleteProject = async () => {
        if (!project) return;
        const ok = confirm('Удалить проект? Это действие нельзя отменить.');
        if (!ok) return;
        setDeleting(true);
        try {
            await api.delete(`/projects/${project.id}`);
            onDeleted();
        } catch (err) {
            console.error('Failed to delete', err);
            alert('Не удалось удалить проект.');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="animate-fade-in">
            <button
                onClick={onBack}
                className="flex items-center text-gray-400 hover:text-white mb-6 transition-colors"
            >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Projects
            </button>

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <div>
                    {editingName && canEdit ? (
                        <div className="flex items-center gap-2">
                            <input
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50 w-full sm:w-[360px]"
                            />
                            <button
                                onClick={saveName}
                                disabled={savingName}
                                className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50"
                                title="Save"
                            >
                                <Check className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => {
                                    setEditingName(false);
                                    setNameDraft(project.name);
                                }}
                                disabled={savingName}
                                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white disabled:opacity-50"
                                title="Cancel"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <h2 className="text-3xl font-bold text-white">{project.name}</h2>
                    )}
                    <div className="text-sm text-gray-400 mt-1">
                        {project.owner_username ? `by ${project.owner_username}` : null}
                    </div>
                </div>

                {canEdit ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setEditingName(true)}
                            disabled={deleting}
                            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50 flex items-center"
                        >
                            <Pencil className="w-4 h-4 mr-2" />
                            Rename
                        </button>
                        <button
                            onClick={deleteProject}
                            disabled={deleting}
                            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50 flex items-center"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {deleting ? 'Deleting...' : 'Delete'}
                        </button>
                    </div>
                ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Audio & Transcription */}
                <div className="space-y-6">
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
                            <Music className="w-5 h-5 mr-2 text-cyan-400" />
                            Audio Track
                        </h2>
                        <audio
                            controls
                            src={getProjectAudioUrl(project.id)}
                            className="w-full"
                        />
                    </div>

                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 min-h-[300px]">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-white flex items-center">
                                <FileText className="w-5 h-5 mr-2 text-cyan-400" />
                                Музыкальный Анализ 🎨
                            </h2>
                            {canEdit ? (
                                <button
                                    onClick={handleTranscribe}
                                    disabled={transcribing}
                                    className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50 flex items-center shadow-lg shadow-cyan-500/20"
                                >
                                    {transcribing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                    {transcribing
                                        ? 'Анализирую...'
                                        : project.emotional_analysis || project.transcription
                                            ? '🔄 Переанализировать'
                                            : '🎵 Анализировать'}
                                </button>
                            ) : null}
                        </div>

                        {project.emotional_analysis || project.transcription ? (
                            <div className="prose prose-invert max-w-none">
                                <p className="text-gray-300 whitespace-pre-wrap leading-relaxed text-sm">
                                    {project.emotional_analysis || project.transcription}
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-48 text-gray-500 border-2 border-dashed border-gray-700 rounded-lg">
                                <p>Анализ создаст профессиональный искусствоведческий разбор вашего трека! 🎼</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Cover Art */}
                <div className="space-y-6">
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 h-full flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-white flex items-center">
                                <Wand2 className="w-5 h-5 mr-2 text-purple-400" />
                                Обложка Хита 🎨
                            </h2>
                            {canEdit && (project.transcription || project.emotional_analysis) ? (
                                <button
                                    onClick={handleGenerateCover}
                                    disabled={generatingCover}
                                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50 flex items-center shadow-lg shadow-purple-500/20"
                                >
                                    {generatingCover ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                    {generatingCover ? 'Создаю шедевр с Gemini...' : project.cover_url ? '🔄 Перегенерировать' : '🔥 Создать обложку на миллион!'}
                                </button>
                            ) : null}
                        </div>

                        <div className="flex-1 flex items-center justify-center bg-gray-900 rounded-lg overflow-hidden relative min-h-[400px] max-h-[500px]">
                            {project.cover_url ? (
                                <img
                                    src={project.cover_url}
                                    alt="Cover Art"
                                    className="w-full h-full object-contain"
                                />
                            ) : (
                                <div className="text-center p-8">
                                    <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Wand2 className="w-10 h-10 text-gray-600" />
                                    </div>
                                    <p className="text-gray-400">
                                        {project.transcription || project.emotional_analysis
                                            ? "Готово создать обложку на основе музыкального анализа! 🎨🔥"
                                            : "Сначала проанализируйте аудио для создания обложки! 🎵"}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectView;
