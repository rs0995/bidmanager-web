import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// Shared across more.tsx (row badge), (tabs)/_layout.tsx (tab-bar badge) and
// captcha.tsx (the actual screen) -- React Query dedupes identical queries
// across components, so all three stay in sync off one underlying fetch
// instead of each polling independently.
export const CAPTCHA_PENDING_QUERY_KEY = ["captchaPending"];

export function useCaptchaPending() {
  return useQuery({
    queryKey: CAPTCHA_PENDING_QUERY_KEY,
    queryFn: () => api.captchaPending(),
    staleTime: 30_000,
  });
}
