import React, { useState } from 'react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import { api } from '../api';

export type AuthUser = {
    id: number;
    username: string;
    role: 'user' | 'admin';
};

type AuthMode = 'login' | 'register';

interface AuthFormProps {
    mode: AuthMode;
    onModeChange: (mode: AuthMode) => void;
    onSuccess: (result: { token: string; user: AuthUser }) => void;
    onCancel: () => void;
}

const AuthForm: React.FC<AuthFormProps> = ({ mode, onModeChange, onSuccess, onCancel }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
            const res = await api.post(endpoint, { username, password });
            onSuccess(res.data);
        } catch (err: any) {
            const message = err?.response?.data?.error || 'Ошибка. Проверь логин/пароль.';
            setError(String(message));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-md mx-auto animate-fade-in">
            <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-white">
                        {mode === 'login' ? 'Вход' : 'Регистрация'}
                    </h2>
                    <button
                        onClick={onCancel}
                        className="text-gray-400 hover:text-white transition-colors text-sm"
                        type="button"
                    >
                        Закрыть
                    </button>
                </div>

                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Логин</label>
                        <input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-white outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50"
                            placeholder="username"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-300 mb-2">Пароль</label>
                        <input
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            type="password"
                            className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-white outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50"
                            placeholder="••••••••"
                        />
                        <p className="text-xs text-gray-500 mt-2">Минимум 6 символов.</p>
                    </div>

                    {error && (
                        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/40 rounded-lg px-3 py-2">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg font-medium transition-all disabled:opacity-50 flex items-center justify-center shadow-lg shadow-cyan-500/20"
                    >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        {mode === 'login' ? (
                            <>
                                <LogIn className="w-4 h-4 mr-2" />
                                Войти
                            </>
                        ) : (
                            <>
                                <UserPlus className="w-4 h-4 mr-2" />
                                Создать аккаунт
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-6 text-sm text-gray-400">
                    {mode === 'login' ? (
                        <button
                            type="button"
                            onClick={() => onModeChange('register')}
                            className="text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                            Нет аккаунта? Зарегистрироваться
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onModeChange('login')}
                            className="text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                            Уже есть аккаунт? Войти
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuthForm;

