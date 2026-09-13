import { Fragment, useMemo } from "react";
import { View, Text, Pressable } from "react-native";
import { parseINR } from "@/lib/format";

const VALUE_OPTIONS: [string, string][] = [
  ["val:gt25", "Above ₹25 Cr"],
  ["val:lt10", "Below ₹10 Cr"],
];
const OTHER_OPTIONS: [string, string][] = [["prebid", "Has pre-bid meeting"]];

type CustomFilterMenuProps = {
  open: boolean;
  rows: any[];
  active: string[];
  onAdd: (key: string) => void;
};

export function CustomFilterMenu({ open, rows, active, onAdd }: CustomFilterMenuProps) {
  const groups = useMemo(() => {
    const cats = [...new Set(rows.map((t) => t.category).filter(Boolean))].sort();
    const locs = [...new Set(rows.map((t) => t.location).filter(Boolean))].sort();
    return [
      { heading: "Category", options: cats.map((c) => [`cat:${c}`, c] as [string, string]) },
      { heading: "Location", options: locs.map((l) => [`loc:${l}`, l] as [string, string]) },
      { heading: "Tender value", options: VALUE_OPTIONS },
      { heading: "Other", options: OTHER_OPTIONS },
    ];
  }, [rows]);

  if (!open) return null;

  return (
    <View className="bg-surface-0 border border-border rounded-[14px] p-1.5 mb-3 gap-0.5">
      {groups.map((group) => {
        const available = group.options.filter(([key]) => !active.includes(key));
        if (available.length === 0) return null;
        return (
          <Fragment key={group.heading}>
            <Text className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">
              {group.heading}
            </Text>
            {available.map(([key, label]) => (
              <Pressable key={key} className="px-2.5 py-2 rounded-lg" onPress={() => onAdd(key)}>
                <Text className="text-sm text-text">{label}</Text>
              </Pressable>
            ))}
          </Fragment>
        );
      })}
    </View>
  );
}

export function customFilterLabel(key: string) {
  if (key.startsWith("cat:") || key.startsWith("loc:")) return key.slice(4);
  if (key === "val:gt25") return "Above ₹25 Cr";
  if (key === "val:lt10") return "Below ₹10 Cr";
  if (key === "prebid") return "Has pre-bid";
  return key;
}

export function customFilterPass(tender: any, key: string) {
  if (key.startsWith("cat:")) return tender.category === key.slice(4);
  if (key.startsWith("loc:")) return tender.location === key.slice(4);
  const value = parseINR(tender.tender_value);
  if (key === "val:gt25") return value > 25 * 1e7;
  if (key === "val:lt10") return value < 10 * 1e7;
  if (key === "prebid") return Boolean(tender.pre_bid_meeting_date);
  return true;
}
