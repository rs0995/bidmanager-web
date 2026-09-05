import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export function useTender(id) {
  return useQuery({
    queryKey: ['tender', Number(id)],
    queryFn: () => api.tender(id),
    enabled: id != null,
  });
}
