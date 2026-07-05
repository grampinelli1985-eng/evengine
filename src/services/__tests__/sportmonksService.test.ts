import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getSeasonId, 
  getTeamXgLast5, 
  getTeamPpdaLast5, 
  getFixtureStatsById, 
  getSportmonksTeamId 
} from '../sportmonksService';

describe('Sportmonks Service Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Setup env variable mock
    vi.stubEnv('VITE_SPORTMONKS_TOKEN', 'test-token');
  });

  describe('getSeasonId', () => {
    it('should fetch and return season id that matches the year', async () => {
      const mockResponse = {
        data: [
          { id: 100, name: '2022/2023' },
          { id: 200, name: '2024/2025' }
        ]
      };
      
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const seasonId = await getSeasonId(8, 2024);
      expect(seasonId).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.sportmonks.com/v3/football/seasons?filters=leagueId:8',
        expect.any(Object)
      );
    });

    it('should return null if no matching season is found', async () => {
      const mockResponse = {
        data: [
          { id: 100, name: '2023/2024' }
        ]
      };
      
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const seasonId = await getSeasonId(8, 2025);
      expect(seasonId).toBeNull();
    });
  });

  describe('getTeamXgLast5', () => {
    it('should calculate expected goals average from last 5 games', async () => {
      const mockResponse = {
        data: [
          { statistics: [{ participant_id: 1, type: { developer_name: 'expected-goals' }, data: { value: 1.5 } }] },
          { statistics: [{ participant_id: 1, type: { developer_name: 'expected-goals' }, data: { value: 2.0 } }] },
          { statistics: [{ participant_id: 1, type: { developer_name: 'expected-goals' }, data: { value: 1.0 } }] }
        ]
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const xg = await getTeamXgLast5(1, 200);
      // Average: (1.5 + 2.0 + 1.0) / 3 = 1.5
      expect(xg).toBe(1.5);
    });

    it('should return null if less than 3 fixtures are available', async () => {
      const mockResponse = {
        data: [
          { statistics: [{ participant_id: 1, type: { developer_name: 'expected-goals' }, data: { value: 1.5 } }] },
          { statistics: [{ participant_id: 1, type: { developer_name: 'expected-goals' }, data: { value: 2.0 } }] }
        ]
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const xg = await getTeamXgLast5(1, 200);
      expect(xg).toBeNull();
    });
  });

  describe('getTeamPpdaLast5', () => {
    it('should calculate PPDA average from last 5 games', async () => {
      const mockResponse = {
        data: [
          { statistics: [{ participant_id: 1, type: { developer_name: 'passes-per-defensive-action' }, data: { value: 7.2 } }] },
          { statistics: [{ participant_id: 1, type: { developer_name: 'passes-per-defensive-action' }, data: { value: 8.5 } }] },
          { statistics: [{ participant_id: 1, type: { developer_name: 'passes-per-defensive-action' }, data: { value: 6.8 } }] }
        ]
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const ppda = await getTeamPpdaLast5(1, 200);
      // Average: (7.2 + 8.5 + 6.8) / 3 = 7.5
      expect(ppda).toBe(7.5);
    });
  });

  describe('getSportmonksTeamId', () => {
    it('should search for team and return id', async () => {
      const mockResponse = {
        data: [
          { id: 15, name: 'Everton' }
        ]
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const id = await getSportmonksTeamId('Everton');
      expect(id).toBe(15);
    });
  });
});
