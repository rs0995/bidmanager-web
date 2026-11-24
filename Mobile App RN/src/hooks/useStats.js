import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useStats() {
  return useQuery({ queryKey: ["stats"], queryFn: api.stats });
}
