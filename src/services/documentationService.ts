import docsData from '../data/documentation/betguru-docs.json';
import { Documentation, DocSection, DocSubsection, GlossaryTerm, SearchResult } from '../types/documentation';

// Assercionar o tipo dos dados importados do JSON
const documentation: Documentation = docsData as unknown as Documentation;

/**
 * Remove acentos e normaliza uma string para facilitar buscas textuais.
 */
function normalizeString(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Retorna toda a base de dados da documentação.
 */
export function getDocumentation(): Documentation {
  return documentation;
}

/**
 * Retorna as seções de documentação ordenadas.
 */
export function getSections(): DocSection[] {
  return [...documentation.sections].sort((a, b) => a.order - b.order);
}

/**
 * Obtém uma seção específica por ID.
 */
export function getSectionById(id: string): DocSection | undefined {
  return documentation.sections.find(s => s.id === id);
}

/**
 * Obtém os termos do glossário.
 */
export function getGlossary(): GlossaryTerm[] {
  return documentation.glossary || [];
}

/**
 * Cria um trecho de visualização (snippet) mostrando onde o termo foi encontrado.
 */
function generatePreview(text: string, query: string): string {
  const normText = normalizeString(text);
  const normQuery = normalizeString(query);
  const index = normText.indexOf(normQuery);

  if (index === -1) {
    // Se não encontrou no texto, retorna os primeiros 140 caracteres
    return text.length > 140 ? text.substring(0, 140) + '...' : text;
  }

  // Pegar um contexto de 60 caracteres antes e 80 depois
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + normQuery.length + 80);
  
  let snippet = text.substring(start, end);
  
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  
  return snippet;
}

/**
 * Motor de busca textual inteligente indexado por relevância.
 */
export function searchDocumentation(query: string): SearchResult[] {
  if (!query || !query.trim()) return [];
  
  const normQuery = normalizeString(query);
  const results: SearchResult[] = [];

  // 1. Buscar nas Seções Gerais
  documentation.sections.forEach(section => {
    let relevance = 0;
    const normTitle = normalizeString(section.title);
    const normContent = normalizeString(section.content);

    // Correspondência no título da seção (Relevância Máxima)
    if (normTitle.includes(normQuery)) {
      relevance += 10;
    }

    // Correspondência em palavras-chave (Relevância Alta)
    if (section.keywords && section.keywords.some(kw => normalizeString(kw).includes(normQuery))) {
      relevance += 8;
    }

    // Correspondência no corpo do conteúdo (Relevância Média)
    const occurrences = (normContent.match(new RegExp(escapeRegExp(normQuery), 'g')) || []).length;
    if (occurrences > 0) {
      relevance += Math.min(occurrences * 2, 6);
    }

    if (relevance > 0) {
      results.push({
        sectionId: section.id,
        title: section.title,
        type: 'section',
        preview: generatePreview(section.content, query),
        relevance,
        matchedTerm: section.keywords?.find(kw => normalizeString(kw).includes(normQuery)) || section.title
      });
    }

    // 2. Buscar nas Subseções
    section.subsections.forEach(sub => {
      let subRelevance = 0;
      const normSubTitle = normalizeString(sub.title);
      const normSubContent = normalizeString(sub.content);

      if (normSubTitle.includes(normQuery)) {
        subRelevance += 9;
      }

      if (normSubContent.includes(normQuery)) {
        subRelevance += 4;
      }

      if (subRelevance > 0) {
        results.push({
          sectionId: section.id,
          subsectionId: sub.id,
          title: `${section.title} › ${sub.title}`,
          type: 'subsection',
          preview: generatePreview(sub.content, query),
          relevance: subRelevance,
          matchedTerm: sub.title
        });
      }
    });
  });

  // 3. Buscar no Glossário
  const glossary = getGlossary();
  glossary.forEach(item => {
    let glossRelevance = 0;
    const normTerm = normalizeString(item.term);
    const normDefinition = normalizeString(item.definition);

    if (normTerm.includes(normQuery)) {
      glossRelevance += 9;
    } else if (normDefinition.includes(normQuery)) {
      glossRelevance += 4;
    }

    if (glossRelevance > 0) {
      // Mapear para a primeira seção relacionada ou mandar para o glossário geral
      const targetSection = item.relatedSections && item.relatedSections.length > 0
        ? item.relatedSections[0]
        : 'glossario';

      results.push({
        sectionId: targetSection,
        subsectionId: `glossary-${normalizeString(item.term).replace(/\s+/g, '-')}`,
        title: `Glossário › ${item.term}`,
        type: 'glossary',
        preview: generatePreview(item.definition, query),
        relevance: glossRelevance,
        matchedTerm: item.term
      });
    }
  });

  // Ordenar resultados: relevância decrescente, e depois por título
  return results.sort((a, b) => {
    if (b.relevance !== a.relevance) {
      return b.relevance - a.relevance;
    }
    return a.title.localeCompare(b.title);
  });
}

/**
 * Escapar caracteres especiais para uso em RegExp
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
