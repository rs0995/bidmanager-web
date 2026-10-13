import { useState } from "react";
import { View, Text, Image, ScrollView } from "react-native";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { ShieldQuestion } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Field, Input } from "@/components/common/Field";
import { Button } from "@/components/common/Button";
import { useToast } from "@/components/feedback/ToastProvider";
import { useCaptchaPending, CAPTCHA_PENDING_QUERY_KEY } from "@/hooks/useCaptchaPending";
import { api } from "@/lib/api";
import { useThemeColors } from "@/constants/colors";

// Lets this user solve a CAPTCHA one of their own jobs hit, from their phone,
// racing the admin desktop console on a first-valid-answer-wins basis (the
// server's /client/captcha/{id}/answer reuses the exact same atomic
// UPDATE ... WHERE status='pending' the admin endpoints already use, so
// whichever answer lands first simply wins -- no special handling needed
// here for losing that race beyond a normal error toast).
export default function CaptchaScreen() {
  const colors = useThemeColors();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pending = useCaptchaPending();
  const [text, setText] = useState("");

  const submit = useMutation({
    mutationFn: (id: string) => api.answerCaptcha(id, text),
    onSuccess: () => {
      setText("");
      toast?.push({ title: "Submitted", body: "Thanks -- the job will continue shortly." });
      queryClient.invalidateQueries({ queryKey: CAPTCHA_PENDING_QUERY_KEY });
    },
    onError: (e: any) => {
      toast?.push({
        title: "Couldn't submit",
        body: e?.message || "This one may have already been answered elsewhere.",
        type: "error",
      });
      queryClient.invalidateQueries({ queryKey: CAPTCHA_PENDING_QUERY_KEY });
    },
  });

  const item = pending.data as { request_id: string; image_base64: string; context?: string } | null;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Captcha" />
      <ScrollView contentContainerClassName="p-4">
        {pending.isLoading ? (
          <Text className="text-sm text-text-muted">Checking…</Text>
        ) : !item ? (
          <View className="items-center justify-center py-16 gap-3">
            <ShieldQuestion size={32} color={colors.textMuted} />
            <Text className="text-sm text-text-muted text-center">
              No CAPTCHA needs solving right now.
            </Text>
          </View>
        ) : (
          <View className="gap-4">
            <Text className="text-[14px] text-text-muted">
              One of your jobs needs a CAPTCHA solved to continue.
            </Text>
            <View className="bg-surface-0 border border-border rounded-[14px] p-3 items-center">
              <Image
                source={{ uri: `data:image/png;base64,${item.image_base64}` }}
                style={{ width: "100%", height: 120, resizeMode: "contain" }}
              />
            </View>
            <Field label="Enter the text shown above">
              <Input
                value={text}
                onChangeText={setText}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Captcha answer"
              />
            </Field>
            <Button
              onPress={() => submit.mutate(item.request_id)}
              disabled={submit.isPending || !text.trim()}
            >
              {submit.isPending ? "Submitting…" : "Submit"}
            </Button>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
