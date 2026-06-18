// mockData.ts - Dados de exemplo para testes de integração completa

export const IS_MOCK = import.meta.env.DEV && false;

interface Odds {
  home: number;
  draw: number;
  away: number;
  over25?: number;
  under25?: number;
}

interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  league: string;
  odds: Odds;
}

interface Stats {
  winRate: number; // em %
  roi: number; // em %
}

interface PickAnalysis {
  matchId: string;
  pick: 'home' | 'draw' | 'away' | 'over25' | 'under25';
  tier: 'S' | 'A' | 'B' | 'C';
  ev: number; // Expected Value em %
  confidence: number; // 0-100
}

interface Ticket {
  name: string;
  picks: PickAnalysis[];
  valid: boolean;
}

export const mockMatches: Match[] = [
  {
    id: '1',
    homeTeam: 'Arsenal',
    awayTeam: 'Tottenham',
    date: '2024-10-20T15:00:00Z',
    league: 'Premier League',
    odds: { home: 1.80, draw: 3.60, away: 4.20 }
  },
  {
    id: '2',
    homeTeam: 'Manchester City',
    awayTeam: 'Liverpool',
    date: '2024-10-21T17:30:00Z',
    league: 'Premier League',
    odds: { home: 2.10, draw: 3.40, away: 3.30 }
  },
  {
    id: '3',
    homeTeam: 'Real Madrid',
    awayTeam: 'Barcelona',
    date: '2024-10-27T15:15:00Z',
    league: 'La Liga',
    odds: { home: 2.00, draw: 3.50, away: 3.60 }
  },
  {
    id: '4',
    homeTeam: 'Atlético Madrid',
    awayTeam: 'Sevilla',
    date: '2024-10-26T20:00:00Z',
    league: 'La Liga',
    odds: { home: 1.60, draw: 3.80, away: 5.00 }
  },
  {
    id: '5',
    homeTeam: 'Flamengo',
    awayTeam: 'Palmeiras',
    date: '2024-10-20T20:00:00Z',
    league: 'Brasileirão',
    odds: { home: 2.30, draw: 3.20, away: 3.00, over25: 1.85, under25: 2.00 }
  },
  {
    id: '6',
    homeTeam: 'Corinthians',
    awayTeam: 'São Paulo',
    date: '2024-10-21T23:00:00Z',
    league: 'Brasileirão',
    odds: { home: 2.50, draw: 3.10, away: 2.80 }
  },
  {
    id: '7',
    homeTeam: 'Vasco',
    awayTeam: 'Botafogo',
    date: '2024-10-22T23:30:00Z',
    league: 'Brasileirão',
    odds: { home: 3.00, draw: 3.20, away: 2.20 }
  }
];

export const mockTipsterStats: Record<string, Stats> = {
  conservative: { winRate: 52, roi: 8 },
  moderate: { winRate: 58, roi: 15 },
  aggressive: { winRate: 65, roi: 25 }
  // Perfis: Conservative (52% win, 8% ROI), Moderate (58%, 15%), Aggressive (65%, 25%)
};

export const mockAnalyses: PickAnalysis[] = [
  { matchId: '1', pick: 'home', tier: 'S', ev: 15, confidence: 85 },
  { matchId: '5', pick: 'over25', tier: 'S', ev: 13, confidence: 82 },
  { matchId: '2', pick: 'home', tier: 'A', ev: 8, confidence: 75 },
  { matchId: '6', pick: 'away', tier: 'A', ev: 7, confidence: 72 },
  { matchId: '7', pick: 'draw', tier: 'A', ev: 6, confidence: 70 },
  { matchId: '4', pick: 'home', tier: 'C', ev: 2, confidence: 55 },
  { matchId: '3', pick: 'away', tier: 'B', ev: 0, confidence: 50 }
  // Análises pré-calculadas com tiers S, A, B, C e EVs 0%, 2%, 6-15%
];

export const mockTickets: Ticket[] = [
  {
    name: 'Ticket Elite',
    picks: [mockAnalyses[0], mockAnalyses[1]], // 2 picks tier S, EV >12%
    valid: true
  },
  {
    name: 'Ticket Normal',
    picks: [mockAnalyses[2], mockAnalyses[3], mockAnalyses[4]], // 3 picks tier A, EV ~7%
    valid: true
  },
  {
    name: 'Ticket Rejeitado',
    picks: [mockAnalyses[0], mockAnalyses[5]], // Mixto com tier C, seria inválido
    valid: false
  }
];

export function getMockMatch(index: number): Match {
  // Retorna partida mock pelo índice (cíclico para testes)
  return mockMatches[index % mockMatches.length];
}

export function getMockStats(profile: 'conservative' | 'moderate' | 'aggressive'): Stats {
  // Retorna stats do perfil especificado
  return mockTipsterStats[profile];
}

export function generateMockAnalysis(match: Match): PickAnalysis {
  // Gera análise mock dinamicamente baseada nas odds
  const homeOdds = match.odds.home;
  let pick: PickAnalysis['pick'];
  let ev: number;
  let tier: PickAnalysis['tier'];
  let confidence: number;

  if (homeOdds < 1.9) {
    pick = 'home';
    ev = 15;
    tier = 'S';
    confidence = 88;
  } else if (homeOdds < 2.5) {
    pick = 'home';
    ev = 10;
    tier = 'A';
    confidence = 78;
  } else if (match.odds.away! < 2.5) {
    pick = 'away';
    ev = 9;
    tier = 'A';
    confidence = 75;
  } else {
    pick = 'draw';
    ev = 4;
    tier = 'C';
    confidence = 62;
  }

  return {
    matchId: match.id,
    pick,
    tier,
    ev,
    confidence
  };
}

export function getAllMockData() {
  // Retorna todos os dados mock em um objeto
  return {
    matches: mockMatches,
    stats: mockTipsterStats,
    analyses: mockAnalyses
  };
}
