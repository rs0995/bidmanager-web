import { useState } from "react";
import { View, Text, Pressable, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { setSession } from "@/lib/auth";
import { pullBookmarks } from "@/lib/sync";
import { Field, Input } from "@/components/common/Field";
import { Button } from "@/components/common/Button";
import { useToast } from "@/components/feedback/ToastProvider";

export default function SignInScreen() {
  const toast = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });

  const mutation = useMutation({
    mutationFn: async () => {
      const response = mode === "register" ? await api.register(form) : await api.login(form);
      setSession(response);
      await pullBookmarks();
      return response;
    },
    onSuccess: () => {
      router.replace("/(tabs)");
    },
    onError: (error: any) => {
      toast?.push({ title: mode === "register" ? "Registration failed" : "Sign in failed", body: error?.message, type: "error" });
    },
  });

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-bg"
    >
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-8">
        <View className="mb-8 items-center">
          <Text className="text-2xl font-bold text-accent">BID MANAGER</Text>
          <Text className="mt-1 text-sm text-text-muted">
            {mode === "register" ? "Create your account" : "Sign in to continue"}
          </Text>
        </View>

        <View className="flex flex-col gap-3">
          {mode === "register" && (
            <Field label="Display name">
              <Input value={form.display_name} onChangeText={(v) => set({ display_name: v })} placeholder="Your name" />
            </Field>
          )}
          <Field label="Email">
            <Input
              keyboardType="email-address"
              autoCapitalize="none"
              value={form.email}
              onChangeText={(v) => set({ email: v })}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password">
            <Input
              secureTextEntry
              value={form.password}
              onChangeText={(v) => set({ password: v })}
              placeholder="••••••••"
            />
          </Field>

          <Button onPress={() => mutation.mutate()} disabled={mutation.isPending} className="mt-2">
            {mutation.isPending ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
          </Button>
        </View>

        <Pressable
          className="mt-4"
          onPress={() => setMode((m) => (m === "register" ? "login" : "register"))}
        >
          <Text className="text-sm text-center text-accent">
            {mode === "register" ? "Already have an account? Sign in" : "Do not have an account? Register"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
