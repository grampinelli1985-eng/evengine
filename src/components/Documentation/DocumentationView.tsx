import React, { useState, useEffect, useMemo } from 'react';
import { 
  getSections, 
  getGlossary, 
  searchDocumentation, 
  getSectionById 
} from '../../services/documentationService';
import { DocSection, GlossaryTerm, SearchResult } from '../../types/documentation';
import {
  BookOpen, Search, X, ArrowLeft, ChevronRight,
  Award, Calendar, BookMarked,
  Layers, Library
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface DocumentationViewProps {
  onBack: () => void;
}

export default function DocumentationView({ onBack }: DocumentationViewProps) {
  const sections = useMemo(() => getSections(), []);
  const glossary = useMemo(() => getGlossary(), []);

  const [activeSectionId, setActiveSectionId] = useState<string>('visao-geral');
  const [activeSubsectionId, setActiveSubsectionId] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isMobileView, setIsMobileView] = useState(false);
  const [mobileShowContent, setMobileShowContent] = useState(false);

  // Check if screen is mobile size for responsive layout
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobileView(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Listen to navigation events from other panels
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent<{ sectionId: string; subsectionId?: string }>;
      if (customEvent.detail && customEvent.detail.sectionId) {
        setActiveSectionId(customEvent.detail.sectionId);
        if (customEvent.detail.subsectionId) {
          setActiveSubsectionId(customEvent.detail.subsectionId);
        } else {
          setActiveSubsectionId(null);
        }
        
        if (isMobileView) {
          setMobileShowContent(true);
        }

        // Scroll content area to top
        const contentEl = document.getElementById('docs-main-content-scroll');
        if (contentEl) {
          contentEl.scrollTop = 0;
        }
      }
    };
    window.addEventListener('evengine_navigate_docs', handleNavigate);
    return () => {
      window.removeEventListener('evengine_navigate_docs', handleNavigate);
    };
  }, [isMobileView]);

  // Handle Search input
  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      const results = searchDocumentation(searchQuery);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const activeSection = useMemo(() => {
    return sections.find(s => s.id === activeSectionId) || sections[0];
  }, [sections, activeSectionId]);

  const handleSectionSelect = (sectionId: string) => {
    setActiveSectionId(sectionId);
    setActiveSubsectionId(null);
    if (isMobileView) {
      setMobileShowContent(true);
    }
    
    const contentEl = document.getElementById('docs-main-content-scroll');
    if (contentEl) {
      contentEl.scrollTop = 0;
    }
  };

  const handleSubsectionSelect = (sectionId: string, subId: string) => {
    setActiveSectionId(sectionId);
    setActiveSubsectionId(subId);
    if (isMobileView) {
      setMobileShowContent(true);
    }

    setTimeout(() => {
      const subEl = document.getElementById(`sub-${subId}`);
      if (subEl) {
        subEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const handleSearchResultClick = (result: SearchResult) => {
    setActiveSectionId(result.sectionId);
    if (result.subsectionId) {
      setActiveSubsectionId(result.subsectionId);
    } else {
      setActiveSubsectionId(null);
    }
    
    setSearchQuery(''); // Reset search
    if (isMobileView) {
      setMobileShowContent(true);
    }

    setTimeout(() => {
      if (result.subsectionId) {
        const subEl = document.getElementById(`sub-${result.subsectionId}`);
        if (subEl) {
          subEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        const contentEl = document.getElementById('docs-main-content-scroll');
        if (contentEl) {
          contentEl.scrollTop = 0;
        }
      }
    }, 150);
  };

  // Helper to scroll to glossary term in glossario section
  const handleGlossaryTermClick = (term: string) => {
    setActiveSectionId('glossario');
    const termSlug = `glossary-${term.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-')}`;
    setActiveSubsectionId(termSlug);
    
    if (isMobileView) {
      setMobileShowContent(true);
    }

    setTimeout(() => {
      const termEl = document.getElementById(`term-${term}`);
      if (termEl) {
        termEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 150);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[500px] bg-[#070708] border border-white/5 rounded-3xl overflow-hidden text-left font-sans shadow-2xl relative">
      
      {/* 1. Header Area */}
      <header className="px-6 py-4 bg-[#0c0c0e] border-b border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white rounded-xl transition-all cursor-pointer flex items-center justify-center"
            title="Voltar ao Painel Principal"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Library size={18} className="text-blue-500" />
              <h1 className="text-base font-black text-white uppercase tracking-wider">Central de Ajuda</h1>
            </div>
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mt-0.5">
              EVENGINE Engine Documentation v1.0
            </span>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-white/30">
            <Search size={14} />
          </div>
          <input
            type="text"
            placeholder="Pesquisar manual quantitativo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 bg-[#050506] border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 transition-all font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-3 flex items-center text-white/40 hover:text-white cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      {/* 2. Main Content Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Sidebar: Navigation Lists or Search Results */}
        <aside className={`
          ${isMobileView ? (mobileShowContent ? 'hidden' : 'w-full') : 'w-80 border-r border-white/5'} 
          h-full bg-[#09090b] flex flex-col shrink-0 overflow-y-auto custom-scrollbar transition-all duration-300
        `}>
          {searchQuery.trim().length > 0 ? (
            // Search Results Mode
            <div className="p-4 space-y-4">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                  Resultados da Busca ({searchResults.length})
                </span>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-[9px] font-black text-blue-400 hover:text-blue-300 uppercase tracking-wider cursor-pointer"
                >
                  Limpar
                </button>
              </div>

              {searchResults.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <span className="text-xl block">🔍</span>
                  <p className="text-[11px] text-white/30 font-bold uppercase tracking-wide">
                    Nenhum resultado encontrado
                  </p>
                  <p className="text-[9px] text-white/20 px-4 leading-relaxed font-mono">
                    Tente buscar termos como "Kelly", "Sharp", "Gates" ou "EV".
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((result, idx) => {
                    const TypeIcon = result.type === 'section' ? BookOpen :
                                     result.type === 'subsection' ? Layers : BookMarked;
                    return (
                      <button
                        key={`${result.sectionId}-${result.subsectionId || ''}-${idx}`}
                        onClick={() => handleSearchResultClick(result)}
                        className="w-full text-left p-3.5 bg-white/[0.01] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 rounded-xl transition-all flex items-start gap-3 group cursor-pointer"
                      >
                        <div className="p-1.5 bg-white/5 rounded-lg text-white/40 group-hover:text-blue-400 group-hover:bg-blue-500/10 transition-all shrink-0 mt-0.5">
                          <TypeIcon size={12} />
                        </div>
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[11px] font-black text-white/80 group-hover:text-blue-400 transition-colors truncate">
                              {result.title}
                            </span>
                            <span className="text-[7px] font-mono font-black text-white/20 uppercase bg-white/5 px-1 py-0.5 rounded shrink-0">
                              {result.type}
                            </span>
                          </div>
                          <p className="text-[9px] text-white/40 font-mono leading-relaxed line-clamp-2">
                            {result.preview}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Standard Sections List
            <div className="p-4 space-y-5">
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest px-1 block">
                Tópicos do Manual
              </span>

              <div className="space-y-1">
                {sections.map((section) => {
                  const isActive = activeSectionId === section.id;
                  
                  return (
                    <div key={section.id} className="space-y-0.5">
                      <button
                        onClick={() => handleSectionSelect(section.id)}
                        className={`w-full text-left px-4 py-3 rounded-xl text-xs transition-all flex items-center justify-between group cursor-pointer ${
                          isActive 
                            ? 'bg-blue-600/10 border border-blue-500/20 text-blue-400 font-black' 
                            : 'bg-transparent border border-transparent text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-sm shrink-0">{section.icon}</span>
                          <span className="truncate">{section.title}</span>
                        </div>
                        <ChevronRight 
                          size={12} 
                          className={`text-white/20 group-hover:text-white/40 transition-transform ${
                            isActive ? 'rotate-90 text-blue-400' : ''
                          }`} 
                        />
                      </button>

                      {/* Subsections list (expanded when active) */}
                      {isActive && section.subsections && section.subsections.length > 0 && (
                        <div className="pl-9 pr-2 py-1 space-y-1 border-l border-white/5 ml-6 mt-1 mb-2">
                          {section.subsections.map((sub) => {
                            const isSubActive = activeSubsectionId === sub.id;
                            return (
                              <button
                                key={sub.id}
                                onClick={() => handleSubsectionSelect(section.id, sub.id)}
                                className={`w-full text-left py-1.5 px-2 rounded text-[10px] font-medium transition-all block truncate cursor-pointer ${
                                  isSubActive
                                    ? 'text-blue-400 bg-white/5 font-bold'
                                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.01]'
                                }`}
                              >
                                {sub.title}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quick Access Glossary Card */}
              {activeSectionId !== 'glossario' && (
                <div className="pt-4 border-t border-white/5">
                  <button
                    onClick={() => handleSectionSelect('glossario')}
                    className="w-full p-4 bg-gradient-to-br from-blue-950/20 to-transparent border border-white/5 hover:border-white/10 rounded-2xl text-left space-y-2 group cursor-pointer transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <BookMarked size={14} className="text-blue-400" />
                      <h4 className="text-[10px] font-black text-white uppercase tracking-wider">Acesso ao Glossário</h4>
                    </div>
                    <p className="text-[9px] text-white/40 leading-relaxed font-mono">
                      Consulte definições rápidas de BTTS, Poisson, ELO, EV, Kelly e mais.
                    </p>
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Content Area */}
        <main className={`
          ${isMobileView ? (mobileShowContent ? 'w-full' : 'hidden') : 'flex-1'}
          h-full bg-[#050506] flex flex-col overflow-hidden relative
        `}>
          {/* Mobile Back Button to menu */}
          {isMobileView && mobileShowContent && (
            <div className="px-6 py-3.5 bg-[#09090b] border-b border-white/5 flex items-center justify-between shrink-0">
              <button 
                onClick={() => setMobileShowContent(false)}
                className="text-[10px] font-black text-blue-400 hover:text-blue-300 uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft size={12} />
                <span>Voltar ao Menu</span>
              </button>
              <span className="text-[9px] font-bold text-white/30 uppercase tracking-wider">
                {activeSection.title}
              </span>
            </div>
          )}

          {/* Main scrollable body */}
          <div 
            id="docs-main-content-scroll"
            className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar space-y-8 select-text"
          >
            
            {/* Section Header */}
            <div className="space-y-4 pb-6 border-b border-white/5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-600/10 border border-blue-500/20 rounded-full text-[9px] font-black uppercase tracking-widest text-blue-400">
                  <Award size={10} />
                  <span>Manual Oficial</span>
                </div>
                
                <div className="flex items-center gap-1.5 text-[8px] font-mono text-white/30 font-bold uppercase tracking-wider">
                  <Calendar size={10} />
                  <span>Atualizado: 22/05/2026</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-3xl sm:text-4xl">{activeSection.icon}</span>
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight">
                    {activeSection.title}
                  </h2>
                  <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mt-0.5">
                    Seção {activeSection.order} de {sections.length}
                  </p>
                </div>
              </div>
            </div>

            {/* Render Section Main Content using ReactMarkdown with custom styles */}
            <article className="prose prose-invert max-w-none text-white/70 text-xs sm:text-sm font-normal leading-relaxed space-y-6 docs-markdown-content">
              <ReactMarkdown>{activeSection.content}</ReactMarkdown>
            </article>

            {/* Subsections detailed display */}
            {activeSection.subsections && activeSection.subsections.length > 0 && (
              <div className="space-y-6 pt-6 border-t border-white/5">
                <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers size={14} className="text-blue-400" />
                  Subtópicos Detalhados
                </h3>
                
                <div className="space-y-4">
                  {activeSection.subsections.map((sub) => {
                    const isTarget = activeSubsectionId === sub.id;
                    return (
                      <div 
                        key={sub.id} 
                        id={`sub-${sub.id}`}
                        className={`p-5 rounded-2xl border transition-all ${
                          isTarget 
                            ? 'bg-blue-600/[0.03] border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.02)]' 
                            : 'bg-white/[0.01] border-white/5 hover:border-white/10'
                        }`}
                      >
                        <h4 className="text-xs font-black text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${isTarget ? 'bg-blue-400' : 'bg-white/20'}`} />
                          {sub.title}
                        </h4>
                        <p className="text-[11px] sm:text-xs text-white/50 leading-relaxed font-sans font-medium whitespace-pre-line">
                          {sub.content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Special Section: Interactive Glossary Terms Index inside Content Area if on Glossary Section */}
            {activeSectionId === 'glossario' && glossary.length > 0 && (
              <div className="space-y-6 pt-6 border-t border-white/5">
                <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <BookMarked size={14} className="text-blue-400" />
                  Index de Termos do Glossário
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {glossary.map((item) => {
                    const itemSlug = `glossary-${item.term.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-')}`;
                    const isSelectedTerm = activeSubsectionId === itemSlug;

                    return (
                      <div 
                        key={item.term}
                        id={`term-${item.term}`}
                        className={`p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 ${
                          isSelectedTerm
                            ? 'bg-blue-600/[0.03] border-blue-500/30 shadow-[0_0_25px_rgba(59,130,246,0.03)]'
                            : 'bg-white/[0.01] border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="space-y-2">
                          <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                            <span className="text-blue-400">#</span>
                            {item.term}
                          </h4>
                          <p className="text-[11px] text-white/50 leading-relaxed font-sans font-medium">
                            {item.definition}
                          </p>
                        </div>

                        {item.relatedSections && item.relatedSections.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.03]">
                            <span className="text-[7px] font-mono text-white/20 uppercase font-bold tracking-wider shrink-0 mr-1">
                              Relacionado:
                            </span>
                            {item.relatedSections.map(secId => {
                              const relatedSec = getSectionById(secId);
                              if (!relatedSec) return null;
                              return (
                                <button
                                  key={secId}
                                  onClick={() => handleSectionSelect(secId)}
                                  className="px-2 py-0.5 bg-white/5 hover:bg-blue-500/10 border border-white/5 hover:border-blue-500/20 rounded text-[8px] font-mono font-bold text-white/40 hover:text-blue-400 transition-all cursor-pointer flex items-center gap-1"
                                >
                                  <span>{relatedSec.icon}</span>
                                  <span>{relatedSec.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Sleek CSS styling for markdown items injected directly into component */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.01);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.06);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.15);
        }

        .docs-markdown-content h2 {
          font-size: 14px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #ffffff;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 0.25rem;
        }
        .docs-markdown-content h3 {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #ffffff;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .docs-markdown-content p {
          margin-bottom: 1rem;
          line-height: 1.6;
        }
        .docs-markdown-content strong {
          color: #3b82f6; /* Accent color blue */
          font-weight: 800;
        }
        .docs-markdown-content blockquote {
          border-left: 3px solid #3b82f6;
          padding-left: 1rem;
          margin: 1.5rem 0;
          font-style: italic;
          color: rgba(255, 255, 255, 0.5);
          background: rgba(255, 255, 255, 0.01);
          padding-top: 0.5rem;
          padding-bottom: 0.5rem;
          border-radius: 0 0.5rem 0.5rem 0;
        }
        .docs-markdown-content blockquote p {
          margin-bottom: 0;
        }
        .docs-markdown-content ul {
          list-style-type: none;
          padding-left: 0;
          margin-bottom: 1.25rem;
        }
        .docs-markdown-content li {
          position: relative;
          padding-left: 1.25rem;
          margin-bottom: 0.5rem;
          line-height: 1.5;
        }
        .docs-markdown-content li::before {
          content: "•";
          color: #3b82f6;
          font-weight: bold;
          font-size: 16px;
          position: absolute;
          left: 0;
          top: -2px;
        }
        .docs-markdown-content hr {
          border: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          margin: 1.5rem 0;
        }
        .docs-markdown-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.5rem 0;
          font-size: 11px;
          font-family: monospace;
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 0.75rem;
          overflow: hidden;
        }
        .docs-markdown-content th {
          background: rgba(255, 255, 255, 0.03);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #ffffff;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .docs-markdown-content th,
        .docs-markdown-content td {
          padding: 0.75rem 1rem;
          text-align: left;
        }
        .docs-markdown-content tr:not(:last-child) td {
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }
      `}</style>
    </div>
  );
}
