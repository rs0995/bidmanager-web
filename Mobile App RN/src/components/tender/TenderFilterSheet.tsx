import { useState } from "react";
import { View } from "react-native";
import { Sheet } from "@/components/common/Sheet";
import { Field, Input, Select } from "@/components/common/Field";
import { Button } from "@/components/common/Button";

const SORT_OPTIONS: [string, string][] = [
  ["closing_date", "Closing date"],
  ["published_date", "Published date"],
  ["tender_value", "Tender value"],
  ["title", "Title"],
];

type TenderFilterSheetProps = {
  open: boolean;
  onClose: () => void;
  filters: any;
  onApply: (filters: any) => void;
};

export function TenderFilterSheet({ open, onClose, filters, onApply }: TenderFilterSheetProps) {
  const [local, setLocal] = useState(filters);

  if (!open) return null;
  const set = (patch: any) => setLocal((prev: any) => ({ ...prev, ...patch }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={(
        <>
          <Button
            variant="secondary"
            className="flex-1"
            onPress={() => { const cleared = { q: filters.q }; setLocal(cleared); onApply(cleared); onClose(); }}
          >
            Clear
          </Button>
          <Button className="flex-1" onPress={() => { onApply(local); onClose(); }}>Apply</Button>
        </>
      )}
    >
      <View className="flex flex-col gap-3">
        <Field label="Category">
          <Input value={local.category || ""} onChangeText={(v) => set({ category: v })} placeholder="e.g. Works" />
        </Field>
        <Field label="Location">
          <Input value={local.location || ""} onChangeText={(v) => set({ location: v })} placeholder="e.g. Pune" />
        </Field>
        <Field label="Organization">
          <Input value={local.organization || ""} onChangeText={(v) => set({ organization: v })} placeholder="e.g. PWD" />
        </Field>
        <Field label="Status">
          <Select
            value={local.archived ?? ""}
            onValueChange={(v) => set({ archived: v })}
            options={[{ value: "", label: "Active" }, { value: "true", label: "Archived" }]}
          />
        </Field>
        <Field label="Only tenders with documents">
          <Select
            value={local.has_documents ?? ""}
            onValueChange={(v) => set({ has_documents: v })}
            options={[
              { value: "", label: "Any" },
              { value: "true", label: "Has documents" },
              { value: "false", label: "No documents yet" },
            ]}
          />
        </Field>
        <Field label="Sort by">
          <Select
            value={local.sort_by || "closing_date"}
            onValueChange={(v) => set({ sort_by: v })}
            options={SORT_OPTIONS.map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Sort order">
          <Select
            value={local.sort_order || "asc"}
            onValueChange={(v) => set({ sort_order: v })}
            options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]}
          />
        </Field>
      </View>
    </Sheet>
  );
}
