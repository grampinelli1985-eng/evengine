import { describe, it, expect, vi } from 'vitest';
import { 
  poissonDistribution, 
  calculateTeamPower, 
  calculateGoalsEV, 
  estimateGoalsWithGemini, 
  analyzeGoalsMarket, 
  selectBestGoalsMarket 
} from '../goalsService';

// Mock callGeminiAPI
vi.mock('../geminiService', () => {
  return {
    callGeminiAPI: vi.fn().mockResolvedValue(JSON.stringify({
      totalGoals: 2.5,
      confidence: 85,
      over2_5_prob: 58
    }))
  };
});

describe('Goals Service', () => {

  describe('1. poissonDistribution math and test-case compliance', () => {
    it('should correctly calculate Poisson probabilities', () => {
      // Test basic calculation with lambda = 1.5
      const dist = poissonDistribution(1.5);
      
      expect(dist.prob0).toBeCloseTo(Math.exp(-1.5), 3);
      expect(dist.prob1).toBeCloseTo(1.5 * Math.exp(-1.5), 3);
      expect(dist.over0_5).toBeCloseTo(1 - Math.exp(-1.5), 3);
      expect(dist.over1_5).toBeCloseTo(1 - Math.exp(-1.5) - 1.5 * Math.exp(-1.5), 3);
    });

    it('should pass test-case compliance for lambda = 2.16', () => {
      const dist = poissonDistribution(2.16);
      
      expect(dist.prob0).toBe(0.1153);
      expect(dist.prob1).toBe(0.2491);
      expect(dist.prob2).toBe(0.2690);
      expect(dist.prob3).toBe(0.1937);
      expect(dist.prob4plus).toBe(0.1728);
      expect(dist.over0_5).toBe(0.8847);
      expect(dist.over1_5).toBe(0.6356);
      expect(dist.over2_5).toBe(0.3665); // Exato conforme especificação matemática
    });

    it('should handle lambda < 0 gracefully', () => {
      const dist = poissonDistribution(-1.0);
      expect(dist.prob0).toBe(1.0);
      expect(dist.over0_5).toBe(0.0);
    });
  });

  describe('2. calculateTeamPower averages', () => {
    it('should calculate historical goals averages correctly', () => {
      const team = {
        lastGoalsFor: [2, 1, 3, 0, 2],      // Sum = 8, count = 5 -> Avg = 1.6
        lastGoalsAgainst: [1, 2, 0, 1, 2]   // Sum = 6, count = 5 -> Avg = 1.2
      };
      const power = calculateTeamPower(team);
      
      expect(power.attackPower).toBe(1.6);
      expect(power.defensePower).toBe(1.2);
    });

    it('should use default values for empty data', () => {
      const power = calculateTeamPower({ lastGoalsFor: [], lastGoalsAgainst: [] });
      expect(power.attackPower).toBe(1.5);
      expect(power.defensePower).toBe(1.2);
    });
  });

  describe('3. calculateGoalsEV calculations and custom test-case compliance', () => {
    it('should compute EV correctly: (prob * odd) - 1', () => {
      const ev = calculateGoalsEV(0.50, 2.20);
      expect(ev).toBeCloseTo(0.10, 4); // +10% EV
    });

    it('should pass custom test-case compliance for prob = 0.39 and odd = 1.95', () => {
      const ev = calculateGoalsEV(0.39, 1.95);
      expect(ev).toBe(-0.2395); // Exato conforme matemática real (-23.95% EV)
    });

    it('should handle null/undefined inputs gracefully', () => {
      expect(calculateGoalsEV(null as any, 1.95)).toBe(0);
      expect(calculateGoalsEV(0.5, undefined as any)).toBe(0);
    });
  });

  describe('4. estimateGoalsWithGemini', () => {
    it('should retrieve structured AI goals estimate', async () => {
      const estimate = await estimateGoalsWithGemini(
        'Chelsea', 'Arsenal',
        { goalsFor: 1.8, goalsAgainst: 1.2, form: 'VVVDD' },
        { goalsFor: 2.0, goalsAgainst: 1.0, form: 'VVVVV' }
      );
      
      expect(estimate.totalGoals).toBe(2.5);
      expect(estimate.confidence).toBe(0.85);
      expect(estimate.over2_5_prob).toBe(0.58);
    });
  });

  describe('5. analyzeGoalsMarket and Convergence (B3 delta)', () => {
    it('should orchestrate Poisson and Gemini projections and calculate convergence delta in pp', async () => {
      const odds = {
        over_1_5: 1.25,
        over_2_5: 1.95,
        btb: 1.80
      };

      // totalExpectedGoals: attackPower * defensePower + ...
      // home attack (1.5) * away defense (1.2) = 1.80
      // away attack (1.0) * home defense (1.2) = 1.20
      // total lambda = 3.0
      const analysis = await analyzeGoalsMarket(
        'Team A', 'Team B',
        1.5, 1.2, 1.0, 1.2,
        odds
      );

      expect(analysis.totalGoalsExpected).toBe(3.0);
      expect(analysis.probabilities).toBeDefined();
      expect(analysis.ev['over_1.5']).toBeDefined();
      expect(analysis.ev['over_2.5']).toBeDefined();
      expect(analysis.ev['btb']).toBeDefined();
      expect(analysis.convergence).toBeDefined(); // Divergence percentage delta in pp
    });
  });

  describe('6. selectBestGoalsMarket logic', () => {
    it('should choose the goals analysis with the highest Kelly/EV return', () => {
      const mockAnalyses = [
        {
          market: 'over_1.5',
          totalGoalsExpected: 2.2,
          probabilities: { over0_5: 90, over1_5: 75, over2_5: 45, over3_5: 20, btb: 55 },
          ev: { 'over_1.5': 0.05 }, // +5% EV
          selectedMarket: 'Over 1.5 Gols',
          confidence: 80,
          models: { poissonEstimate: 2.2, geminiEstimate: 2.3 },
          convergence: 5
        },
        {
          market: 'over_2.5',
          totalGoalsExpected: 2.2,
          probabilities: { over0_5: 90, over1_5: 75, over2_5: 45, over3_5: 20, btb: 55 },
          ev: { 'over_2.5': 0.12 }, // +12% EV (best EV)
          selectedMarket: 'Over 2.5 Gols',
          confidence: 80,
          models: { poissonEstimate: 2.2, geminiEstimate: 2.3 },
          convergence: 5
        }
      ] as any[];

      const best = selectBestGoalsMarket(mockAnalyses);
      expect(best.market).toBe('over_2.5');
    });
  });
});
