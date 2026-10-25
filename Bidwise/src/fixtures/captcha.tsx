import React, { createContext, useContext, useMemo, useState } from 'react';

// Phase 1 only: one waiting CAPTCHA from the user's own update job. Replaced by
// /client/captcha/pending and /client/captcha/{id}/answer in Phase 2. The first valid
// answer wins, whether it comes from this phone or the desktop console.

export type PendingCaptcha = {
  requestId: string;
  /** The characters drawn in the sample image (Phase 2 sends a PNG instead). */
  sampleText: string;
  context: string;
  /** Live: the server's PNG, base64. */
  imageBase64?: string;
};

export type CaptchaCtx = {
  pending: PendingCaptcha | null;
  /** Resolves true when the answer was accepted. */
  answer: (text: string) => Promise<boolean>;
};

export const CaptchaContext = createContext<CaptchaCtx>({
  pending: null,
  answer: async () => false,
});

export function CaptchaProvider({
  children,
  initial = {
    requestId: 'cap-1',
    sampleText: 'x7K2mq',
    context: 'Mahatenders · organisation update',
  },
}: {
  children: React.ReactNode;
  initial?: PendingCaptcha | null;
}) {
  const [pending, setPending] = useState<PendingCaptcha | null>(initial);
  const value = useMemo<CaptchaCtx>(
    () => ({
      pending,
      answer: async text => {
        if (!pending || !text.trim()) return false;
        setPending(null);
        return true;
      },
    }),
    [pending],
  );
  return (
    <CaptchaContext.Provider value={value}>{children}</CaptchaContext.Provider>
  );
}

export const useCaptcha = () => useContext(CaptchaContext);
