import { useEffect, useRef, useState } from 'react';
import { Disc, LogIn, LogOut, Plus, X } from 'lucide-react';
import AudioRecorder from './components/AudioRecorder';
import ProjectList from './components/ProjectList';
import ProjectView from './components/ProjectView';
import AuthForm, { AuthUser } from './components/AuthForm';
import { api, setAuthToken } from './api';

type View = 'list' | 'create' | 'detail' | 'auth';

interface Project {
    id: number;
    name: string;
    created_at: string;
    audio_url: string;
    cover_url?: string | null;
    owner_username?: string | null;
    user_id?: number | null;
}

function App() {
    const [view, setView] = useState<View>('list');
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [uploading, setUploading] = useState(false);

    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [postAuthView, setPostAuthView] = useState<View | null>(null);
    const [user, setUser] = useState<AuthUser | null>(null);
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [nowPlaying, setNowPlaying] = useState<Project | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        setAuthToken(token);
        if (!token) {
            setUser(null);
            return;
        }
        api.get('/auth/me')
            .then((res) => setUser(res.data.user))
            .catch(() => {
                localStorage.removeItem('auth_token');
                setAuthToken(null);
                setToken(null);
                setUser(null);
            });
    }, [token]);

    useEffect(() => {
        if (view === 'list') {
            void fetchProjects();
        }
    }, [view]);

    const fetchProjects = async () => {
        try {
            const res = await api.get('/projects');
            setProjects(res.data);
        } catch (err) {
            console.error('Failed to fetch projects', err);
        }
    };

    const openAuth = (nextViewAfterAuth: View | null) => {
        setAuthMode('login');
        setPostAuthView(nextViewAfterAuth);
        setView('auth');
    };

    const goToCreate = () => {
        if (!user) {
            openAuth('create');
            return;
        }
        setView('create');
    };

    const handleAuthSuccess = (result: { token: string; user: AuthUser }) => {
        localStorage.setItem('auth_token', result.token);
        setToken(result.token);
        setUser(result.user);
        setView(postAuthView ?? 'list');
        setPostAuthView(null);
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            // ignore
        }
        localStorage.removeItem('auth_token');
        setAuthToken(null);
        setToken(null);
        setUser(null);
        stopPlayback();
        setView('list');
    };

    const stopPlayback = () => {
        const audio = audioRef.current;
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        }
        setNowPlaying(null);
        setIsPlaying(false);
    };

    const handlePlayProject = (project: Project) => {
        const audio = audioRef.current;
        if (!audio) return;

        if (nowPlaying?.id === project.id) {
            if (audio.ended) audio.currentTime = 0;
            if (audio.paused) audio.play().catch(() => {});
            else audio.pause();
            return;
        }

        setNowPlaying(project);
        audio.src = project.audio_url;
        audio.currentTime = 0;
        audio.play().catch(() => {});
    };

    const handleRecordingComplete = async (blob: Blob) => {
        if (!user) {
            openAuth('create');
            return;
        }
        setUploading(true);
        const formData = new FormData();
        formData.append('audio', blob, 'recording.wav');
        formData.append('name', `Song #${projects.length + 1}`);

        try {
            const res = await api.post('/projects', formData);
            setSelectedProjectId(res.data.id);
            setView('detail');
        } catch (err) {
            console.error('Failed to upload', err);
            alert('Failed to upload recording');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 font-sans selection:bg-cyan-500/30 pb-24">
            <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('list')}>
                        <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
                            <Disc className="w-5 h-5 text-white animate-spin-slow" />
                        </div>
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                            SonicCanvas
                        </h1>
                    </div>

                    <div className="flex items-center gap-2">
                        {view === 'list' && user ? (
                            <button
                                onClick={goToCreate}
                                className="flex items-center px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-full text-sm font-medium transition-all hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]"
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                New Project
                            </button>
                        ) : null}

                        {user ? (
                            <>
                                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900 border border-gray-800 text-sm text-gray-200">
                                    <span className="font-medium">{user.username}</span>
                                    {user.role === 'admin' ? (
                                        <span className="text-xs text-purple-200 bg-purple-900/40 px-2 py-0.5 rounded-full border border-purple-700/40">
                                            admin
                                        </span>
                                    ) : null}
                                </div>
                                <button
                                    onClick={logout}
                                    className="flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full text-sm font-medium transition-all"
                                >
                                    <LogOut className="w-4 h-4 mr-2" />
                                    Выйти
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => openAuth(null)}
                                className="flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full text-sm font-medium transition-all"
                            >
                                <LogIn className="w-4 h-4 mr-2" />
                                Войти
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                {view === 'list' ? (
                    <div className="animate-fade-in">
                        <div className="flex items-end justify-between gap-4 mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-200">Галерея</h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    Смотреть и слушать можно без регистрации. Добавлять — только после входа.
                                </p>
                            </div>
                            {!user ? (
                                <button
                                    onClick={() => openAuth('create')}
                                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                    Войти, чтобы добавить
                                </button>
                            ) : null}
                        </div>

                        {projects.length === 0 ? (
                            <div className="text-center py-20">
                                <p className="text-gray-500 mb-4">Пока нет треков.</p>
                                <button
                                    onClick={goToCreate}
                                    className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                                >
                                    Создать первый проект
                                </button>
                            </div>
                        ) : (
                            <ProjectList
                                projects={projects}
                                playingProjectId={isPlaying && nowPlaying ? nowPlaying.id : null}
                                onPlayProject={handlePlayProject}
                                onSelectProject={(id) => {
                                    setSelectedProjectId(id);
                                    setView('detail');
                                }}
                            />
                        )}
                    </div>
                ) : null}

                {view === 'auth' ? (
                    <AuthForm
                        mode={authMode}
                        onModeChange={setAuthMode}
                        onSuccess={handleAuthSuccess}
                        onCancel={() => {
                            setView('list');
                            setPostAuthView(null);
                        }}
                    />
                ) : null}

                {view === 'create' ? (
                    <div className="max-w-xl mx-auto animate-fade-in">
                        <button
                            onClick={() => setView('list')}
                            className="flex items-center text-gray-400 hover:text-white mb-6 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Cancel
                        </button>

                        {!user ? (
                            <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 text-center">
                                <p className="text-gray-300 mb-4">Нужно войти, чтобы добавить проект.</p>
                                <button
                                    onClick={() => openAuth('create')}
                                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                    Войти
                                </button>
                            </div>
                        ) : (
                            <>
                                <h2 className="text-3xl font-bold mb-8 text-center">Record Your Masterpiece</h2>

                                {uploading ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                                        <p className="text-gray-400">Uploading audio...</p>
                                    </div>
                                ) : (
                                    <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                                )}
                            </>
                        )}
                    </div>
                ) : null}

                {view === 'detail' && selectedProjectId ? (
                    <ProjectView
                        projectId={selectedProjectId}
                        currentUser={user}
                        onBack={() => setView('list')}
                        onDeleted={() => {
                            setSelectedProjectId(null);
                            setView('list');
                            void fetchProjects();
                        }}
                    />
                ) : null}
            </main>

            <div
                className={`fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-gray-900/80 backdrop-blur-md ${nowPlaying ? '' : 'hidden'
                    }`}
            >
                <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
                    <div className="min-w-0 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
                            {nowPlaying?.cover_url ? (
                                <img
                                    src={nowPlaying.cover_url}
                                    alt={nowPlaying.name}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <Disc className="w-5 h-5 text-gray-300" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">{nowPlaying?.name}</div>
                            {nowPlaying?.owner_username ? (
                                <div className="text-xs text-gray-400 truncate">by {nowPlaying.owner_username}</div>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex-1">
                        <audio
                            ref={audioRef}
                            controls
                            className="w-full"
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                            onEnded={() => setIsPlaying(false)}
                        />
                    </div>

                    <button
                        type="button"
                        onClick={stopPlayback}
                        className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white transition-colors"
                        aria-label="Close player"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function ArrowLeft({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
        </svg>
    );
}

export default App;
