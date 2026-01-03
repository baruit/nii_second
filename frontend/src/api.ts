import axios from 'axios';

const joinUrl = (base: string, pathPart: string) => {
    const normalizedBase = base.replace(/\/+$/, '');
    const normalizedPath = pathPart.replace(/^\/+/, '');
    return `${normalizedBase}/${normalizedPath}`;
};

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({
    baseURL: API_BASE_URL,
});

export const setAuthToken = (token: string | null) => {
    if (token) {
        api.defaults.headers.common.Authorization = `Bearer ${token}`;
        return;
    }
    delete api.defaults.headers.common.Authorization;
};

export const getProjectAudioUrl = (projectId: number) => joinUrl(API_BASE_URL, `/projects/${projectId}/audio`);
export const getProjectCoverUrl = (projectId: number) => joinUrl(API_BASE_URL, `/projects/${projectId}/cover`);
