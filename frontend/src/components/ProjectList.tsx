import React from 'react';
import { Play, Pause, Music, Calendar } from 'lucide-react';

interface Project {
    id: number;
    name: string;
    created_at: string;
    audio_url: string;
    cover_url?: string | null;
    owner_username?: string | null;
}

interface ProjectListProps {
    projects: Project[];
    onSelectProject: (id: number) => void;
    onPlayProject: (project: Project) => void;
    playingProjectId?: number | null;
}

const ProjectList: React.FC<ProjectListProps> = ({ projects, onSelectProject, onPlayProject, playingProjectId }) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
                <div
                    key={project.id}
                    onClick={() => onSelectProject(project.id)}
                    className="group relative bg-gray-800 rounded-xl overflow-hidden cursor-pointer border border-gray-700 hover:border-cyan-500/50 transition-all duration-300 hover:shadow-[0_0_30px_rgba(6,182,212,0.15)]"
                >
                    <div className="aspect-square bg-gray-900 relative overflow-hidden">
                        {project.cover_url ? (
                            <img
                                src={project.cover_url}
                                alt={project.name}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-700">
                                <Music className="w-16 h-16" />
                            </div>
                        )}

                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPlayProject(project);
                                }}
                                className="w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-colors"
                                aria-label={playingProjectId === project.id ? 'Pause' : 'Play'}
                            >
                                {playingProjectId === project.id ? (
                                    <Pause className="w-10 h-10 text-white fill-white" />
                                ) : (
                                    <Play className="w-10 h-10 text-white fill-white" />
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="p-4">
                        <h3 className="text-lg font-bold text-white truncate">{project.name}</h3>
                        <div className="flex items-center text-gray-400 text-xs mt-2">
                            <Calendar className="w-3 h-3 mr-1" />
                            {new Date(project.created_at).toLocaleDateString()}
                        </div>
                        {project.owner_username ? (
                            <div className="text-xs text-gray-500 mt-1">by {project.owner_username}</div>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default ProjectList;
