export interface DocSubsection {
  id: string;
  title: string;
  content: string;
}

export interface DocSection {
  id: string;
  title: string;
  icon: string;
  order: number;
  content: string;
  subsections: DocSubsection[];
  keywords: string[];
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  relatedSections: string[];
}

export interface SearchIndexItem {
  term: string;
  relevance: number; // 0-10
  sections: string[];
}

export interface Documentation {
  version: string;
  lastUpdated: string;
  totalSections: number;
  sections: DocSection[];
  glossary: GlossaryTerm[];
  searchIndex: SearchIndexItem[];
}

export interface SearchResult {
  sectionId: string;
  subsectionId?: string;
  title: string;
  type: 'section' | 'subsection' | 'glossary';
  preview: string;
  relevance: number;
  matchedTerm?: string;
}
