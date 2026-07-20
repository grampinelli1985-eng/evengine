import { describe, it, expect } from 'vitest';
import { getDocumentation, getSections, getSectionById, getGlossary, searchDocumentation } from '../src/services/documentationService';

describe('Sistema de Documentação - Motor de Busca', () => {

  it('Deve carregar a base de dados da documentação com 10 seções completas', () => {
    const docs = getDocumentation();
    expect(docs).toBeDefined();
    expect(docs.version).toBe('1.0');
    expect(docs.sections.length).toBeGreaterThanOrEqual(10);
    expect(docs.glossary.length).toBeGreaterThan(0);
  });

  it('Deve obter seções ordenadas por ordem sequencial', () => {
    const sections = getSections();
    expect(sections).toBeDefined();
    expect(sections.length).toBeGreaterThanOrEqual(10);
    // Verificar ordenação crescente
    for (let i = 0; i < sections.length - 1; i++) {
      expect(sections[i].order).toBeLessThanOrEqual(sections[i + 1].order);
    }
  });

  it('Deve retornar uma seção específica ao buscar por ID válido', () => {
    const section = getSectionById('visao-geral');
    expect(section).toBeDefined();
    expect(section?.title).toContain('Visão Geral');
    
    const invalidSection = getSectionById('secao-inexistente');
    expect(invalidSection).toBeUndefined();
  });

  it('Deve retornar termos do glossário estruturados', () => {
    const glossary = getGlossary();
    expect(glossary).toBeDefined();
    expect(glossary.length).toBeGreaterThan(0);
    expect(glossary[0].term).toBeDefined();
    expect(glossary[0].definition).toBeDefined();
  });

  describe('Algoritmo de Busca e Relevância', () => {
    it('Deve retornar lista vazia para queries vazias ou em branco', () => {
      expect(searchDocumentation('')).toEqual([]);
      expect(searchDocumentation('   ')).toEqual([]);
    });

    it('Deve ser insensível a maiúsculas/minúsculas e acentuação (normalização)', () => {
      const resNormal = searchDocumentation('visao geral');
      const resAccented = searchDocumentation('Visão Geral');
      
      expect(resNormal.length).toBeGreaterThan(0);
      expect(resAccented.length).toBeGreaterThan(0);
      
      // Os primeiros resultados devem ser idênticos
      expect(resNormal[0].sectionId).toBe(resAccented[0].sectionId);
    });

    it('Deve encontrar correspondências para o termo "sharp money" com relevância correta', () => {
      const results = searchDocumentation('sharp money');
      expect(results.length).toBeGreaterThan(0);
      
      // Deve rankear seções sobre Sharp Money ou Gates do sistema mais alto
      expect(results[0].relevance).toBeGreaterThanOrEqual(4);
      
      // Pelo menos um resultado deve conter o termo no título ou preview
      const hasTerm = results.some(r => 
        r.title.toLowerCase().includes('sharp') || 
        r.preview.toLowerCase().includes('sharp')
      );
      expect(hasTerm).toBe(true);
    });

    it('Deve encontrar correspondências para "EV" (Valor Esperado) de forma destacada', () => {
      const results = searchDocumentation('EV');
      expect(results.length).toBeGreaterThan(0);
      
      // O primeiro resultado deve ser sobre Gates (onde o B1 de EV é definido) ou sobre Filosofia (Valor Esperado)
      const topSectionIds = results.slice(0, 3).map(r => r.sectionId);
      expect(topSectionIds.some(id => id === 'os-9-gates' || id === 'filosofia')).toBe(true);
    });

    it('Deve classificar os resultados de busca por relevância decrescente', () => {
      const results = searchDocumentation('gates');
      expect(results.length).toBeGreaterThan(1);
      
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].relevance).toBeGreaterThanOrEqual(results[i + 1].relevance);
      }
    });

    it('Deve pesquisar e encontrar termos dentro do Glossário e retornar o tipo correto', () => {
      const glossaryTerms = getGlossary();
      expect(glossaryTerms.length).toBeGreaterThan(0);
      
      const termToSearch = glossaryTerms[0].term;
      const results = searchDocumentation(termToSearch);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.type === 'glossary')).toBe(true);
    });
  });
});
