import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const PAGE_SIZE = 50;

export function useOrganizations(filters) {
  return useInfiniteQuery({
    queryKey: ['organizations', filters],
    queryFn: ({ pageParam = 1 }) => api.organizations({ ...filters, page: pageParam, page_size: PAGE_SIZE }),
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  });
}
