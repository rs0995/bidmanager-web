import { useState } from "react";
import { View } from "react-native";
import { Field, Input, Select } from "@/components/common/Field";
import { Button } from "@/components/common/Button";

type AddChecklistItemFormProps = {
  folders: string[];
  onAdd: (item: { req_file_name: string; subfolder: string; description: string }) => void;
  onCancel: () => void;
};

export function AddChecklistItemForm({ folders, onAdd, onCancel }: AddChecklistItemFormProps) {
  const [reqFileName, setReqFileName] = useState("");
  const [subfolder, setSubfolder] = useState(folders[0]);
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!reqFileName.trim()) return;
    onAdd({ req_file_name: reqFileName.trim(), subfolder, description: description.trim() });
    setReqFileName("");
    setDescription("");
  };

  return (
    <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-3 flex flex-col gap-2">
      <Field label="Document name">
        <Input value={reqFileName} onChangeText={setReqFileName} placeholder="e.g. EMD — DD / BG" autoFocus />
      </Field>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Select
            value={subfolder}
            onValueChange={setSubfolder}
            options={folders.map((f) => ({ value: f, label: f }))}
          />
        </View>
        <View className="flex-1">
          <Input value={description} onChangeText={setDescription} placeholder="Note (optional)" />
        </View>
      </View>
      <View className="flex-row gap-2">
        <Button variant="ghost" className="flex-1" onPress={onCancel}>Cancel</Button>
        <Button className="flex-1" onPress={submit}>Add to checklist</Button>
      </View>
    </View>
  );
}
