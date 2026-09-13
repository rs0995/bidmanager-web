import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

const PAGE_SIZE = 25;

export function useTenders(filters) {
  return useInfiniteQuery({
    queryKey: ["tenders", filters],
    queryFn: ({ pageParam = 1 }) => api.tenders({ ...filters, page: pageParam, page_size: PAGE_SIZE }),
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  });
}
