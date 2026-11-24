import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { setSession } from '../lib/auth.js';
import { pullBookmarks } from '../lib/sync.js';
import { Field, Input } from '../components/common/Field.jsx';
import { Button } from '../components/common/Button.jsx';
import { useToast } from '../components/feedback/ToastProvider.jsx';

export function SignInScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ email: '', password: '', display_name: '' });

  const mutation = useMutation({
    mutationFn: async () => {
      const response = mode === 'register' ? await api.register(form) : await api.login(form);
      setSession(response);
      await pullBookmarks();
      return response;
    },
    onSuccess: () => {
      navigate('/overview', { replace: true });
    },
    onError: (error) => {
      toast?.push({ title: mode === 'register' ? 'Registration failed' : 'Sign in failed', body: error?.message, type: 'error' });
    },
  });

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center px-6 pt-safe pb-safe" style={{ background: 'var(--bg)' }}>
      <div className="mb-8 text-center">
        <p className="m-0 text-2xl font-bold" style={{ color: 'var(--accent)' }}>BID MANAGER</p>
        <p className="m-0 mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {mode === 'register' ? 'Create your account' : 'Sign in to continue'}
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
      >
        {mode === 'register' && (
          <Field label="Display name">
            <Input value={form.display_name} onChange={(e) => set({ display_name: e.target.value })} placeholder="Your name" />
          </Field>
        )}
        <Field label="Email">
          <Input type="email" required autoCapitalize="off" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <Input type="password" required value={form.password} onChange={(e) => set({ password: e.target.value })} placeholder="••••••••" />
        </Field>

        <Button type="submit" disabled={mutation.isPending} className="mt-2">
          {mutation.isPending ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <button
        className="mt-4 text-sm text-center"
        style={{ color: 'var(--accent)' }}
        onClick={() => setMode((m) => (m === 'register' ? 'login' : 'register'))}
      >
        {mode === 'register' ? 'Already have an account? Sign in' : "Don't have an account? Register"}
      </button>
    </div>
  );
}
